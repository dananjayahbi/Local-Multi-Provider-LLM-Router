// ─── LLM Extraction Client ─────────────────────────────
// Optional OpenAI-compatible LLM client used to intelligently
// extract provider details from fetched web content.
//
// Configure via env vars:
//   HERMES_LLM_BASE_URL  (default: https://api.openai.com/v1)
//   HERMES_LLM_API_KEY   (your working API key)
//   HERMES_LLM_MODEL     (default: gpt-4o-mini)
//
// If no API key is set, the agent falls back to the heuristic
// parser in discovery.js.

const LLM_BASE_URL = process.env.HERMES_LLM_BASE_URL || "https://api.openai.com/v1";
const LLM_API_KEY = process.env.HERMES_LLM_API_KEY || "";
const LLM_MODEL = process.env.HERMES_LLM_MODEL || "gpt-4o-mini";

function isConfigured() {
  return Boolean(LLM_API_KEY);
}

/**
 * Asks the configured LLM to extract structured provider
 * records from raw web content. Returns an array of provider
 * objects, or null if the LLM is not configured / fails.
 */
async function extractProvidersWithLLM(content, sourceUrl, userPrompt) {
  if (!isConfigured()) return null;

  const systemPrompt = `You are an expert at discovering free/low-cost LLM API providers.
Given web content, extract structured provider endpoint information.

Return ONLY a JSON array (no markdown, no commentary) of objects with this exact shape:
{
  "name": "Provider name",
  "baseUrl": "API base URL (e.g. https://api.example.com/v1)",
  "apiFormat": "CHAT_COMPLETIONS | MESSAGES | RESPONSES",
  "sourceUrl": "URL where found",
  "discoveredModels": ["model-id-1", "model-id-2"]
}

Rules:
- Only include providers with a plausible API base URL.
- Prefer OpenAI-compatible (CHAT_COMPLETIONS) endpoints.
- If no providers are found, return an empty array [].`;

  const userMessage = `${userPrompt ? `User research focus: ${userPrompt}\n\n` : ""}Source URL: ${sourceUrl}

Content:
${String(content).slice(0, 12000)}`;

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      console.error(`[hermes] LLM extraction failed (${res.status}): ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[hermes] LLM extraction error:", err.message);
    return null;
  }
}

/**
 * Generic LLM call function for chat conversations.
 * Takes an array of messages and returns the assistant's response.
 */
async function callLLM(messages, options = {}) {
  if (!isConfigured()) {
    throw new Error("LLM not configured — set HERMES_LLM_API_KEY");
  }

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || LLM_MODEL,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

module.exports = { extractProvidersWithLLM, callLLM, isConfigured, LLM_MODEL };
