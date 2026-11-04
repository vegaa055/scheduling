import type { ApiError as ApiErrorBody, ConflictDTO } from "@sched/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public conflicts: ConflictDTO[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
    const returnTo = window.location.pathname;
    window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, body.error ?? "error", body.message ?? res.statusText, body.conflicts ?? []);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
