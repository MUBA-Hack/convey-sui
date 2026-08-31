import { describe, expect, it } from "vitest";
import {
  SUI_CLOCK_OBJECT_ID,
  normalizeStructTag,
} from "@mysten/sui/utils";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET, U64_MAX } from "./constants";
import type { CanonicalAuthorization } from "./quote-schema";
import {
  PROTECTED_TRANSFER_DEADLINE_MAX_MS,
  PROTECTED_TRANSFER_DEADLINE_MIN_MS,
  PROTECTED_TRANSFER_FUNCTION,
  PROTECTED_TRANSFER_MODULE,
  PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS,
  PROTECTED_TRANSFER_SCHEMA_VERSION,
  ProtectedTransferExecutionPlanSchema,
  buildProtectedTransfer,
  type BuildProtectedTransferInput,
  type ProtectedTransferExecutionPlan,
} from "./protected-transfer";

const ADDR_A = "0x" + "1234567890abcdef".repeat(4);
const ADDR_B = "0x" + "abcdef1234567890".repeat(4);
const SENDER = "0x" + "22".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const NOW = 1_700_000_000_000;

/** SDK-normalized pinned USDC struct tag — the exact form the coin intent must
 * carry. Derived from the installed SDK utility, not a substring guess. */
const EXPECTED_USDC_STRUCT_TAG = normalizeStructTag(USDC_COIN_TYPE_TESTNET);

function auth(overrides: Partial<CanonicalAuthorization> = {}): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: ADDR_A,
    usdcMicro: "109000000",
    coinType: USDC_COIN_TYPE_TESTNET,
    beneficiaryRef: "R-ABCD1234",
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_120_000,
    corridor: { source: "MYR", destination: "PHP" },
    youPayMinor: "50000",
    familyReceivesMinor: "610400",
    totalFeeMinor: "950",
    myrPerUsdc: "450",
    phpPerUsdc: "5600",
    fixedFeeMyr: "200",
    feeBps: 150,
    recipient: "Ana",
    destinationCity: "manila",
    purpose: null,
    maximumFamilyLimitMinor: null,
    ...overrides,
  };
}

function plan(
  overrides: Partial<ProtectedTransferExecutionPlan> = {},
): ProtectedTransferExecutionPlan {
  return {
    kind: "protected_transfer_execution_plan",
    authorization: auth(),
    packageId: PACKAGE,
    reviewerAddress: REVIEWER,
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS,
    reviewNote: "School supplies for Q1",
    ...overrides,
  };
}

function baseInput(
  overrides: {
    plan?: Partial<ProtectedTransferExecutionPlan>;
    sender?: string;
    nowMs?: number;
  } = {},
): BuildProtectedTransferInput {
  return {
    plan: plan(overrides.plan ?? {}),
    sender: overrides.sender ?? SENDER,
    nowMs: overrides.nowMs ?? NOW,
  };
}

/** Minimal descriptor for a Move argument: 'Result', 'Input.pure', or 'Input.object'. */
function argKind(arg: { $kind: string; type?: string }): string {
  if (arg.$kind === "Result") return "Result";
  if (arg.$kind === "Input") return `Input.${arg.type ?? "unknown"}`;
  return arg.$kind;
}

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
    Object?: { $kind: string; SharedObject?: { objectId: string; initialSharedVersion: string | number; mutable: boolean } };
  }[];
}

function inspect(result: ReturnType<typeof buildProtectedTransfer>) {
  const data = result.transaction.getData() as TxData;
  const moveCall = data.commands.find((c): c is MoveCallCommand => c.$kind === "MoveCall");
  const intent = data.commands.find((c): c is IntentCommand => c.$kind === "$Intent");
  if (!moveCall) throw new Error("MoveCall command not found");
  return { data, moveCall, intent };
}

