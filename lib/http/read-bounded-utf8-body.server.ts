/**
 * Server-only streamed-body reader with a strict byte cap.
 *
 * Single transport policy owner shared by every server route that accepts a
 * bounded JSON request body (the protected-transfer plan endpoint and the
 * settlement verifier). This module owns ONLY the transport trust boundary:
 *
 * - it validates the declared `Content-Length` grammar and bound;
 * - it counts actual streamed bytes and cancels over-cap input;
 * - it requires an honest declared length to match the actual byte count;
 * - it does one fatal UTF-8 decode.
 *
 * It deliberately contains NO domain reason, response shaping, JSON parsing,
 * secret handling, environment access, logging, or framework code. Callers map
 * the `null` transport failure to their own safe domain rejection reason.
 *
 * Imports `server-only` so an accidental client import fails the build.
 */
import "server-only";

/**
 * Read a streamed request body as a UTF-8 string, bounded by `maxBytes`.
 *
 * Transport contract (returns `null` for every transport failure; never throws
 * for untrusted input):
 *
 * - `maxBytes` is a programmer-supplied cap. It MUST be a positive safe
 *   integer. Misuse throws a `RangeError` — this is a programmer error, not an
 *   untrusted-input path, and is intentionally not swallowed.
 * - If a `Content-Length` header is present, it must be non-empty ASCII decimal
 *   digits only (`/^[0-9]+$/`), parse to a safe integer, be nonnegative, and be
 *   `<= maxBytes`. Empty, signed, exponent, decimal, whitespace, unsafe, or
 *   over-cap values return `null` before any byte is read.
 * - Actual streamed bytes are always counted and must stay `<= maxBytes`. On
 *   over-cap actual bytes the reader is cancelled best-effort (cancel rejection
 *   swallowed) and `null` is returned.
 * - When a declared length exists, it must equal the actual byte count after
 *   the stream completes. A dishonest smaller or larger declared value returns
 *   `null`.
 * - A missing body (`req.body` absent) returns `null`.
 * - A `reader.read()` rejection is caught and returns `null`.
 * - Chunks are combined once after a successful bounded read.
 * - UTF-8 decode is fatal; invalid bytes return `null`.
 */
export async function readBoundedUtf8Body(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(
      "readBoundedUtf8Body: maxBytes must be a positive safe integer.",
    );
  }

  const declaredHeader = req.headers.get("content-length");
  let declaredLength: number | null = null;
  if (declaredHeader !== null) {
    // Non-empty ASCII decimal digits only. Rejects empty, signed, exponent,
    // decimal, whitespace, and any non-digit grammar before any byte is read.
    if (!/^[0-9]+$/.test(declaredHeader)) {
      return null;
    }
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      return null;
    }
    declaredLength = declared;
  }

  if (!req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Best-effort cancel; swallow rejection so a transport failure stays a
        // clean null rather than an escaping exception.
        try {
          await reader.cancel();
        } catch {
          /* swallow cancel rejection */
        }
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // read() rejection: transport failure, fail closed.
    try {
      await reader.cancel();
    } catch {
      /* swallow */
    }
    return null;
  }

  // Honest declared length must match actual bytes exactly.
  if (declaredLength !== null && declaredLength !== total) {
    return null;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}
