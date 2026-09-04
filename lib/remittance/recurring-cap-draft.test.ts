import { describe, expect, it } from "vitest";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET } from "./constants";
import {
  RECURRING_CAP_CLOCK_ID,
  RECURRING_CAP_FUNCTION,
  RECURRING_CAP_MODULE,
  RECURRING_CAP_SCHEMA_VERSION,
  buildRecurringCapCreation,
  parseConfiguredPackageId,
  parseExpiryDateToMs,
  parseUsdcDecimalToMicro,
  validateRecurringCapDraft,
  type BuildRecurringCapInput,
  type RecurringCapDraftInput,
} from "./recurring-cap-draft";

const OWNER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "ab".repeat(32);
const BENEFICIARY_UPPER = "0x" + "ab".repeat(32).toUpperCase();
const PACKAGE = "0x" + "44".repeat(32);
const SUI_ZERO_ADDRESS = "0x" + "0".repeat(64);
const NOW = 1_700_000_000_000;
const MS_PER_DAY = 86_400_000;

function dateFromOffsetMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const EXPIRY_OK = dateFromOffsetMs(NOW + 10 * MS_PER_DAY);
const EXPIRY_PAST = dateFromOffsetMs(NOW - MS_PER_DAY);
const EXPIRY_FARTHEST_OK = dateFromOffsetMs(NOW + 364 * MS_PER_DAY);
const EXPIRY_TOO_FAR = dateFromOffsetMs(NOW + 365 * MS_PER_DAY);

function draft(overrides: Partial<RecurringCapDraftInput> = {}): RecurringCapDraftInput {
  return {
    beneficiaryAddress: BENEFICIARY,
    purpose: "Monthly rent support",
    fundedUsdc: "100",
    perPaymentUsdc: "10",
    totalCapUsdc: "100",
    intervalDays: "30",
    expiryDate: EXPIRY_OK,
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<BuildRecurringCapInput> = {},
): BuildRecurringCapInput {
  return {
    packageId: PACKAGE,
    sender: OWNER,
    draft: draft(),
    nowMs: NOW,
    ...overrides,
  };
}

describe("parseUsdcDecimalToMicro", () => {
  it("converts whole and fractional USDC to exact micro strings", () => {
    expect(parseUsdcDecimalToMicro("25")).toBe("25000000");
    expect(parseUsdcDecimalToMicro("25.5")).toBe("25500000");
    expect(parseUsdcDecimalToMicro("0.000001")).toBe("1");
    expect(parseUsdcDecimalToMicro("2000")).toBe("2000000000");
  });

  it("rejects malformed, zero, negative, and oversize amounts", () => {
    expect(parseUsdcDecimalToMicro("0")).toBeNull();
    expect(parseUsdcDecimalToMicro("0.000000")).toBeNull();
    expect(parseUsdcDecimalToMicro("-5")).toBeNull();
    expect(parseUsdcDecimalToMicro("abc")).toBeNull();
    expect(parseUsdcDecimalToMicro("")).toBeNull();
    expect(parseUsdcDecimalToMicro("12.")).toBeNull();
    expect(parseUsdcDecimalToMicro("1.0000005")).toBeNull();
    expect(parseUsdcDecimalToMicro("1,000")).toBeNull();
    expect(parseUsdcDecimalToMicro("1e6")).toBeNull();
    expect(parseUsdcDecimalToMicro("12345678901234")).toBeNull();
  });
});

describe("parseExpiryDateToMs", () => {
  it("returns the end of the selected day in UTC", () => {
    expect(parseExpiryDateToMs("2026-01-15")).toBe(Date.parse("2026-01-15T23:59:59.999Z"));
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseExpiryDateToMs("2026-13-01")).toBeNull();
    expect(parseExpiryDateToMs("2026-02-30")).toBeNull();
    expect(parseExpiryDateToMs("2026-1-01")).toBeNull();
    expect(parseExpiryDateToMs("2026-01-15T10:00:00Z")).toBeNull();
    expect(parseExpiryDateToMs("")).toBeNull();
    expect(parseExpiryDateToMs("nope")).toBeNull();
  });
});