describe("buildProtectedTransfer — valid input", () => {
  it("produces a deterministic 32-byte commitment and one pinned Move call", () => {
    const result = buildProtectedTransfer(baseInput());
    expect(result.metadata.commitmentBytes.length).toBe(32);
    expect(result.metadata.commitmentHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.metadata.schemaVersion).toBe(PROTECTED_TRANSFER_SCHEMA_VERSION);
    expect(result.metadata.module).toBe(PROTECTED_TRANSFER_MODULE);
    expect(result.metadata.function).toBe(PROTECTED_TRANSFER_FUNCTION);
    expect(result.metadata.clockId).toBe(SUI_CLOCK_OBJECT_ID);
    expect(result.metadata.coinType).toBe(USDC_COIN_TYPE_TESTNET);
    expect(result.metadata.target).toBe(
      `${result.metadata.packageId}::${PROTECTED_TRANSFER_MODULE}::${PROTECTED_TRANSFER_FUNCTION}`,
    );

    const { moveCall } = inspect(result);
    expect(moveCall.MoveCall.package).toBe(PACKAGE);
    expect(moveCall.MoveCall.module).toBe(PROTECTED_TRANSFER_MODULE);
    expect(moveCall.MoveCall.function).toBe(PROTECTED_TRANSFER_FUNCTION);
    expect(moveCall.MoveCall.typeArguments).toEqual([USDC_COIN_TYPE_TESTNET]);
  });

  it("accepts the exact-minimum deadline (boundary)", () => {
    const result = buildProtectedTransfer(
      baseInput({ plan: { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS } }),
    );
    expect(result.metadata.deadlineMs).toBe(NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS);
  });

  it("accepts the exact-maximum deadline (boundary)", () => {
    const result = buildProtectedTransfer(
      baseInput({ plan: { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MAX_MS } }),
    );
    expect(result.metadata.deadlineMs).toBe(NOW + PROTECTED_TRANSFER_DEADLINE_MAX_MS);
  });

  it("canonicalizes valid non-canonical sender/beneficiary/package/reviewer", () => {
    // Short form "0x1" is a valid Sui textual address; normalizeSuiAddress pads it.
    const result = buildProtectedTransfer(
      baseInput({
        sender: "0x1",
        plan: { packageId: "0x2", reviewerAddress: "0x3" },
      }),
    );
    expect(result.metadata.sender).toBe(
      "0x" + "0".repeat(63) + "1",
    );
    expect(result.metadata.packageId).toBe(
      "0x" + "0".repeat(63) + "2",
    );
    expect(result.metadata.reviewer).toBe(
      "0x" + "0".repeat(63) + "3",
    );
  });
});

describe("buildProtectedTransfer — determinism", () => {
  it("produces identical canonical encoding and commitment for identical input", () => {
    const a = buildProtectedTransfer(baseInput());
    const b = buildProtectedTransfer(baseInput());
    expect(a.metadata.canonicalEncoding).toBe(b.metadata.canonicalEncoding);
    expect(a.metadata.commitmentHex).toBe(b.metadata.commitmentHex);
    expect(a.metadata.commitmentBytes).toEqual(b.metadata.commitmentBytes);
  });

  it("changes the commitment when any bound term changes", () => {
    const base = buildProtectedTransfer(baseInput());
    const cases: BuildProtectedTransferInput[] = [
      baseInput({ sender: ADDR_B }),
      baseInput({ plan: { packageId: "0x" + "55".repeat(32) } }),
      baseInput({ plan: { reviewerAddress: ADDR_B } }),
      baseInput({ plan: { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS + 1 } }),
      baseInput({ plan: { reviewNote: "Different note" } }),
      baseInput({ plan: { authorization: auth({ usdcMicro: "108000000" }) } }),
      baseInput({ plan: { authorization: auth({ recipientAddress: ADDR_B }) } }),
      baseInput({ plan: { authorization: auth({ purpose: "rent" }) } }),
      baseInput({ plan: { authorization: auth({ maximumFamilyLimitMinor: "52000" }) } }),
      baseInput({ plan: { authorization: auth({ beneficiaryRef: "R-WXYZ1234" }) } }),
    ];
    for (const input of cases) {
      const variant = buildProtectedTransfer(input);
      expect(variant.metadata.commitmentHex).not.toBe(base.metadata.commitmentHex);
    }
  });

  it("does not change the commitment when only nowMs changes (nowMs is not bound)", () => {
    // Widen the deadline so both nowMs values keep a valid window, and keep
    // both nowMs values inside the authorization freshness window
    // [issuedAt (=NOW), expiresAt (=NOW+120_000)). nowMs itself is not bound
    // into the commitment, so the digest must stay identical.
    const deadline = NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS + 60_000;
    const a = buildProtectedTransfer(
      baseInput({ nowMs: NOW, plan: { deadlineMs: deadline } }),
    );
    const b = buildProtectedTransfer(
      baseInput({ nowMs: NOW + 60_000, plan: { deadlineMs: deadline } }),
    );
    expect(a.metadata.deadlineMs).toBe(b.metadata.deadlineMs);
    expect(a.metadata.commitmentHex).toBe(b.metadata.commitmentHex);
  });
});

