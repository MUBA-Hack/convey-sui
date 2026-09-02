import type { CompanionContact, CompanionMemory } from "./memory";

export type ContactResolution =
  | { kind: "unknown" }
  | { kind: "ambiguous"; contactIds: string[]; contacts: CompanionContact[] }
  | { kind: "inferred"; contact: CompanionContact }
  | { kind: "missing_address"; contact: CompanionContact }
  | { kind: "changed_address"; contact: CompanionContact }
  | { kind: "confirmed"; contact: CompanionContact };

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function resolveContact(reference: string, memory: CompanionMemory): ContactResolution {
  const needle = normalize(reference);
  const matches = memory.contacts.filter((contact) =>
    [contact.displayName, ...contact.aliases].some((name) => normalize(name) === needle),
  );

  if (matches.length === 0) return { kind: "unknown" };
  if (matches.length > 1) {
    return { kind: "ambiguous", contactIds: matches.map(({ id }) => id), contacts: matches };
  }

  const contact = matches[0]!;
  if (!contact.address) return { kind: "missing_address", contact };
  if (contact.previousAddress && contact.previousAddress !== contact.address) {
    return { kind: "changed_address", contact };
  }
  if (contact.confirmation !== "confirmed") return { kind: "inferred", contact };
  return { kind: "confirmed", contact };
}
