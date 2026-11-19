import { isNetworkError } from '@/services/api/EventApi';

/**
 * Retries an action after network failures only. Safe for guest actions because
 * the server treats repeats as no-ops (votes, answers) or dedupes them (messages).
 * Rule violations are never retried.
 */
export async function withRetry<T>(action: () => Promise<T>, attempts = 3, baseDelayMs = 700): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error) || attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}
