import type { ApiErrorBody } from '@olu/shared';

export type DomainErrorCode = Exclude<ApiErrorBody['code'], 'NETWORK'>;

/**
 * A rule was broken. The message is written for the person who sees it,
 * and never contains secret information.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function fail(code: DomainErrorCode, message: string): never {
  throw new DomainError(code, message);
}
