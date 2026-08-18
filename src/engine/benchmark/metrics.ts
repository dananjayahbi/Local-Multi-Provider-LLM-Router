// ─── Benchmark Metrics ─────────────────────────────────
// Streaming observer that measures TTFT, ITL, and TPS
// from a provider's streaming response.

export interface StreamMetrics {
  ttftMs: number;
  avgTps: number;
  totalTokens: number;
  totalDurationMs: number;
  interTokenLatenciesMs: number[];
}

export interface StreamObserver {
  /** Feed a decoded text chunk from the stream. */
  onChunk(text: string): void;
  /** Finalize and return computed metrics. */
  finalize(): StreamMetrics;
}

/**
 * Creates a streaming observer that measures:
 *  - Time to First Token (TTFT): t_first_token - t_request_sent
 *  - Inter-Token Latency (ITL): t_i - t_{i-1}
 *  - Tokens Per Second (TPS): (N-1) / (t_N - t_1)
 */
export function createStreamObserver(requestSentAt: number): StreamObserver {
  const tokenArrivalTimes: number[] = [];
  let firstTokenAt: number | null = null;
  let accumulatedText = "";

  return {
    onChunk(text: string) {
      if (!text) return;
      const now = Date.now();
      if (firstTokenAt === null) {
        firstTokenAt = now;
      }
      accumulatedText += text;
      // Approximate token count by characters / 4 (matches token-estimator)
      const approxTokens = Math.max(1, Math.floor(accumulatedText.length / 4));
      // Record arrival time for each new token bucket
      while (tokenArrivalTimes.length < approxTokens) {
        tokenArrivalTimes.push(now);
      }
    },

    finalize(): StreamMetrics {
      const ttftMs = firstTokenAt !== null ? firstTokenAt - requestSentAt : 0;
      const totalTokens = tokenArrivalTimes.length;
      const totalDurationMs = firstTokenAt !== null ? Date.now() - firstTokenAt : 0;

      // Compute inter-token latencies
      const interTokenLatenciesMs: number[] = [];
      for (let i = 1; i < tokenArrivalTimes.length; i++) {
        interTokenLatenciesMs.push(tokenArrivalTimes[i] - tokenArrivalTimes[i - 1]);
      }

      // TPS = (N-1) / (t_N - t_1)
      let avgTps = 0;
      if (tokenArrivalTimes.length >= 2) {
        const span = tokenArrivalTimes[tokenArrivalTimes.length - 1] - tokenArrivalTimes[0];
        if (span > 0) {
          avgTps = (tokenArrivalTimes.length - 1) / (span / 1000);
        }
      }

      return {
        ttftMs,
        avgTps,
        totalTokens,
        totalDurationMs,
        interTokenLatenciesMs,
      };
    },
  };
}
