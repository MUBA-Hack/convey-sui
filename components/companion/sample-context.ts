import type { CompanionMemory } from "@/lib/companion/memory";

export const SAMPLE_COMPANION_MEMORY: CompanionMemory = {
  version: "convey.companion-memory.v1",
  ownerLabel: "You",
  contacts: [
    {
      id: "dave",
      displayName: "Dave",
      aliases: ["David"],
      relationshipLabel: "friend",
      address: `0x${"1".repeat(64)}`,
      previousAddress: null,
      confirmation: "confirmed",
      confirmedAt: 1_788_134_400_000,
    },
  ],
  interactions: [
    {
      id: "sample-dinner",
      contactId: "dave",
      kind: "split",
      summary: "Dinner split",
      occurredAt: 1_788_134_400_000,
    },
  ],
};
