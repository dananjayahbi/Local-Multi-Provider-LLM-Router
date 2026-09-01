// ─── Draft Commands ───────────────────────────────────
// Manage staged discovery drafts: list, accept (onboard with
// an API key), reject/update status, delete.

const api = require("../router-client");
const { style, table, truncate } = require("../ui");

async function listDrafts() {
  const drafts = await api.get("/drafts");
  const rows = drafts.map((d) => [
    d.id,
    truncate(d.name, 22),
    d.status || "-",
    truncate(d.baseUrl, 40),
    d.discoveredModels?.length ?? 0,
  ]);
  console.log(table(["ID", "NAME", "STATUS", "BASE URL", "MODELS"], rows));
}

/** Accept a draft: validate + onboard with an API key. */
async function acceptDraft(draftId, secret, virtualModelName) {
  if (!draftId || !secret) {
    throw new Error("usage: draft accept <draftId> <secret> [virtualModelName]");
  }
  const body = { secret };
  if (virtualModelName) body.virtualModelName = virtualModelName;
  const result = await api.post(`/drafts/${draftId}/validate`, body);
  console.log(style.green(`Accepted draft ${draftId} → provider ${result.providerId}`));
  if (result.poolId) console.log(style.green(`  + created quick pool ${result.poolId}`));
  return result;
}

/** Set a draft status (e.g. REJECTED). */
async function setDraftStatus(draftId, status) {
  const allowed = ["PENDING_KEY", "TESTING", "ACCEPTED", "REJECTED"];
  if (!allowed.includes(status)) {
    throw new Error(`status must be one of: ${allowed.join(", ")}`);
  }
  const d = await api.put(`/drafts/${draftId}`, { status });
  console.log(style.yellow(`Draft ${draftId} → ${d.status}`));
}

/** Delete a draft. */
async function deleteDraft(draftId) {
  await api.del(`/drafts/${draftId}`);
  console.log(style.yellow(`Deleted draft ${draftId}`));
}

const help = `draft commands:
  draft list                              list staged drafts
  draft accept <draftId> <secret> [virtualModel]   validate + onboard
  draft reject <draftId>                  reject a draft
  draft delete <draftId>                  delete a draft`;

module.exports = {
  name: "draft",
  help,
  async run(sub, args) {
    switch (sub) {
      case "list":
      case "ls":
        return listDrafts();
      case "accept":
      case "validate":
        return acceptDraft(args[0], args[1], args[2]);
      case "reject":
        return setDraftStatus(args[0], "REJECTED");
      case "delete":
      case "rm":
        return deleteDraft(args[0]);
      default:
        return listDrafts();
    }
  },
};