describe("buildProtectedTransfer — deadline rejection", () => {
  it("rejects a deadline below the minimum", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS - 1 } }),
      ),
    ).toThrow(/minimum/i);
  });

  it("rejects a deadline above the maximum", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MAX_MS + 1 } }),
      ),
    ).toThrow(/maximum/i);
  });

  it("rejects a past deadline", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { deadlineMs: NOW - 1 } })),
    ).toThrow();
  });

  it("rejects an unsafe nowMs", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ nowMs: Number.MAX_SAFE_INTEGER + 1 })),
    ).toThrow(/nowMs/i);
  });

  it("rejects a fractional deadline at the strict schema boundary", () => {
    // The plan schema enforces integer deadlineMs before the window check, so a
    // fractional value fails closed through the schema rather than leaking a
    // TypeError. Still a fail-closed rejection of the same input.
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS + 0.5 } }),
      ),
    ).toThrow(/schema/i);
  });
});

describe("buildProtectedTransfer — review note rejection", () => {
  it("rejects an empty note", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { reviewNote: "" } })),
    ).toThrow(/empty/i);
  });

  it("rejects a whitespace-only note", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { reviewNote: "   \t\n" } })),
    ).toThrow(/empty/i);
  });

  it("rejects a 121-code-point note", () => {
    const note = "a".repeat(PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS + 1);
    expect(() => buildProtectedTransfer(baseInput({ plan: { reviewNote: note } }))).toThrow(
      /120/i,
    );
  });

  it("rejects a note containing a newline", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { reviewNote: "line one\nline two" } })),
    ).toThrow(/control/i);
  });

  it("rejects a note containing a tab", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { reviewNote: "a\tb" } })),
    ).toThrow(/control/i);
  });

  it("rejects a note containing a C1 control character", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { reviewNote: "a\u0080b" } })),
    ).toThrow(/control/i);
  });

  it("accepts an emoji note at exactly 120 code points", () => {
    // Each emoji is one code point (astral plane, one iteration of for..of).
    const note = "🎁".repeat(PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS);
    const result = buildProtectedTransfer(baseInput({ plan: { reviewNote: note } }));
    expect(result.metadata.reviewNote).toBe(note);
  });

  it("trims surrounding whitespace but preserves internal whitespace", () => {
    const result = buildProtectedTransfer(baseInput({ plan: { reviewNote: "  pay  rent  " } }));
    expect(result.metadata.reviewNote).toBe("pay  rent");
  });
});

