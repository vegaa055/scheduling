import type { ConflictDTO } from "@sched/shared";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: { conflicts?: ConflictDTO[]; issues?: { path: string; message: string }[] } = {},
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You don't have permission to do that") =>
  new HttpError(403, "forbidden", message);
export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
