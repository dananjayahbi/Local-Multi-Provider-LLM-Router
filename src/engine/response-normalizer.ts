import { CanonicalResponse } from "@/engine/canonical";

export function normalizeCanonicalResponse(response: CanonicalResponse): CanonicalResponse {
  if (response.choices.length > 0) {
    return response;
  }

  return {
    ...response,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "",
        },
        finish_reason: "stop",
      },
    ],
  };
}
