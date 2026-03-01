import type { Env } from '../types';

function normalizeFlag(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function isDebugLogsEnabled(env: Env): boolean {
  const value = normalizeFlag(env.DEBUG_LOGS);
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function requestDebugId(request: Request): string {
  return request.headers.get('cf-ray') || crypto.randomUUID();
}

export function debugLog(env: Env, event: string, data?: Record<string, unknown>): void {
  if (!isDebugLogsEnabled(env)) return;

  try {
    console.log(`[debug] ${event} ${JSON.stringify(data || {})}`);
  } catch {
    console.log(`[debug] ${event}`);
  }
}
