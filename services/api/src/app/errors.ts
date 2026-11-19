import type { ApiErrorBody } from '@olu/shared';

/** A failure outside the event rules (auth, rate limits, availability). */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorBody['code'],
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = (message = 'Please sign in again.') => new AppError('UNAUTHORIZED', message, 401);
