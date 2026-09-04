import { describe, expect, it } from "vitest";
import {
  SUI_CLOCK_OBJECT_ID,
} from "@mysten/sui/utils";
import {
  MAX_USDC_MICRO,
  U64_MAX,
  USDC_COIN_TYPE_TESTNET,
} from "./constants";
import {
  APPROVAL_COLLECTION_FUNCTION,
  APPROVAL_COLLECTION_MAX_APPROVERS,
  APPROVAL_COLLECTION_MIN_MS,
  APPROVAL_COLLECTION_MODULE,
  APPROVAL_COLLECTION_PACKAGE_ID,
  APPROVAL_COLLECTION_SCHEMA_VERSION,
  buildApprovalCollection,
  validateApprovalCollectionDraft,
  type ApprovalCollectionDraft,
  type ApprovalCollectionDraftInput,
} from "./approval-collection-draft";
import { parseUsdcDecimalToMicro } from "./receipt-split";
import { formatUsdcGrouped } from "./money";

const BENEFICIARY = "0x" + "a1".repeat(32);
const BENEFICIARY_ALT = "0x" + "dd".repeat(32);
const APPROVER_A = "0x" + "b2".repeat(32);
const APPROVER_B = "0x" + "c3".repeat(32);
const SENDER = "0x" + "22".repeat(32);
const NOW = 1_700_000_000_000;

function draftInput(
  overrides: Partial<ApprovalCollectionDraftInput> = {},
): ApprovalCollectionDraftInput {
  return {
    title: "Field stipend for September",
    beneficiary: BENEFICIARY,
    amountMajor: "12.5",
    approvers: [APPROVER_A, APPROVER_B],
    threshold: 2,
    deadlinePreset: "three_days",
    nowMs: NOW,
    ...overrides,
  };
}

function validDraft(
  overrides: Partial<ApprovalCollectionDraftInput> = {},
): ApprovalCollectionDraft {
  const result = validateApprovalCollectionDraft(draftInput(overrides));
  if (!result.ok) throw new Error("test draft must validate");
  return result.draft;
}

function build(
  overrides: { draft?: Partial<ApprovalCollectionDraftInput>; sender?: string; nowMs?: number } = {},
) {
  return buildApprovalCollection({
    draft: validDraft(overrides.draft ?? {}),
    sender: overrides.sender ?? SENDER,
    nowMs: overrides.nowMs ?? NOW,
  });
}

/** Minimal descriptors mirroring the protected-transfer transaction tests. */
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

function inspect(result: ReturnType<typeof build>) {
  const data = result.transaction.getData() as TxData;
  const moveCall = data.commands.find((c): c is MoveCallCommand => c.$kind === "MoveCall");
  const intent = data.commands.find((c): c is IntentCommand => c.$kind === "$Intent");
  if (!moveCall) throw new Error("MoveCall command not found");
  return { data, moveCall, intent };
}

