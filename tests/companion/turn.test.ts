import { describe, expect, it } from "vitest";
import { parseCompanionTurn } from "@/lib/companion/turn";
import { EMPTY_COMPANION_MEMORY } from "@/lib/companion/memory";
import { CompanionMemorySchema } from "@/lib/companion/memory";

const MEMORY = CompanionMemorySchema.parse({
  ...EMPTY_COMPANION_MEMORY,
  contacts: [
    {
      id: "dave",
      displayName: "Dave",
      aliases: ["david"],
      relationshipLabel: "friend",
      address: "0x" + "1".repeat(64),
      previousAddress: null,
      confirmation: "confirmed",
      confirmedAt: 1_700_000_000_000,
    },
  ],
});
describe("parseCompanionTurn", () => {
  it("returns a proposal when the message names a confirmed contact and amount", () => {
    const result = parseCompanionTurn({
      message: "Pay Dave 12 USDC for dinner",
      localeHint: "en",
      memory: MEMORY,
    });
    expect(result.outcome).toBe("proposal");
    expect(result.proposal?.contactLabel).toBe("Dave");
    expect(result.proposal?.amountMajor).toBe("12");
    expect(result.proposal?.asset).toBe("USDC");
  });

  it("asks for clarification when there is no remembered contact", () => {
    const result = parseCompanionTurn({
      message: "Pay 12 USDC for dinner",
      localeHint: "en",
      memory: MEMORY,
    });
    expect(result.outcome).toBe("clarification");
    expect(result.clarification?.missingFields).toContain("contact");
  });

  it("does not propose against an unconfirmed contact", () => {
    const unconfirmed = CompanionMemorySchema.parse({
      ...EMPTY_COMPANION_MEMORY,
      contacts: [
        {
          id: "ana",
          displayName: "Ana",
          aliases: [],
          relationshipLabel: "friend",
          address: "0x" + "2".repeat(64),
          previousAddress: null,
          confirmation: "inferred",
          confirmedAt: null,
        },
      ],
    });
    const result = parseCompanionTurn({
      message: "Pay Ana 15 SUI",
      localeHint: "en",
      memory: unconfirmed,
    });
    expect(result.outcome).toBe("clarification");
    expect(result.clarification?.missingFields).toContain("approval");
  });

  it("routes receipt, protected support, and options requests to bounded tools", () => {
    const split = parseCompanionTurn({ message: "Split this receipt", localeHint: "en", memory: MEMORY });
    const mission = parseCompanionTurn({ message: "Send Ana 25 USDC for medicine, release after pickup evidence", localeHint: "en", memory: MEMORY });
    const protection = parseCompanionTurn({ message: "Protect 500 USDC overnight", localeHint: "en", memory: MEMORY });
    expect(split.toolId).toBe("splits.propose");
    expect(mission.toolId).toBe("missions.propose");
    expect(mission.candidate?.amountMajor).toBe("25");
    expect(mission.candidate?.asset).toBe("USDC");
    expect(protection.toolId).toBe("strategies.propose");
    expect(protection.candidate?.amountMajor).toBe("500");
  });
});
