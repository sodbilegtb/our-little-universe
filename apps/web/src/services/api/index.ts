import type { EventApi } from './EventApi';
import { createHttpEventApi } from './http/httpEventApi';
import { mockEventApi } from './mock/mockServer';

/*
 * One EventApi for the whole app:
 * - "mock" (default): the browser-only preview, synced across tabs.
 * - "http": the REST API (services/api). VITE_API_BASE_URL defaults to port
 *   8787 on the same host, so a phone on your Wi-Fi reaches your laptop's API.
 */
const mode = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock';

function defaultBaseUrl(): string {
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

export const api: EventApi =
  mode === 'http' ? createHttpEventApi((import.meta.env.VITE_API_BASE_URL as string | undefined) || defaultBaseUrl()) : mockEventApi;

export const isMockApi = mode === 'mock';

export { ApiError, errorMessage, isNetworkError } from './EventApi';
export type { AdminSession, Audience, DevTools, EventApi } from './EventApi';
