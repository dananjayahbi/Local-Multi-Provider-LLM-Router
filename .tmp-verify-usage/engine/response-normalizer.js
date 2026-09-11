"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCanonicalResponse = normalizeCanonicalResponse;
function normalizeCanonicalResponse(response) {
    if (response.choices.length > 0) {
        return response;
    }
    return Object.assign(Object.assign({}, response), { choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: "",
                },
                finish_reason: "stop",
            },
        ] });
}
