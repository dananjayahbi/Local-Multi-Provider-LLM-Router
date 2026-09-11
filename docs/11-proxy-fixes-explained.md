# Proxy Fixes Explained

This document explains, in plain language, the problems our LLM proxy was having and the solutions we put in place. It is written for a reader who wants to understand *what* was wrong, *what* was fixed, and *why* — without reading any code. Nothing here is a feature request or a roadmap; it is a record of problems we found and fixes we shipped.

---

## What the system is

Our system is a **self-hosted local proxy/router** that sits between AI coding agents and many different LLM providers.

In practice, that means:

- It **pools multiple API keys** from one or more providers.
- It exposes a **single endpoint that looks like the OpenAI API**, so an agent can point at our proxy instead of at a provider directly.
- It decides which key and provider to use for each request, handles retries and rate limits, and streams the response back.

Originally, the proxy was optimized for a specific client: **GitHub Copilot inside VS Code**. That original focus was the root of most of the trouble described here — the proxy learned behaviors that were correct for Copilot but wrong for everyone else.

---

## The two symptoms

Everything in this document traces back to two problems that users could actually see:

1. **Agents "over-thought", over-worked tasks, and sometimes got stuck in repeating loops — but only through the proxy.** The same agent, pointed directly at a single provider key, behaved normally and quickly. Only when it went through the proxy did it start looping and re-doing work.

2. **A 5–10 second delay before the first streamed token.** Once tokens started flowing, streaming was fast. Direct provider calls had no such delay — the wait happened entirely at the start of the response.

The first symptom was a **correctness** problem: the conversation itself was being corrupted. The second was a **speed** problem: work was being done on the critical path before any output could begin.

---

## Problem A — Why agents looped and over-thought

This section covers the *control-loop corruption*: places where the proxy broke the "conversation contract" that agents rely on. Each item below is a distinct cause. Together they made agents misread the state of a task and redo work.

### 1. Reasoning output was hidden from generic clients

Some models stream their **"thinking"** (also called chain-of-thought or reasoning) on a *separate channel* from their final answer.

Copilot understands that channel and shows it in a collapsible "Thinking" panel. Generic agents ignore that channel entirely. So when a turn contained **only reasoning and no final answer text**, a generic agent saw an **empty assistant turn** — and concluded it needed to try again. It would try again, get another reasoning-only turn, and try again. This was the **single biggest cause of looping**.

### 2. Tool calls were being dropped on the Anthropic-style path

When an agent uses a **tool** (a function it can call to look something up or act), the conversation records two things: "the assistant asked for tool X", followed by "tool X returned this result."

On the Anthropic-style path, the proxy forwarded the tool **result** but *not* the assistant's tool **request**. The result arrived with nothing to attach it to. The model could not tell that the tool had already run, so it asked for the same tool again — and again. This produced an **infinite tool loop**.

### 3. A Copilot-only instruction was injected into other clients

If a request had recently switched API keys, the proxy inserted a hidden instruction telling the model to use a tool called `askQuestion` — a tool that **only exists in Copilot**.

Non-Copilot agents were being told to call a tool they did not have. The result was confused behavior and hallucinated tool calls.

### 4. The conversation was told it "finished" when it had actually requested a tool

The proxy sometimes labelled the end of a turn as **"stopped"** even though the model had produced a tool call. An agent that sees "stopped" with no tool request believes the task is done — or that it must re-plan. So it re-planned.

A related issue: one provider format (the "Responses" style) was collapsing **every possible ending** into "stopped", discarding the signal that a tool had been requested.

### 5. Tools were silently removed for some models

A few models return empty results when a tools list is included, so the proxy learned to **strip tools** for those models. But that stripping also applied to agentic clients — removing the agent's ability to do anything at all.

### 6. Images were being dropped

**Multimodal** requests (text plus image) had their image parts thrown away for all clients. The model simply never saw the images.

### 7. An outage could look like a real answer

When every key in the pool was unavailable, the proxy returned a friendly "pool is exhausted" message that looked like a **normal finished answer**. A generic agent read it as "task complete" and moved on — silently swallowing the outage instead of backing off and retrying.

### 8. Session identity was based on Copilot-specific cleanup

The proxy strips certain Copilot context blocks to tell distinct conversations apart. Applied to a non-Copilot client that legitimately sends similar tags, this could **mangle the identity** and mix up conversations.

---

## Problem B — Why there was a 5–10 second delay

**Time-to-first-token (TTFT)** is the delay between sending a request and receiving the first streamed byte. Everything that runs *before* that first byte directly adds to the wait. Several things were blocking it.

### 1. Database writes were blocking the first byte

After the provider replied successfully, the proxy still wrote **"health" and "calibration" records** to its database *before* handing the stream back to the client. The client waited on those writes.

### 2. Unnecessary database writes ran on every request

Two "recovery" bookkeeping writes ran at the **start of every single request**, even though an equivalent background job already ran regularly at startup. They were pure overhead.

### 3. The database makes this worse than it sounds

The database is a **local file-based database** (SQLite-style) where writes must happen **one at a time**. Each write on the request path therefore cost far more than it would on a networked database.

### 4. Redundant database reads before contacting any provider

Before making even one call to a provider, the proxy read the **same configuration three separate times** — once for authentication, once for settings, and once for pool details.

### 5. A request could be held for up to a minute at the rate limiter

When a key was rate-limited, the proxy would simply **wait** (up to 60 seconds) for the limit window to free up, instead of trying a different key. That produced long, variable stalls.

### 6. No connection reuse to providers

Each request opened a **brand-new network connection**, including the secure-handshake step, instead of reusing a warm connection. That added avoidable delay to every call.

---

## The solutions we implemented

The fixes divide into two groups: **client profiles** (the enabler) and the specific corrections built on top of it.

