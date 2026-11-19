import { errorMessage, isNetworkError } from '@/services/api';

/** Error text for a guest action that has already been retried. */
export function actionErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return 'We couldn’t reach the party. Check your Wi-Fi and try again.';
  return errorMessage(error);
}
