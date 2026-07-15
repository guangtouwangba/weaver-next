const STREAM_RECONNECT_DELAYS = [250, 1_000, 3_000, 5_000] as const;
const TRANSIENT_STREAM_ERRORS = ["WORKER_RESTARTING", "WORKER_UNAVAILABLE", "fetch failed", "Failed to fetch"] as const;

export function streamReconnectDelay(attempt: number): number {
  return STREAM_RECONNECT_DELAYS[Math.min(Math.max(0, attempt), STREAM_RECONNECT_DELAYS.length - 1)];
}

export function isTransientStreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_STREAM_ERRORS.some((code) => message.includes(code));
}