describe("buildProtectedTransfer — address validation", () => {
  it("rejects an invalid sender", () => {
    expect(() => buildProtectedTransfer(baseInput({ sender: "nope" }))).toThrow(/sender/i);
  });

  it("rejects an invalid packageId", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { packageId: "nope" } })),
    ).toThrow(/schema/i);
  });

  it("rejects an invalid reviewer", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { reviewerAddress: "nope" } })),
    ).toThrow(/schema/i);
  });

  it("rejects an invalid beneficiary (authorization recipientAddress) at the schema boundary", () => {
    // "nope" fails the strict recipientAddress regex before canonicalization;
    // a value that passes the regex is always canonicalizable, so the plan
    // schema is the fail-closed boundary for an invalid beneficiary.
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { authorization: auth({ recipientAddress: "nope" }) } })),
    ).toThrow(/schema/i);
  });

  it.each([
    ["zero payer", { sender: "0x" + "0".repeat(64) }],
    ["zero beneficiary", { plan: { authorization: auth({ recipientAddress: "0x" + "0".repeat(64) }) } }],
    ["zero reviewer", { plan: { reviewerAddress: "0x" + "0".repeat(64) } }],
    ["payer equals beneficiary", { sender: ADDR_A }],
    ["payer equals reviewer", { sender: REVIEWER }],
    ["beneficiary equals reviewer", { plan: { reviewerAddress: ADDR_A } }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => buildProtectedTransfer(baseInput(overrides as never))).toThrow(/zero|distinct/i);
  });
});

describe("buildProtectedTransfer — authorization validation", () => {
  it("rejects a wrong coin type", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { authorization: auth({ coinType: "0xwrong::usdc::USDC" }) } }),
      ),
    ).toThrow(/USDC/i);
  });

  it("rejects a malformed authorization (extra field)", () => {
    const bad = { ...auth(), extra: "field" } as unknown as CanonicalAuthorization;
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { authorization: bad } })),
    ).toThrow(/schema/i);
  });

  it("rejects a wrong authorization kind", () => {
    const bad = { ...auth(), kind: "quote" } as unknown as CanonicalAuthorization;
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { authorization: bad } })),
    ).toThrow();
  });
});

describe("buildProtectedTransfer — authorization freshness", () => {
  it("rejects a future-issued authorization (issuedAt > nowMs)", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { authorization: auth({ issuedAt: NOW + 1 }) } }),
      ),
    ).toThrow(/future/i);
  });

  it("accepts the exact issuedAt === nowMs boundary", () => {
    const result = buildProtectedTransfer(
      baseInput({ plan: { authorization: auth({ issuedAt: NOW }) } }),
    );
    expect(result.metadata.commitmentBytes.length).toBe(32);
  });

  it("accepts just-before-expiry (expiresAt === nowMs + 1)", () => {
    const result = buildProtectedTransfer(
      baseInput({ plan: { authorization: auth({ expiresAt: NOW + 1 }) } }),
    );
    expect(result.metadata.commitmentBytes.length).toBe(32);
  });

  it("rejects exact-expiry (expiresAt === nowMs)", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { authorization: auth({ expiresAt: NOW }) } }),
      ),
    ).toThrow(/expired/i);
  });

  it("rejects after-expiry (expiresAt < nowMs)", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({
          plan: {
            authorization: auth({ issuedAt: NOW - 2, expiresAt: NOW - 1 }),
          },
        }),
      ),
    ).toThrow(/expired/i);
  });
});

describe("buildProtectedTransfer — amount validation", () => {
  it("rejects zero", () => {
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: { authorization: auth({ usdcMicro: "0" }) } })),
    ).toThrow(/greater than zero/i);
  });

  it("rejects a negative amount", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { authorization: auth({ usdcMicro: "-5" }) } }),
      ),
    ).toThrow();
  });

  it("rejects a decimal amount", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { authorization: auth({ usdcMicro: "1.5" }) } }),
      ),
    ).toThrow();
  });

  it("rejects a non-numeric amount", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { authorization: auth({ usdcMicro: "abc" }) } }),
      ),
    ).toThrow();
  });

  it("rejects u64 overflow", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({ plan: { authorization: auth({ usdcMicro: (U64_MAX + 1n).toString() }) } }),
      ),
    ).toThrow(/u64/i);
  });

  it("rejects product-cap overflow", () => {
    expect(() =>
      buildProtectedTransfer(
        baseInput({
          plan: { authorization: auth({ usdcMicro: (MAX_USDC_MICRO + 1n).toString() }) },
        }),
      ),
    ).toThrow(/product cap/i);
  });
});

