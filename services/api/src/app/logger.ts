/*
 * Structured JSON logs for CloudWatch. Callers pass explicit fields only:
 * never request bodies, tokens, passwords, message text or anything secret.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: Level = 'info', base: Record<string, unknown> = {}): Logger {
  const write = (at: Level, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[at] < ORDER[level]) return;
    const line = JSON.stringify({ level: at, message, time: new Date().toISOString(), ...base, ...fields });
    if (at === 'error') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