describe("parseConfiguredPackageId", () => {
  it("accepts a canonical non-zero package address", () => {
    expect(parseConfiguredPackageId(PACKAGE)).toBe(PACKAGE);
  });

  it("rejects missing, malformed, zero, or non-canonical coordinates", () => {
    expect(parseConfiguredPackageId(undefined)).toBeNull();
    expect(parseConfiguredPackageId("")).toBeNull();
    expect(parseConfiguredPackageId("   ")).toBeNull();
    expect(parseConfiguredPackageId("nope")).toBeNull();
    expect(parseConfiguredPackageId(SUI_ZERO_ADDRESS)).toBeNull();
    expect(parseConfiguredPackageId("0x" + "44".repeat(31))).toBeNull();
    expect(parseConfiguredPackageId(BENEFICIARY_UPPER)).toBeNull();
  });
});

describe("validateRecurringCapDraft — Move invariant boundaries", () => {
  it("accepts a fully valid draft and normalizes money and text", () => {
    const result = validateRecurringCapDraft(
      draft({ purpose: "  Monthly rent support  " }),
      { nowMs: NOW, ownerAddress: OWNER },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toEqual({
      beneficiaryAddress: BENEFICIARY,
      purpose: "Monthly rent support",
      fundedMicro: "100000000",
      perPaymentCapMicro: "10000000",
      totalCapMicro: "100000000",
      intervalDays: 30,
      intervalMs: 30 * MS_PER_DAY,
      expiryDate: EXPIRY_OK,
      expiryMs: Date.parse(`${EXPIRY_OK}T23:59:59.999Z`),
    });
  });

  it("accepts the exact boundary where total cap equals per-payment cap and funded amount", () => {
    const result = validateRecurringCapDraft(draft(), { nowMs: NOW });
    expect(result.ok).toBe(true);
  });

  it("accepts drafting without a connected wallet (owner unknown)", () => {
    const result = validateRecurringCapDraft(draft(), { nowMs: NOW, ownerAddress: null });
    expect(result.ok).toBe(true);
  });

  it("rejects zero funding (EZeroFunding)", () => {
    const result = validateRecurringCapDraft(draft({ fundedUsdc: "0" }), { nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.funded).toBeDefined();
  });

  it("rejects funding above the client product cap", () => {
    const result = validateRecurringCapDraft(
      draft({ fundedUsdc: "2000.000001" }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.funded).toMatch(/2,000 USDC/);
  });

  it("accepts funding at the exact product cap", () => {
    const result = validateRecurringCapDraft(
      draft({ fundedUsdc: "2000", totalCapUsdc: "2000" }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(true);
    expect(MAX_USDC_MICRO).toBe(2_000_000_000n);
  });

  it("rejects a malformed, non-canonical, or zero beneficiary (EInvalidBeneficiary)", () => {
    for (const value of ["", "nope", "0xabc", SUI_ZERO_ADDRESS, BENEFICIARY_UPPER]) {
      const result = validateRecurringCapDraft(draft({ beneficiaryAddress: value }), {
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.beneficiaryAddress).toBeDefined();
    }
  });

  it("rejects a beneficiary equal to the owner when the owner is known", () => {
    const result = validateRecurringCapDraft(draft({ beneficiaryAddress: OWNER }), {
      nowMs: NOW,
      ownerAddress: OWNER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.beneficiaryAddress).toMatch(/different from you/);
  });

  it("rejects a zero per-payment cap (EInvalidPerPaymentCap)", () => {
    const result = validateRecurringCapDraft(draft({ perPaymentUsdc: "0" }), { nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.perPayment).toBeDefined();
  });

  it("rejects a total cap below the per-payment cap (EInvalidTotalCap)", () => {
    const result = validateRecurringCapDraft(
      draft({ perPaymentUsdc: "50", totalCapUsdc: "49.999999" }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.totalCap).toMatch(/below the per-collection maximum/);
  });

  it("rejects a total cap above the funded amount (EInvalidTotalCap)", () => {
    const result = validateRecurringCapDraft(draft({ totalCapUsdc: "100.000001" }), {
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.totalCap).toMatch(/exceed the funded amount/);
  });

  it("rejects interval boundaries outside 1..365 days (EInvalidInterval)", () => {
    for (const value of ["0", "366", "abc", "", "-1", "1.5"]) {
      const result = validateRecurringCapDraft(draft({ intervalDays: value }), { nowMs: NOW });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.interval).toBeDefined();
    }
  });

  it("accepts interval boundaries 1 and 365 days", () => {
    expect(
      validateRecurringCapDraft(draft({ intervalDays: "1" }), { nowMs: NOW }).ok,
    ).toBe(true);
    const result = validateRecurringCapDraft(draft({ intervalDays: "365" }), { nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.intervalMs).toBe(365 * MS_PER_DAY);
  });

  it("rejects an expiry at or before now (EInvalidExpiry)", () => {
    const result = validateRecurringCapDraft(draft({ expiryDate: EXPIRY_PAST }), {
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.expiry).toMatch(/future/);
  });

  it("rejects an expiry beyond the 365-day product bound", () => {
    const result = validateRecurringCapDraft(draft({ expiryDate: EXPIRY_TOO_FAR }), {
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.expiry).toMatch(/365 days/);
  });

  it("accepts the farthest allowed expiry date", () => {
    const result = validateRecurringCapDraft(draft({ expiryDate: EXPIRY_FARTHEST_OK }), {
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty, oversize, or control-character purpose", () => {
    for (const value of ["", "x".repeat(121), "line\nbreak", "bad\u0000char"]) {
      const result = validateRecurringCapDraft(draft({ purpose: value }), { nowMs: NOW });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.purpose).toBeDefined();
    }
    const ok = validateRecurringCapDraft(draft({ purpose: "x".repeat(120) }), { nowMs: NOW });
    expect(ok.ok).toBe(true);
  });

  it("collects errors for every invalid field at once", () => {
    const result = validateRecurringCapDraft(
      draft({ fundedUsdc: "0", intervalDays: "0", expiryDate: EXPIRY_PAST }),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["expiry", "funded", "interval"]);
  });

  it("fails closed on malformed input without throwing", () => {
    for (const input of [null, undefined, "nope", [], 42, { ...draft(), fundedUsdc: 1 }]) {
      const result = validateRecurringCapDraft(input, { nowMs: NOW });
      expect(result.ok).toBe(false);
    }
    expect(
      validateRecurringCapDraft(draft(), { nowMs: Number.NaN }).ok,
    ).toBe(false);
    expect(validateRecurringCapDraft(draft(), { nowMs: -1 }).ok).toBe(false);
  });

  it("does not mutate the input and is deterministic", () => {
    const input = draft({ purpose: "  Rent  " });
    const snapshot = JSON.parse(JSON.stringify(input)) as RecurringCapDraftInput;
    const a = validateRecurringCapDraft(input, { nowMs: NOW, ownerAddress: OWNER });
    const b = validateRecurringCapDraft(input, { nowMs: NOW, ownerAddress: OWNER });
    expect(input).toEqual(snapshot);
    expect(a).toEqual(b);
  });
});

describe("buildRecurringCapCreation — exact transaction", () => {
  interface MoveCallCommand {
    $kind: "MoveCall";
    MoveCall: {
      package: string;
      module: string;
      function: string;
      typeArguments: string[];
      arguments: { $kind: string; Input?: number; type?: string; Result?: number }[];
    };
  }
  interface IntentCommand {
    $kind: "$Intent";
    $Intent: { name: string; inputs: Record<string, unknown>; data: { type?: string; balance?: bigint } };
  }
  interface TxData {
    sender: string;
    commands: (MoveCallCommand | IntentCommand | { $kind: string })[];
    inputs: {
      $kind: string;
      Pure?: { bytes: string };
      Object?: {
        $kind: string;
        SharedObject?: { objectId: string; initialSharedVersion: string | number; mutable: boolean };
      };
    }[];
  }

  function inspect(result: ReturnType<typeof buildRecurringCapCreation>) {
    const data = result.transaction.getData() as TxData;
    const moveCall = data.commands.find((c): c is MoveCallCommand => c.$kind === "MoveCall");
    const intents = data.commands.filter((c): c is IntentCommand => c.$kind === "$Intent");
    if (!moveCall) throw new Error("MoveCall command not found");
    return { data, moveCall, intents };
  }

  function argKind(arg: { $kind: string; type?: string }): string {
    if (arg.$kind === "Result") return "Result";
    if (arg.$kind === "Input") return `Input.${arg.type ?? "unknown"}`;
    return arg.$kind;
  }

  function argAt(args: MoveCallCommand["MoveCall"]["arguments"], index: number) {
    const arg = args[index];
    if (!arg) throw new Error(`Move argument ${index} not found`);
    return arg;
  }

  function inputAt(data: TxData, index: number) {
    const input = data.inputs[index];
    if (!input) throw new Error(`Transaction input ${index} not found`);
    return input;
  }

  function pureBytes(input: ReturnType<typeof inputAt>): Buffer {
    const bytes = input.Pure?.bytes;
    if (typeof bytes !== "string") throw new Error("Expected a pure input");
    return Buffer.from(bytes, "base64");
  }

  it("binds the pinned module, function, clock, coin type, and target", () => {
    const result = buildRecurringCapCreation(buildInput());
    expect(result.metadata.schemaVersion).toBe(RECURRING_CAP_SCHEMA_VERSION);
    expect(result.metadata.module).toBe(RECURRING_CAP_MODULE);
    expect(result.metadata.function).toBe(RECURRING_CAP_FUNCTION);
    expect(result.metadata.clockId).toBe(RECURRING_CAP_CLOCK_ID);
    expect(RECURRING_CAP_CLOCK_ID).toBe(SUI_CLOCK_OBJECT_ID);
    expect(result.metadata.coinType).toBe(USDC_COIN_TYPE_TESTNET);
    expect(result.metadata.target).toBe(`${PACKAGE}::recurring_cap::create`);
    expect(result.metadata.owner).toBe(OWNER);
    expect(result.metadata.beneficiary).toBe(BENEFICIARY);
  });

  it("produces a deterministic 32-byte intent commitment", () => {
    const result = buildRecurringCapCreation(buildInput());
    expect(result.metadata.commitmentBytes).toHaveLength(32);
    expect(result.metadata.commitmentHex).toMatch(/^0x[0-9a-f]{64}$/);
    const again = buildRecurringCapCreation(buildInput());
    expect(again.metadata.commitmentHex).toBe(result.metadata.commitmentHex);
  });

  it("changes the commitment when any bound term changes", () => {
    const base = buildRecurringCapCreation(buildInput());
    const other = buildRecurringCapCreation(
      buildInput({ draft: draft({ purpose: "Different purpose" }) }),
    );
    expect(other.metadata.commitmentHex).not.toBe(base.metadata.commitmentHex);
    const otherInterval = buildRecurringCapCreation(
      buildInput({ draft: draft({ intervalDays: "31" }) }),
    );
    expect(otherInterval.metadata.commitmentHex).not.toBe(base.metadata.commitmentHex);
  });

  it("builds one Move call in exact Move argument order with a funded USDC coin intent", () => {
    const result = buildRecurringCapCreation(buildInput());
    const { data, moveCall, intents } = inspect(result);

    expect(data.sender).toBe(OWNER);
    expect(moveCall.MoveCall.package).toBe(PACKAGE);
    expect(moveCall.MoveCall.module).toBe(RECURRING_CAP_MODULE);
    expect(moveCall.MoveCall.function).toBe(RECURRING_CAP_FUNCTION);
    expect(moveCall.MoveCall.typeArguments).toEqual([USDC_COIN_TYPE_TESTNET]);

    const args = moveCall.MoveCall.arguments;
    expect(args).toHaveLength(8);
    expect(argKind(argAt(args, 0))).toBe("Result");
    expect(argKind(argAt(args, 1))).toBe("Input.pure");
    expect(argKind(argAt(args, 2))).toBe("Input.pure");
    expect(argKind(argAt(args, 3))).toBe("Input.pure");
    expect(argKind(argAt(args, 4))).toBe("Input.pure");
    expect(argKind(argAt(args, 5))).toBe("Input.pure");
    expect(argKind(argAt(args, 6))).toBe("Input.pure");
    expect(argKind(argAt(args, 7))).toBe("Input.object");

    // The coin argument resolves from a coin intent funding exactly the
    // mandated amount of pinned testnet USDC, never the gas coin.
    expect(intents).toHaveLength(1);
    expect(intents[0]!.$Intent.data.type).toBe(USDC_COIN_TYPE_TESTNET);
    expect(intents[0]!.$Intent.data.balance).toBe(100_000_000n);

    // Clock is the shared 0x6 object.
    const clockInput = inputAt(data, argAt(args, 7).Input ?? -1);
    if (!clockInput.Object?.SharedObject) throw new Error("Clock shared object input not found");
    expect(clockInput.Object.SharedObject.objectId).toBe(SUI_CLOCK_OBJECT_ID);

    // The commitment input carries the exact 32 commitment bytes behind the
    // BCS vector length prefix.
    const commitmentRaw = pureBytes(inputAt(data, argAt(args, 6).Input ?? -1));
    expect(commitmentRaw[0]).toBe(32);
    expect(Array.from(commitmentRaw.subarray(1))).toEqual([...result.metadata.commitmentBytes]);

    // u64 arguments decode little-endian to the exact bound values.
    expect(pureBytes(inputAt(data, argAt(args, 2).Input ?? -1)).readBigUInt64LE())
      .toBe(10_000_000n);
    expect(pureBytes(inputAt(data, argAt(args, 3).Input ?? -1)).readBigUInt64LE())
      .toBe(100_000_000n);
    expect(pureBytes(inputAt(data, argAt(args, 4).Input ?? -1)).readBigUInt64LE())
      .toBe(BigInt(30) * BigInt(MS_PER_DAY));
    expect(pureBytes(inputAt(data, argAt(args, 5).Input ?? -1)).readBigUInt64LE())
      .toBe(BigInt(Date.parse(`${EXPIRY_OK}T23:59:59.999Z`)));
  });

  it("throws when the package coordinate is absent, malformed, or zero", () => {
    for (const packageId of ["", "nope", SUI_ZERO_ADDRESS, "0x44"]) {
      expect(() => buildRecurringCapCreation(buildInput({ packageId }))).toThrow(
        /package is not configured/,
      );
    }
  });

  it("throws when the sender is missing or invalid", () => {
    for (const sender of ["", "nope", SUI_ZERO_ADDRESS]) {
      expect(() => buildRecurringCapCreation(buildInput({ sender }))).toThrow(/sender/i);
    }
  });

  it("throws on every draft invariant violation (fail closed before the wallet)", () => {
    const violations: RecurringCapDraftInput[] = [
      draft({ fundedUsdc: "0" }),
      draft({ beneficiaryAddress: OWNER }),
      draft({ beneficiaryAddress: "nope" }),
      draft({ perPaymentUsdc: "0" }),
      draft({ perPaymentUsdc: "50", totalCapUsdc: "10" }),
      draft({ totalCapUsdc: "200" }),
      draft({ intervalDays: "0" }),
      draft({ expiryDate: EXPIRY_PAST }),
      draft({ purpose: "" }),
    ];
    for (const draftCase of violations) {
      expect(() =>
        buildRecurringCapCreation(buildInput({ draft: draftCase })),
      ).toThrow(/Invalid mandate:/);
    }
  });
});
