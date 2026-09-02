import { describe, expect, it } from "vitest";
import {
  ReceiptExtractionCandidateSchema,
  ReceiptObligationSchema,
  applyObligationEvent,
  createReceiptObligationDraft,
  resolveReceiptParticipant,
} from "@/lib/companion/receipt-obligations";

const candidate = {
  version: "convey.receipt-candidate.v1" as const,
  sourceId: "capture_01",
  merchantLabel: "River Cafe",
  currency: "USDC" as const,
  items: [
    { id: "coffee", label: "Coffee", amountMicro: "6000000" },
    { id: "cake", label: "Cake", amountMicro: "3000000" },
  ],
  subtotalMicro: "9000000",
  taxMicro: "900000",
  serviceMicro: "450000",
  totalMicro: "10350000",
  confidence: 0.93,
  requiresUserConfirmation: true as const,
};

describe("receipt obligation candidates", () => {
  it("rejects raw image data and candidates that pretend confirmation already happened", () => {
    expect(ReceiptExtractionCandidateSchema.safeParse({
      ...candidate,
      rawImage: "data:image/png;base64,secret",
    }).success).toBe(false);

    expect(ReceiptExtractionCandidateSchema.safeParse({
      ...candidate,
      requiresUserConfirmation: false,
    }).success).toBe(false);
  });

  it("fails closed when receipt arithmetic does not reconcile", () => {
    expect(() => createReceiptObligationDraft({
      candidate: { ...candidate, totalMicro: "9999999" },
      participants: [
        { id: "ana", displayName: "Ana" },
        { id: "dave", displayName: "Dave" },
      ],
      assignments: [
        { itemId: "coffee", participantIds: ["ana", "dave"] },
        { itemId: "cake", participantIds: ["ana"] },
      ],
      userConfirmedCandidate: true,
    })).toThrow("Receipt totals do not reconcile");
  });

  it("requires explicit user confirmation before producing obligations", () => {
    expect(() => createReceiptObligationDraft({
      candidate,
      participants: [
        { id: "ana", displayName: "Ana" },
        { id: "dave", displayName: "Dave" },
      ],
      assignments: [
        { itemId: "coffee", participantIds: ["ana", "dave"] },
        { itemId: "cake", participantIds: ["ana"] },
      ],
      userConfirmedCandidate: false,
    })).toThrow("Receipt candidate must be confirmed");
  });
});

describe("receipt obligation allocation", () => {
  it("allocates shared items, tax, service, and remainder deterministically", () => {
    const draft = createReceiptObligationDraft({
      candidate,
      participants: [
        { id: "ana", displayName: "Ana" },
        { id: "dave", displayName: "Dave" },
      ],
      assignments: [
        { itemId: "coffee", participantIds: ["ana", "dave"] },
        { itemId: "cake", participantIds: ["ana"] },
      ],
      userConfirmedCandidate: true,
    });

    expect(draft.obligations).toEqual([
      {
        id: "capture_01:ana",
        participantId: "ana",
        participantLabel: "Ana",
        currency: "USDC",
        itemSubtotalMicro: "6000000",
        taxMicro: "450000",
        serviceMicro: "225000",
        amountMicro: "6675000",
        state: "draft",
        transactionDigest: null,
      },
      {
        id: "capture_01:dave",
        participantId: "dave",
        participantLabel: "Dave",
        currency: "USDC",
        itemSubtotalMicro: "3000000",
        taxMicro: "450000",
        serviceMicro: "225000",
        amountMicro: "3675000",
        state: "draft",
        transactionDigest: null,
      },
    ]);
    expect(draft.totalAllocatedMicro).toBe(candidate.totalMicro);
  });

  it("distributes odd minor-unit remainders in stable participant order", () => {
    const draft = createReceiptObligationDraft({
      candidate: {
        ...candidate,
        items: [{ id: "shared", label: "Shared", amountMicro: "5" }],
        subtotalMicro: "5",
        taxMicro: "1",
        serviceMicro: "1",
        totalMicro: "7",
      },
      participants: [
        { id: "a", displayName: "A" },
        { id: "b", displayName: "B" },
      ],
      assignments: [{ itemId: "shared", participantIds: ["a", "b"] }],
      userConfirmedCandidate: true,
    });

    expect(draft.obligations.map((entry) => entry.amountMicro)).toEqual(["5", "2"]);
    expect(draft.totalAllocatedMicro).toBe("7");
  });

  it("rejects missing item assignments", () => {
    expect(() => createReceiptObligationDraft({
      candidate,
      participants: [{ id: "ana", displayName: "Ana" }],
      assignments: [{ itemId: "coffee", participantIds: ["ana"] }],
      userConfirmedCandidate: true,
    })).toThrow("Every receipt item must be assigned");
  });

  it("rejects unknown participant selections", () => {
    expect(() => createReceiptObligationDraft({
      candidate,
      participants: [{ id: "ana", displayName: "Ana" }],
      assignments: [{ itemId: "coffee", participantIds: ["unknown"] }],
      userConfirmedCandidate: true,
    })).toThrow();
  });
});