### The central enabler: client profiles

The proxy now distinguishes between a **"Copilot" client** and a **"universal" client**.

- The default remains **Copilot**, so existing Copilot behavior is completely unchanged.
- Universal behavior is **opt-in** — via an environment setting or a per-request header.
- Copilot clients are **auto-detected** and always kept on the Copilot profile.

This is what makes every fix below safe and reversible: it lets us do the right thing for generic agents **without regressing Copilot**.

### Problem → fix mapping

The table below maps each problem to the fix that addresses it.

| Problem | Effect | Fix |
|---|---|---|
| Reasoning hidden from generic clients | Empty assistant turns; the main looping trigger | For universal clients, reasoning-only content is also placed in the normal answer text field, so a turn never looks empty. The original reasoning channel is preserved, so Copilot still gets its Thinking panel. Copilot unchanged. |
| Tool calls dropped on the Anthropic path | Tool results had nothing to attach to; infinite tool loop | The path now forwards the assistant's tool request and pairs the tool result with it correctly, so the model sees the tool already ran. |
| Copilot-only `askQuestion` instruction leaked | Non-Copilot agents told to call a nonexistent tool | The guidance is only injected for Copilot clients, and only once (it is idempotent). Generic agents are never told about it. |
| Turn endings mislabelled as "stopped" | Agents re-planned instead of executing | If a turn produced a tool call, the ending is labelled "tool call" across all provider formats. This was derived from an algorithm studied in the reference project OmniRouter. |
| Tools stripped for some models | Agentic clients lost all ability to act | Universal clients always keep their tools, even on models previously flagged as unreliable with tools. |
| Images dropped | Model never saw images | Multimodal requests keep their image parts. |
| Outages looked like normal answers | Agents treated an outage as task completion | For universal clients, the "pool exhausted" message is prefixed with a clearly machine-detectable marker so an agent can tell an outage apart from a real answer and back off. Copilot's message remains clean. |
| Session identity based on Copilot cleanup | Conversation mix-ups | Copilot-specific cleanup is only applied to Copilot; generic clients keep their full identity. |
| Blocking database writes | Delayed the first byte | All blocking bookkeeping writes (health reset, calibration, per-request recovery writes, and request logging) now run in the background, fire-and-forget. Nothing about correctness changes — only *when*. |
| Three redundant config reads | Extra round-trips before provider contact | The reads were collapsed and the settings lookup is now cached in memory with a short expiry (and invalidated when changed in the admin UI). |
| Rate-limiter held requests up to 60s | Long, variable stalls | The wait is now capped at a small, configurable amount (default ~1.5 seconds), then fails over to another key — turning stalls into fast failover. |
| No connection reuse | Repeated connection and secure-handshake setup | Upstream calls now use a pooled, keep-alive connection. If the runtime cannot provide this, it safely falls back to the previous behavior. |
| Brief silence during provider warm-up | Clients could mistake silence for a stalled connection | An early stream keepalive emits a valid no-op "heartbeat" frame during warm-up. Enabled for universal clients only. |

### In short

Every item in **Problem A** is answered by a corresponding fidelity fix, and every item in **Problem B** is answered by moving work off the critical path or removing it entirely. Importantly, none of these fixes change *what* the proxy computes — they change *whether the client can correctly see it* and *when the work happens*.

---

## Where the ideas came from

Several of the fixes were informed by studying an open-source project called **OmniRouter**. In plain terms, we adopted only the algorithms that addressed our specific problems:

- Preserving and bridging reasoning output.
- Forcing the "tool call" end-signal when tools are used.
- Counting reasoning as valid output.
- Keeping guidance injection **off by default**.
- Streaming-first with an early keepalive.
- Reusing connections.
- Keeping bookkeeping off the request path.

We deliberately did **not** adopt OmniRouter's elaborate multi-factor routing scores, its content-compression pipelines, or its "holdback" buffering feature. Those either did not address our problems or would have made latency worse.

---

## Backward compatibility and safety

The most important safety property is that **the default profile is Copilot**. For existing Copilot users, **nothing changes**. Universal behavior is strictly opt-in, and **every change in this document is reversible by configuration**.

That means we can adopt the universal profile where it helps — for generic agents — while leaving Copilot on exactly the behavior it had before.

---

## How this was verified

- The project's **type-check passes with zero errors**.
- The **full automated verification suite passes: 20 suites, 314 checks, 0 failures**.

That suite includes a **new suite specifically covering these fixes**, plus all the pre-existing tests — which together prove there are **no regressions**.

---

## How to get the benefit

To make generic agents (like Zoo Code) behave correctly and quickly, switch on the **universal profile**. There are two ways:

- Set the environment setting `ROUTER_DEFAULT_CLIENT_PROFILE` to `universal`, or
- Send the header `x-router-client-profile: universal` on requests.

**Copilot needs no change** — it is auto-detected and stays on the Copilot profile.

---

## Summary

The proxy was built around Copilot's behavior, and those Copilot-specific behaviors broke the conversation contract for every other client — most visibly by hiding reasoning output, dropping tool requests, mislabelling turn endings, and injecting a Copilot-only instruction. Separately, database writes, redundant reads, an unbounded rate-limit wait, and missing connection reuse were adding seconds before the first streamed token.

The fix introduces **client profiles** so generic agents get correct, faithful behavior while Copilot stays exactly as it was. On top of that we surfaced reasoning, forwarded tool calls, told the truth about turn endings, stopped stripping tools and images, marked outages clearly, made session identity profile-aware, moved all bookkeeping off the critical path, cached configuration reads, capped the rate-limit wait, reused warm connections, and added an early stream keepalive. Everything is opt-in, reversible, type-checked, and covered by a passing verification suite.