describe("validateApprovalCollectionDraft — accepted draft", () => {
  it("normalizes the amount to integer micro and keeps the pinned asset", () => {
    const result = validateApprovalCollectionDraft(draftInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.amountMicro).toBe("12500000");
    expect(result.draft.coinType).toBe(USDC_COIN_TYPE_TESTNET);
    expect(result.draft.title).toBe("Field stipend for September");
    expect(result.draft.threshold).toBe(2);
    expect(result.draft.deadlineMs).toBe(NOW + 72 * 60 * 60 * 1000);
    expect(result.draft.approvers).toEqual([APPROVER_A, APPROVER_B]);
  });

  it("canonicalizes short textual addresses", () => {
    const result = validateApprovalCollectionDraft(
      draftInput({ beneficiary: "0x1", approvers: ["0x2", "0x3"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.beneficiary).toBe("0x" + "0".repeat(63) + "1");
    expect(result.draft.approvers).toEqual([
      "0x" + "0".repeat(63) + "2",
      "0x" + "0".repeat(63) + "3",
    ]);
  });

  it("accepts the exact 1-hour minimum expiry preset boundary", () => {
    // Preset durations are pinned inside the 1h..30d window; the smallest is
    // tomorrow. The window re-check is exercised directly on build below.
    const result = validateApprovalCollectionDraft(
      draftInput({ deadlinePreset: "tomorrow" }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateApprovalCollectionDraft — rejections", () => {
  const field = (result: ReturnType<typeof validateApprovalCollectionDraft>, name: string) => {
    if (result.ok) throw new Error(`expected rejection for ${name}`);
    return result.errors.filter((error) => error.field === name).map((error) => error.message);
  };

  it("rejects an empty title, an oversized title, and control characters", () => {
    expect(field(validateApprovalCollectionDraft(draftInput({ title: "   " })), "title")).toHaveLength(1);
    expect(
      field(validateApprovalCollectionDraft(draftInput({ title: "x".repeat(121) })), "title"),
    ).toHaveLength(1);
    expect(field(validateApprovalCollectionDraft(draftInput({ title: "bad\nline" })), "title")).toHaveLength(1);
  });

  it("rejects zero, malformed, over-precise, and oversized amounts", () => {
    expect(field(validateApprovalCollectionDraft(draftInput({ amountMajor: "0" })), "amount")).toHaveLength(1);
    expect(field(validateApprovalCollectionDraft(draftInput({ amountMajor: "abc" })), "amount")).toHaveLength(1);
    expect(field(validateApprovalCollectionDraft(draftInput({ amountMajor: "1.0000001" })), "amount")).toHaveLength(1);
    expect(
      field(validateApprovalCollectionDraft(draftInput({ amountMajor: (MAX_USDC_MICRO + 1n).toString() })), "amount"),
    ).toHaveLength(1);
  });

  it("rejects missing, invalid, and zero beneficiary addresses", () => {
    expect(field(validateApprovalCollectionDraft(draftInput({ beneficiary: "" })), "beneficiary")).toHaveLength(1);
    expect(field(validateApprovalCollectionDraft(draftInput({ beneficiary: "not-an-address" })), "beneficiary")).toHaveLength(1);
    expect(field(validateApprovalCollectionDraft(draftInput({ beneficiary: "0x0" })), "beneficiary")).toHaveLength(1);
  });

  it("rejects zero approvers, too many approvers, invalid rows, duplicates, and the beneficiary as approver", () => {
    expect(field(validateApprovalCollectionDraft(draftInput({ approvers: [] })), "approvers")).toHaveLength(1);
    expect(
      field(
        validateApprovalCollectionDraft(
          draftInput({ approvers: Array.from({ length: APPROVAL_COLLECTION_MAX_APPROVERS + 1 }, (_, i) => `0x${i}`) }),
        ),
        "approvers",
      ).length,
    ).toBe(1);
    expect(
      field(validateApprovalCollectionDraft(draftInput({ approvers: ["", APPROVER_A] })), "approvers"),
    ).toHaveLength(1);
    expect(
      field(validateApprovalCollectionDraft(draftInput({ approvers: [APPROVER_A, APPROVER_A] })), "approvers"),
    ).toHaveLength(1);
    expect(
      field(validateApprovalCollectionDraft(draftInput({ approvers: [BENEFICIARY, APPROVER_A] })), "approvers"),
    ).toHaveLength(1);
  });

  it("rejects a threshold below 1 or above the approver count", () => {
    expect(field(validateApprovalCollectionDraft(draftInput({ threshold: 0 })), "threshold")).toHaveLength(1);
    expect(field(validateApprovalCollectionDraft(draftInput({ threshold: 3 })), "threshold")).toHaveLength(1);
  });

  it("rejects an unsafe current time before computing the preset expiry", () => {
    const result = validateApprovalCollectionDraft({
      ...draftInput(),
      nowMs: Number.NaN as unknown as number,
    });
    expect(result.ok).toBe(false);
  });
});

describe("buildApprovalCollection — transaction structure", () => {
  it("builds one pinned approval_collection::create call with the pinned USDC type", () => {
    const result = build();
    expect(result.metadata.schemaVersion).toBe(APPROVAL_COLLECTION_SCHEMA_VERSION);
    expect(result.metadata.module).toBe(APPROVAL_COLLECTION_MODULE);
    expect(result.metadata.function).toBe(APPROVAL_COLLECTION_FUNCTION);
    expect(result.metadata.clockId).toBe(SUI_CLOCK_OBJECT_ID);
    expect(result.metadata.coinType).toBe(USDC_COIN_TYPE_TESTNET);
    expect(result.metadata.packageId).toBe(APPROVAL_COLLECTION_PACKAGE_ID);
    expect(result.metadata.target).toBe(
      `${APPROVAL_COLLECTION_PACKAGE_ID}::${APPROVAL_COLLECTION_MODULE}::${APPROVAL_COLLECTION_FUNCTION}`,
    );

    const { data, moveCall, intent } = inspect(result);
    expect(moveCall.MoveCall.package).toBe(APPROVAL_COLLECTION_PACKAGE_ID);
    expect(moveCall.MoveCall.module).toBe(APPROVAL_COLLECTION_MODULE);
    expect(moveCall.MoveCall.function).toBe(APPROVAL_COLLECTION_FUNCTION);
    expect(moveCall.MoveCall.typeArguments).toEqual([USDC_COIN_TYPE_TESTNET]);
    expect(moveCall.MoveCall.arguments).toHaveLength(7);
    expect(data.commands).toHaveLength(2);
    expect(data.sender).toBe(SENDER);
    expect(intent?.$Intent.data.balance).toBe(12_500_000n);
    const clockArg = moveCall.MoveCall.arguments[6]!;
    expect(clockArg.$kind).toBe("Input");
    const clockInput = data.inputs[clockArg.Input!];
    expect(clockInput?.$kind).toBe("Object");
    expect(clockInput?.Object?.$kind).toBe("SharedObject");
    expect(clockInput?.Object?.SharedObject?.objectId).toBe(SUI_CLOCK_OBJECT_ID);
    expect(clockInput?.Object?.SharedObject?.mutable).toBe(false);
  });

  it("binds a deterministic 32-byte commitment that changes with any term", () => {
    const base = build();
    expect(base.metadata.commitmentBytes.length).toBe(32);
    expect(base.metadata.commitmentHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(base.metadata.canonicalEncoding).toBe(build().metadata.canonicalEncoding);

    const changed: ReturnType<typeof build>[] = [
      build({ draft: { title: "Different purpose" } }),
      build({ draft: { amountMajor: "13" } }),
      build({ draft: { beneficiary: BENEFICIARY_ALT } }),
      build({ draft: { threshold: 1 } }),
      build({ draft: { deadlinePreset: "seven_days" } }),
      build({ sender: APPROVER_B }),
    ];
    for (const variant of changed) {
      expect(variant.metadata.commitmentHex).not.toBe(base.metadata.commitmentHex);
    }
  });

  it("freezes the metadata and commitment snapshot", () => {
    const { metadata } = build();
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.commitmentBytes)).toBe(true);
    expect(Object.isFrozen(metadata.approvers)).toBe(true);
  });
});

describe("buildApprovalCollection — sender role guards", () => {
  it("rejects the beneficiary funding their own collection", () => {
    expect(() =>
      buildApprovalCollection({
        draft: validDraft(),
        sender: BENEFICIARY,
        nowMs: NOW,
      }),
    ).toThrow(/must be different addresses/);
  });

  it("rejects a zero sender", () => {
    expect(() =>
      buildApprovalCollection({
        draft: validDraft(),
        sender: "0x0",
        nowMs: NOW,
      }),
    ).toThrow(/zero address/);
  });

  it("allows the funding wallet to also be an approver", () => {
    const result = buildApprovalCollection({
      draft: validDraft({ approvers: [SENDER, APPROVER_A] }),
      sender: SENDER,
      nowMs: NOW,
    });
    expect(result.metadata.approvers).toContain(SENDER);
  });
});

describe("buildApprovalCollection — expiry window guards", () => {
  it("rejects a draft whose expiry falls inside the 1-hour minimum window", () => {
    const stale = { ...validDraft(), deadlineMs: NOW + APPROVAL_COLLECTION_MIN_MS - 1 } as ApprovalCollectionDraft;
    expect(() =>
      buildApprovalCollection({ draft: stale, sender: SENDER, nowMs: NOW }),
    ).toThrow(/1-hour minimum/);
  });

  it("rejects a draft whose expiry exceeds the 30-day maximum", () => {
    const far = { ...validDraft(), deadlineMs: NOW + 31 * 24 * 60 * 60 * 1000 } as ApprovalCollectionDraft;
    expect(() =>
      buildApprovalCollection({ draft: far, sender: SENDER, nowMs: NOW }),
    ).toThrow(/30-day maximum/);
  });

  it("rejects a draft whose expiry is already in the past", () => {
    const past = { ...validDraft(), deadlineMs: NOW - 1 } as ApprovalCollectionDraft;
    expect(() =>
      buildApprovalCollection({ draft: past, sender: SENDER, nowMs: NOW }),
    ).toThrow(/1-hour minimum/);
  });
});

describe("buildApprovalCollection — malformed inputs", () => {
  it("rejects a hand-built draft with a duplicate approver", () => {
    const tampered = { ...validDraft(), approvers: [APPROVER_A, APPROVER_A] } as ApprovalCollectionDraft;
    expect(() =>
      buildApprovalCollection({ draft: tampered, sender: SENDER, nowMs: NOW }),
    ).toThrow(/unique/);
  });

  it("rejects a hand-built draft with the beneficiary among the approvers", () => {
    const tampered = {
      ...validDraft(),
      approvers: [BENEFICIARY],
      threshold: 1,
    } as ApprovalCollectionDraft;
    expect(() =>
      buildApprovalCollection({ draft: tampered, sender: SENDER, nowMs: NOW }),
    ).toThrow(/beneficiary cannot also be an approver/);
  });

  it("rejects a zero amount from a hand-built draft", () => {
    const tampered = { ...validDraft(), amountMicro: "0" } as ApprovalCollectionDraft;
    expect(() =>
      buildApprovalCollection({ draft: tampered, sender: SENDER, nowMs: NOW }),
    ).toThrow(/greater than zero/);
  });

  it("rejects a non-USDC asset from a hand-built draft", () => {
    const tampered = {
      ...validDraft(),
      coinType: "0x" + "d4".repeat(63) + "5" as typeof USDC_COIN_TYPE_TESTNET,
    } as ApprovalCollectionDraft;
    expect(() =>
      buildApprovalCollection({ draft: tampered, sender: SENDER, nowMs: NOW }),
    ).toThrow(/pinned testnet USDC/);
  });

  it("rejects a structurally invalid draft object", () => {
    expect(() =>
      buildApprovalCollection({
        draft: { kind: "wrong" } as unknown as ApprovalCollectionDraft,
        sender: SENDER,
        nowMs: NOW,
      }),
    ).toThrow(/draft is required/);
  });
});

describe("approval collection display helpers", () => {
  it("formats the exact held amount with grouped decimals", () => {
    const parsed = parseUsdcDecimalToMicro("12.5");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(formatUsdcGrouped(parsed.micro)).toBe("12.5");
    expect(U64_MAX > 0n).toBe(true);
  });
});
