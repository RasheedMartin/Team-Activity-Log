import type { ApiErrorBody } from "./contract";

// Mock mode: MSW answers same-origin /v1 requests in the browser. Live mode: the same /v1 calls
// go to the FastAPI backend, through the Vite proxy in development (same origin, so session cookies
// stay first-party) or the API serving the built app in production. Set VITE_API_URL only if the
// API lives on another origin.
export const API_MODE: "mock" | "live" =
  import.meta.env.VITE_API_MODE === "live" ? "live" : "mock";
export const API_BASE_URL = API_MODE === "live" ? (import.meta.env.VITE_API_URL ?? "/v1") : "/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  init?: { signal?: AbortSignal; idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof Blob)) headers["Content-Type"] = "application/json";
  if (init?.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    signal: init?.signal,
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let err: ApiErrorBody = { code: "http_error", message: `Request failed (${res.status})` };
    try {
      err = await res.json();
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiError(res.status, err);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>("GET", path, undefined, { signal });
export const post = <T>(path: string, body?: unknown, idempotencyKey?: string) =>
  api<T>("POST", path, body ?? {}, { idempotencyKey });
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const put = <T>(path: string, body: unknown) => api<T>("PUT", path, body);
export const del = <T = void>(path: string) => api<T>("DELETE", path);
