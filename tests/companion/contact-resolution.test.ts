import { describe, expect, it } from "vitest";
import { resolveContact } from "@/lib/companion/contact-resolution";
import type { CompanionMemory } from "@/lib/companion/contracts";

const address = (digit: string) => `0x${digit.repeat(64)}` as const;

function memory(contacts: CompanionMemory["contacts"]): CompanionMemory {
  return { version: "convey.companion-memory.v1", contacts, interactions: [] };
}

describe("resolveContact", () => {
  it("matches a confirmed alias without exposing address during interpretation", () => {
    const result = resolveContact("David", memory([{
      id: "contact_dave",
      displayName: "Dave",
      aliases: ["David"],
      relationshipLabel: "Friend",
      address: address("1"),
      previousAddress: null,
      confirmation: "confirmed",
      confirmedAt: 1,
    }]));

    expect(result).toMatchObject({ kind: "confirmed", contact: { id: "contact_dave" } });
  });

  it("fails closed when two contacts share the same name", () => {
    const base = {
      aliases: [] as string[], relationshipLabel: null, previousAddress: null,
      confirmation: "confirmed" as const, confirmedAt: 1,
    };
    const result = resolveContact("Dave", memory([
      { ...base, id: "dave_work", displayName: "Dave", address: address("1") },
      { ...base, id: "dave_club", displayName: "Dave", address: address("2") },
    ]));

    expect(result).toMatchObject({ kind: "ambiguous", contactIds: ["dave_work", "dave_club"] });
  });

  it("requires reconfirmation after an address change", () => {
    const result = resolveContact("Dave", memory([{
      id: "contact_dave", displayName: "Dave", aliases: [], relationshipLabel: "Friend",
      address: address("2"), previousAddress: address("1"), confirmation: "confirmed", confirmedAt: 1,
    }]));

    expect(result).toMatchObject({ kind: "changed_address", contact: { id: "contact_dave" } });
  });
});
