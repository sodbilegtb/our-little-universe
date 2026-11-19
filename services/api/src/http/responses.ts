import { DomainError } from '@olu/event-core';
import type { ApiErrorBody } from '@olu/shared';
import { ZodError } from 'zod';
import { AppError } from '../app/errors';
import type { ApiResponse } from './types';

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(status: number, body: unknown): ApiResponse {
  return { status, headers: { ...BASE_HEADERS }, body: JSON.stringify(body) };
}

export function noContent(): ApiResponse {
  return { status: 204, headers: { ...BASE_HEADERS }, body: '' };
}

/** HTTP status for each rule violation. Conflicts with the event's state are 409. */
const DOMAIN_STATUS: Record<DomainError['code'], number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INVALID_LINK: 404,
  WRONG_PHASE: 409,
  ALREADY_SUBMITTED: 409,
  CLOSED: 409,
  LIMIT_REACHED: 409,
  LOCKED: 409,
  NOT_AVAILABLE: 501,
  RATE_LIMITED: 429,
};

export class BadRequest extends Error {}

export function errorResponse(error: unknown): { response: ApiResponse; expected: boolean } {
  const body = (code: ApiErrorBody['code'], message: string) => ({ error: { code, message } });
  if (error instanceof DomainError) {
    return { response: json(DOMAIN_STATUS[error.code], body(error.code, error.message)), expected: true };
  }
  if (error instanceof AppError) return { response: json(error.status, body(error.code, error.message)), expected: true };
  if (error instanceof ZodError) {
    return { response: json(400, body('INVALID_INPUT', error.issues[0]?.message ?? 'Please check your input.')), expected: true };
  }
  if (error instanceof BadRequest) return { response: json(400, body('INVALID_INPUT', error.message)), expected: true };
  // Unexpected: never leak internals to the client.
  return { response: json(500, body('NOT_AVAILABLE', 'Something went wrong on our side. Please try again.')), expected: false };
}
