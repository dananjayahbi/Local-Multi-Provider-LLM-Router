// ─── Agent Discovery Prompt Templates ──────────────────
// Templates guiding the Hermes agent's exploration of public
// sources for free/low-cost LLM endpoints.

const SEARCH_QUERIES = [
  "free OpenAI compatible API endpoints list github",
  "free LLM API providers list github awesome",
  "OpenAI compatible API free tier providers documentation",
  "DeepSeek API alternative providers free",
  "free LLM API base URL /v1 chat completions providers",
];

const EXTRACTION_PROMPT = `
You are extracting LLM provider endpoint details from web content.
Given the following content, extract structured provider information.

Return a JSON array of objects with this shape:
{
  "name": "Provider name",
  "baseUrl": "API base URL",
  "apiFormat": "CHAT_COMPLETIONS | MESSAGES | RESPONSES",
  "sourceUrl": "URL where found",
  "discoveredModels": ["model-id-1", "model-id-2"]
}

Content:
{{CONTENT}}
`;

module.exports = { SEARCH_QUERIES, EXTRACTION_PROMPT };
