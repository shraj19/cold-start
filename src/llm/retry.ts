// Retry with exponential backoff for transient errors

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

/** Extract retry-after delay from error message if present (e.g. "retry in 49.6s") */
function extractRetryAfterMs(msg: string): number | null {
  const match = msg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return match ? Math.ceil(parseFloat(match[1]!) * 1000) + 2000 : null;
}

/** Check if error is retryable (rate limit, service unavailable, timeout) */
function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    // Rate limits
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("quota exceeded") ||
    msg.includes("quota") ||
    // Service issues
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("502") ||
    msg.includes("bad gateway") ||
    msg.includes("504") ||
    msg.includes("gateway timeout") ||
    // Timeouts
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    // Overloaded
    msg.includes("overloaded") ||
    msg.includes("capacity")
  );
}

/**
 * Retry a function with exponential backoff on transient errors
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 10000, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Log full error for debugging
      console.error(`  [DEBUG] Attempt ${attempt + 1} error: ${lastError.message}`);

      if (!isRetryableError(lastError) || attempt === maxRetries) {
        throw lastError; // Throw original error, not wrapped
      }

      // Use retry-after from API if available, else exponential backoff
      const retryAfterMs = extractRetryAfterMs(lastError.message);
      const delay = retryAfterMs ?? (baseDelayMs * Math.pow(2, attempt));

      if (onRetry) {
        onRetry(attempt + 1, delay, lastError);
      } else {
        console.error(`  Retryable error (attempt ${attempt + 1}/${maxRetries + 1}), waiting ${Math.round(delay / 1000)}s...`);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/** Simple sleep helper */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