describe("buildProtectedTransfer — transaction data structure", () => {
  const result = buildProtectedTransfer(baseInput());
  const { data, moveCall, intent } = inspect(result);

  it("sets the canonical sender", () => {
    expect(data.sender).toBe(SENDER);
  });

  it("emits exactly one MoveCall and one CoinWithBalance intent", () => {
    const moveCalls = data.commands.filter((c) => c.$kind === "MoveCall");
    const intents = data.commands.filter((c) => c.$kind === "$Intent");
    expect(moveCalls.length).toBe(1);
    expect(intents.length).toBe(1);
    expect(intent?.$Intent.name).toBe("CoinWithBalance");
  });

  it("pins the coin amount and the exact SDK-normalized pinned USDC struct tag", () => {
    expect(intent?.$Intent.data.balance).toBe(109_000_000n);
    // Prove the exact normalized tag, not merely a substring match.
    expect(normalizeStructTag(String(intent?.$Intent.data.type))).toBe(
      EXPECTED_USDC_STRUCT_TAG,
    );
    expect(EXPECTED_USDC_STRUCT_TAG).toBe(USDC_COIN_TYPE_TESTNET);
  });

  it("passes six arguments in Move order with correct kinds", () => {
    const args = moveCall.MoveCall.arguments;
    expect(args.length).toBe(6);
    expect(argKind(args[0]!)).toBe("Result"); // coin
    expect(argKind(args[1]!)).toBe("Input.pure"); // beneficiary
    expect(argKind(args[2]!)).toBe("Input.pure"); // reviewer
    expect(argKind(args[3]!)).toBe("Input.pure"); // commitment bytes
    expect(argKind(args[4]!)).toBe("Input.pure"); // deadline u64
    expect(argKind(args[5]!)).toBe("Input.object"); // &Clock
  });

  it("references the immutable standard Clock object", () => {
    const clockArg = moveCall.MoveCall.arguments[5]!;
    expect(clockArg.$kind).toBe("Input");
    const clockInput = data.inputs[clockArg.Input!];
    expect(clockInput?.$kind).toBe("Object");
    expect(clockInput?.Object?.$kind).toBe("SharedObject");
    expect(clockInput?.Object?.SharedObject?.objectId).toBe(SUI_CLOCK_OBJECT_ID);
    expect(clockInput?.Object?.SharedObject?.mutable).toBe(false);
  });

  it("binds the coin Result to the CoinWithBalance intent", () => {
    const coinArg = moveCall.MoveCall.arguments[0]!;
    expect(coinArg.$kind).toBe("Result");
    const intentIndex = data.commands.findIndex((c) => c.$kind === "$Intent");
    expect(coinArg.Result).toBe(intentIndex);
  });
});

describe("buildProtectedTransfer — public surface cannot override pinned terms", () => {
  it("does not expose module/function/clock/coin/cap/algorithm/version overrides", () => {
    // The input type carries no such fields; the metadata always reflects pins.
    const result = buildProtectedTransfer(baseInput());
    expect(result.metadata.module).toBe("protected_transfer");
    expect(result.metadata.function).toBe("create_escrow");
    expect(result.metadata.clockId).toBe(SUI_CLOCK_OBJECT_ID);
    expect(result.metadata.coinType).toBe(USDC_COIN_TYPE_TESTNET);
    expect(result.metadata.schemaVersion).toBe("convey.protected-transfer.v1");
  });
});

