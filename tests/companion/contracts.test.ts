import { describe, expect, it } from "vitest";
import {
  CompanionInputSchema,
  CompanionProposalSchema,
} from "@/lib/companion/contracts";
import { CompanionMemorySchema } from "@/lib/companion/memory";

const DAVE = `0x${"1".repeat(64)}`;

describe("companion contracts", () => {
  it("accepts a bounded, inspectable memory snapshot", () => {
    const result = CompanionMemorySchema.safeParse({
      version: "convey.companion-memory.v1",
      ownerLabel: null,
      contacts: [{
        id: "contact_dave",
        displayName: "Dave",
        aliases: ["David"],
        relationshipLabel: "Friend",
        address: DAVE,
        previousAddress: null,
        confirmation: "confirmed",
        confirmedAt: 1_788_249_600_000,
      }],
      interactions: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown request fields and non-canonical addresses", () => {
    expect(CompanionInputSchema.safeParse({
      message: "Pay Dave 6 SUI",
      localeHint: "en-MY",
      memory: {
        version: "convey.companion-memory.v1",
        ownerLabel: null,
        contacts: [],
        interactions: [],
      },
      execute: true,
    }).success).toBe(false);

    expect(CompanionMemorySchema.safeParse({
      version: "convey.companion-memory.v1",
      ownerLabel: null,
      contacts: [{
        id: "contact_dave",
        displayName: "Dave",
        aliases: [],
        relationshipLabel: null,
        address: "0x1234",
        previousAddress: null,
        confirmation: "confirmed",
        confirmedAt: 1,
      }],
      interactions: [],
    }).success).toBe(false);
  });

  it("accepts only known workspace routing context", () => {
    const base = {
      message: "Pay Dave 6 SUI",
      localeHint: "en-MY",
      memory: {
        version: "convey.companion-memory.v1" as const,
        ownerLabel: null,
        contacts: [],
        interactions: [],
      },
    };

    expect(CompanionInputSchema.safeParse({ ...base, workspaceId: "ngo" }).success).toBe(true);
    expect(CompanionInputSchema.safeParse({ ...base, workspaceId: "relief" }).success).toBe(false);
    expect(CompanionInputSchema.safeParse({ ...base, workspaceId: "admin" }).success).toBe(false);
  });

  it("requires every payment proposal to remain approval-gated", () => {
    const proposal = {
      toolId: "payments.propose",
      contactId: "contact_dave",
      contactLabel: "Dave",
      amountMajor: "6",
      asset: "SUI",
      purpose: "coffee",
      requiresUserApproval: false,
    };

    expect(CompanionProposalSchema.safeParse(proposal).success).toBe(false);
  });
});
