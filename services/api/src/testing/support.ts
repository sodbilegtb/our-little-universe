import { createEventState, EXAMPLE_QUESTIONS, type EventState } from '@olu/event-core';
import { loadConfig, type AppConfig } from '../config/config';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ ENVIRONMENT: 'local', REPOSITORY: 'memory', EVENT_ID: 'test-event', DEV_ROUTES: 'true', ...overrides });
}

export function freshState(eventId = 'test-event'): EventState {
  return createEventState({ eventId, eventName: 'Test', questions: EXAMPLE_QUESTIONS });
}

/** A controllable clock for the service. */
export function testClock(start = Date.UTC(2026, 11, 5, 18, 0, 0)) {
  const clock = { now: start, tick: (ms: number) => (clock.now += ms) };
  return clock;
}