describe("buildProtectedTransfer — strict execution-plan schema", () => {
  it("rejects a missing plan through the strict schema", () => {
    expect(() =>
      buildProtectedTransfer(
        { plan: undefined, sender: SENDER, nowMs: NOW } as unknown as BuildProtectedTransferInput,
      ),
    ).toThrow(/schema/i);
  });

  it("rejects a malformed plan (wrong kind) through the strict schema", () => {
    const bad = { ...plan(), kind: "not_a_plan" } as unknown as ProtectedTransferExecutionPlan;
    expect(() => buildProtectedTransfer(baseInput({ plan: bad }))).toThrow(/schema/i);
  });

  it("rejects a plan missing the deadlineMs property", () => {
    // Bypass the baseInput plan-merge helper so the deleted key is not restored
    // from defaults; the strict schema must be the fail-closed boundary.
    const bad = { ...plan() } as Partial<ProtectedTransferExecutionPlan>;
    delete (bad as { deadlineMs?: number }).deadlineMs;
    expect(() =>
      buildProtectedTransfer({
        plan: bad as ProtectedTransferExecutionPlan,
        sender: SENDER,
        nowMs: NOW,
      }),
    ).toThrow(/schema/i);
  });

  it("rejects a plan missing the authorization property", () => {
    const bad = { ...plan() } as Partial<ProtectedTransferExecutionPlan>;
    delete (bad as { authorization?: CanonicalAuthorization }).authorization;
    expect(() =>
      buildProtectedTransfer({
        plan: bad as ProtectedTransferExecutionPlan,
        sender: SENDER,
        nowMs: NOW,
      }),
    ).toThrow(/schema/i);
  });

  it("rejects a plan with an extra field", () => {
    const bad = { ...plan(), extra: "field" } as unknown as ProtectedTransferExecutionPlan;
    expect(() => buildProtectedTransfer(baseInput({ plan: bad }))).toThrow(/schema/i);
  });

  it("rejects a plan with a non-integer deadlineMs", () => {
    const bad = { ...plan(), deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS + 0.5 };
    expect(() =>
      buildProtectedTransfer(baseInput({ plan: bad as ProtectedTransferExecutionPlan })),
    ).toThrow(/schema/i);
  });

  it("the exported schema itself rejects missing and extra fields recursively", () => {
    expect(() => ProtectedTransferExecutionPlanSchema.parse(undefined)).toThrow();
    expect(() =>
      ProtectedTransferExecutionPlanSchema.parse({ ...plan(), unknown: 1 }),
    ).toThrow();
    expect(() =>
      ProtectedTransferExecutionPlanSchema.parse({
        ...plan(),
        authorization: { ...auth(), unknown: 1 },
      }),
    ).toThrow();
  });
});

describe("buildProtectedTransfer — metadata immutability", () => {
  it("returns a frozen metadata object", () => {
    const result = buildProtectedTransfer(baseInput());
    expect(Object.isFrozen(result.metadata)).toBe(true);
  });

  it("freezes commitmentBytes: element assignment fails or leaves values unchanged", () => {
    const result = buildProtectedTransfer(baseInput());
    const bytes = result.metadata.commitmentBytes;
    expect(Object.isFrozen(bytes)).toBe(true);
    expect(bytes.length).toBe(32);
    const first = bytes[0];
    try {
      // Assignment to a frozen array index throws in strict mode (ESM); in
      // sloppy mode it silently fails. Either way the observed value is fixed.
      (bytes as readonly number[] as number[])[0] = 255;
    } catch {
      // acceptable: strict-mode freeze throws TypeError
    }
    expect(bytes[0]).toBe(first);
  });

  it("freezes the metadata object: property assignment fails or leaves values unchanged", () => {
    const result = buildProtectedTransfer(baseInput());
    const meta = result.metadata;
    expect(Object.isFrozen(meta)).toBe(true);
    const original = meta.reviewNote;
    try {
      (meta as { reviewNote: string }).reviewNote = "tampered";
    } catch {
      // acceptable: strict-mode freeze throws TypeError
    }
    expect(meta.reviewNote).toBe(original);
  });

  it("keeps commitmentHex consistent with the frozen commitmentBytes list", () => {
    const result = buildProtectedTransfer(baseInput());
    const bytes = result.metadata.commitmentBytes;
    const reconstructed =
      "0x" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(reconstructed).toBe(result.metadata.commitmentHex);
    expect(reconstructed).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("does not freeze or mutate the Transaction", () => {
    const result = buildProtectedTransfer(baseInput());
    // The Transaction remains a normal, usable object (not frozen).
    expect(Object.isFrozen(result.transaction)).toBe(false);
    expect(typeof result.transaction.setSender).toBe("function");
  });
});
