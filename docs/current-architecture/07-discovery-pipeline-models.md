# Discovery Pipeline + Models + Shared Keys

> Status: **IMPLEMENTED** (2026-08-21). Covers the 3-stage provider onboarding
> pipeline, the Models page, and the provider-level shared-key model.

## 1. Discovery onboarding pipeline (RAW → APPROVED → CONFIGURED)

The Hermes agent does **discovery only** (task 02). Human approval, key setup,
and model configuration happen in the UI. The `DraftProvider` model carries a
`stage` field:

| Stage | What happens |
|-------|--------------|
| `RAW` | Agent-discovered. Card shows name, source URL, base URL, API type. **Read more** popup lists all free discoverable models + extra agent findings (`details` JSON). Approve/Reject. |
| `APPROVED` | Approve creates the real `Provider` (linked via `Provider.draftProviderId`). Set one or more **provider-level API keys**. Then **Configure**. |
| `CONFIGURED` | Configure materializes `ProviderModel` rows (upsert by providerId+modelId). Provider appears in Models page and its models become pool-selectable. **Many API keys can still be added/removed here** (e.g. one per Google account) via the inline `KeySetupForm`. |
| `REJECTED` | User dismissed; can be reactivated to `RAW`. |

Transitions (drafts `[id]` route):
- `PUT {action:"approve"}` → creates Provider, sets `APPROVED`.
- `PUT {action:"configure", models:[...], baseUrl?}` → upserts models, sets
  `CONFIGURED`. Optional `baseUrl` corrects the provider endpoint (persisted on
  both the Provider and the DraftProvider) when discovery parsed it wrong.
- `PUT {action:"reject"}` / `{action:"reactivate"}`.

### Configure dialog — manual models, base URL edit, review step
The `ConfigureProviderDialog` (task: search may mis-parse models) now:
- Lets the user **add models manually by model ID** (`ManualModelInput`
  component: model ID + display name + context window, marked `manual` and
  removable), in addition to toggling discovered models.
- Lets the user **edit the base URL** (validated as `http(s)://...`).
- Has a **Review step** (`Review` → `Confirm & Configure`) that inspects that
  the base URL is valid, at least one model is selected, and every model ID is
  non-empty before configuring.
- `configureDraft(id, models, baseUrl?)` accepts the optional corrected URL and
  updates the linked Provider + the Draft's stored baseUrl.

## 2. Provider-level API keys SHARED across pools (task 05)

An `ApiKey` is a **provider-level credential** (belongs to a provider). Pools
reference keys through the `PoolApiKey` join table (`@@unique([poolId, apiKeyId])`).
`ApiKey.poolId` is kept only as a legacy backfill source.

- The **same key can serve multiple pools** (e.g. Provider01's key feeds both the
  "Mimo" and "Deepseek" pools).
- **Penalty/limits live on the ApiKey record**, so a penalty on a shared key
  propagates to every pool using it.
- The gateway resolves a pool's keys via `pool.poolApiKeys[].apiKey`, then maps
  them to members by provider.

Backfill: `backfillPoolKeys()` migrates legacy pool-owned keys into `PoolApiKey`
rows. `ensurePoolKeyBackfill()` (idempotent, guarded) is invoked from
`getAllDrafts` and `getAllKeys` since `runStartup()` is not wired into the
Next.js server lifecycle.

## 2b. MANY keys per provider (task 02–03)

The same provider can hold **multiple, independently-managed API keys** — e.g.
the user has several Google accounts, each with its own Google AI Studio key, all
backing the single "Google" provider. This is supported everywhere:

- **Data model:** `Provider.apiKeys` is a 1-to-many relation (no unique
  constraint on `providerId`), so any number of keys can share one provider.
- **APPROVED stage:** `KeySetupForm` on the approved card adds one-or-many keys.
- **CONFIGURED stage:** the configured card embeds the same `KeySetupForm`, so
  keys can be added/removed even after onboarding completes.
- **Provider detail page** (`/providers/[id]`): full CRUD — add, edit label/
  limits, enable/disable, reveal, delete, plus penalty/suspend state chips.

Because keys are provider-level (not pool-owned), multiple keys for one provider
are just multiple `ApiKey` rows on that provider; pools attach the ones they
want via `PoolApiKey`.

## 3. Models page (tasks 06–07)

- New `/models` admin page + sidebar **Models** link.
- Lists every configured `ProviderModel` across providers (model id, display
  name, provider, capabilities, context window, enabled toggle, delete).
- **Manual add** (`POST /api/admin/models`) — pick provider + model id + details,
  no discovery agent needed (task 07).
- **Edit existing** — an `EditModelDialog` (opened via the pencil button in each
  row) lets the user change a model's ID, display name, context window, and
  capabilities even after it is listed (task: models should remain editable).
- Pool creation already selects models from the models list (task 06).

## 4. Key management UI

- `add-key-dialog.tsx` has two modes:
  - **Create new** provider-level key + attach to the pool.
  - **Attach existing** shared key to this pool (sharing its penalty).
- `pool-keys-editor.tsx` **detaches** (Unlink) a key from a pool rather than
  globally deleting it — a shared key must remain available for other pools.

## 5. Key API surface

| Route | Purpose |
|-------|---------|
| `GET /api/admin/models` | list all models (provider included) |
| `POST /api/admin/models` | manual model create |
| `GET /api/admin/keys` | list all provider-level keys (+ provider + poolApiKeys) |
| `POST /api/admin/pools/[id]/keys` | attach a key to a pool |
| `DELETE /api/admin/pools/[id]/keys?apiKeyId=` | detach a key from a pool |
| `PUT /api/admin/drafts/[id]` | stage transitions (approve/configure/reject/reactivate) |

## 6. Gotchas

- Prisma 1:1 relation with the FK on `Provider`: `DraftProvider` exposes **no**
  `providerId` scalar. Look up via `prisma.provider.findUnique({ where: { draftProviderId: id } })`.
- Gateway pool resolution now uses `pool.poolApiKeys[].apiKey`; keep the key
  select fields aligned with `RouteCandidate`.