describe("receipt participant resolution", () => {
  it("requires an explicit participant id when normalized names collide", () => {
    const participants = [
      { id: "dave_home", displayName: "Dave" },
      { id: "dave_work", displayName: " dave " },
      { id: "ana", displayName: "Ana" },
    ];

    expect(resolveReceiptParticipant("Dave", participants)).toEqual({
      outcome: "ambiguous",
      participantIds: ["dave_home", "dave_work"],
    });
    expect(resolveReceiptParticipant("Ana", participants)).toEqual({
      outcome: "resolved",
      participantId: "ana",
    });
    expect(resolveReceiptParticipant("Sam", participants)).toEqual({ outcome: "missing" });
  });
});

describe("receipt obligation lifecycle", () => {
  const obligation = {
    id: "capture_01:ana",
    participantId: "ana",
    participantLabel: "Ana",
    currency: "USDC" as const,
    itemSubtotalMicro: "6000000",
    taxMicro: "450000",
    serviceMicro: "225000",
    amountMicro: "6675000",
    state: "draft" as const,
    transactionDigest: null,
  };

  it("supports the explicit request and independently verified settlement path", () => {
    const confirmed = applyObligationEvent(obligation, { type: "confirm" });
    const requested = applyObligationEvent(confirmed, { type: "request" });
    const submitted = applyObligationEvent(requested, {
      type: "submit",
      transactionDigest: "tx_123",
    });
    const settled = applyObligationEvent(submitted, {
      type: "verify_settlement",
      independentlyVerified: true,
    });

    expect(settled.state).toBe("settled");
    expect(settled.transactionDigest).toBe("tx_123");
  });

  it("never treats chat acknowledgement as payment", () => {
    const requested = { ...obligation, state: "requested" as const };
    expect(applyObligationEvent(requested, { type: "chat_acknowledged" })).toEqual(requested);
  });

  it("fails closed on unverified settlement and invalid transitions", () => {
    const submitted = {
      ...obligation,
      state: "submitted" as const,
      transactionDigest: "tx_123",
    };

    expect(() => applyObligationEvent(submitted, {
      type: "verify_settlement",
      independentlyVerified: false,
    })).toThrow("Settlement must be independently verified");
    expect(() => applyObligationEvent(obligation, { type: "request" })).toThrow("Invalid obligation transition");
  });

  it("validates authorization-bearing events at runtime", () => {
    const submitted = {
      ...obligation,
      state: "submitted" as const,
      transactionDigest: "tx_123",
    };

    expect(() => applyObligationEvent(submitted, {
      type: "verify_settlement",
      independentlyVerified: "false",
    } as never)).toThrow();
  });

  it("requires transaction evidence for submitted and settled states", () => {
    expect(ReceiptObligationSchema.safeParse({
      ...obligation,
      state: "submitted",
      transactionDigest: null,
    }).success).toBe(false);
    expect(ReceiptObligationSchema.safeParse({
      ...obligation,
      state: "settled",
      transactionDigest: null,
    }).success).toBe(false);
    expect(ReceiptObligationSchema.safeParse({
      ...obligation,
      participantLabel: "   ",
    }).success).toBe(false);
  });

  it.each([
    ["dispute", "disputed"],
    ["cancel", "cancelled"],
    ["expire", "expired"],
  ] as const)("supports %s as an explicit terminal event", (event, state) => {
    expect(applyObligationEvent(obligation, { type: event }).state).toBe(state);
  });
});
