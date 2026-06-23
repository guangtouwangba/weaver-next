import { apiFetch } from "./client";
import { errorFromResponse } from "./errors";

export type TokenEvent = {
  type: "message" | "token" | "progress" | "citation" | "tool_call" | "structured" | "done" | "error";
  seq: number;
  request_id: string;
  text?: string | null;
  structured?: Record<string, unknown> | null;
  citation?: Record<string, unknown> | null;
  tool_call?: Record<string, unknown> | null;
  error?: string | null;
  stage?: string | null;
};

export function decodeTokenEvent(raw: string): TokenEvent {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid token event");
  }
  const event = parsed as Partial<TokenEvent>;
  if (!event.type || typeof event.seq !== "number" || !event.request_id) {
    throw new Error("Invalid token event envelope");
  }
  return event as TokenEvent;
}

export async function* streamNdjson(path: string, init?: RequestInit): AsyncGenerator<TokenEvent> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        yield decodeTokenEvent(line);
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    yield decodeTokenEvent(buffer);
  }
}

export async function* streamSse(path: string, init?: RequestInit): AsyncGenerator<TokenEvent> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine) {
        yield decodeTokenEvent(dataLine.slice(6));
      }
    }
  }
}
