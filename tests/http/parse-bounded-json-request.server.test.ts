import { describe, expect, it } from "vitest";
import { parseBoundedJsonRequest } from "@/lib/http/parse-bounded-json-request.server";

function request(body: string, contentType?: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    body,
    headers: contentType === undefined ? {} : { "content-type": contentType },
  });
}

describe("parseBoundedJsonRequest", () => {
  it.each([
    "application/json",
    "APPLICATION/JSON",
    "application/json; charset=utf-8",
    'application/json ; charset = "utf-8" ',
  ])("accepts strict JSON content type %s", async (contentType) => {
    await expect(
      parseBoundedJsonRequest(request('{"goal":"protect ETH"}', contentType), 64),
    ).resolves.toEqual({ ok: true, value: { goal: "protect ETH" } });
  });

  it.each([
    undefined,
    "text/plain",
    "application/json; charset=ascii",
    "application/json; profile=test",
  ])("rejects non-JSON content type %s", async (contentType) => {
    await expect(
      parseBoundedJsonRequest(request("{}", contentType), 64),
    ).resolves.toEqual({ ok: false });
  });

  it("rejects malformed or over-cap JSON bodies", async () => {
    await expect(
      parseBoundedJsonRequest(request("{", "application/json"), 64),
    ).resolves.toEqual({ ok: false });
    await expect(
      parseBoundedJsonRequest(request('{"value":"too long"}', "application/json"), 8),
    ).resolves.toEqual({ ok: false });
  });

  it("preserves a valid JSON null for domain validation", async () => {
    await expect(
      parseBoundedJsonRequest(request("null", "application/json"), 64),
    ).resolves.toEqual({ ok: true, value: null });
  });
});
