import "server-only";

import { readBoundedUtf8Body } from "./read-bounded-utf8-body.server";

export type BoundedJsonRequestResult =
  | { ok: true; value: unknown }
  | { ok: false };

const APPLICATION_JSON =
  /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;

export async function parseBoundedJsonRequest(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonRequestResult> {
  if (!APPLICATION_JSON.test(request.headers.get("content-type") ?? "")) {
    return { ok: false };
  }

  const raw = await readBoundedUtf8Body(request, maxBytes);
  if (raw === null) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}
