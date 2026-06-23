import { errorFromResponse } from "./errors";

export type ApiStatus = {
  ok: boolean;
  label: string;
  detail?: string;
};

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const BEARER_TOKEN = process.env.NEXT_PUBLIC_WEAVER_BEARER_TOKEN;

export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE}${path}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (BEARER_TOKEN && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${BEARER_TOKEN}`);
  }
  return fetch(apiUrl(path), {
    cache: "no-store",
    ...init,
    headers,
  });
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return (await response.json()) as T;
}

export async function apiText(path: string, init?: RequestInit): Promise<string> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response.text();
}

export async function pingApi(): Promise<ApiStatus> {
  try {
    const response = await apiFetch("/ping");
    if (!response.ok) {
      return { ok: false, label: `API ${response.status}` };
    }
    const data = (await response.json()) as { status?: string; service?: string };
    return {
      ok: data.status === "ok",
      label: data.status === "ok" ? "API connected" : "API degraded",
      detail: data.service,
    };
  } catch {
    return { ok: false, label: "API offline" };
  }
}
