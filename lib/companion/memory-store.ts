import {
  CompanionContactSchema,
  CompanionInteractionSchema,
  CompanionMemorySchema,
  EMPTY_COMPANION_MEMORY,
  type CompanionContact,
  type CompanionInteraction,
  type CompanionMemory,
} from "./memory";

export const COMPANION_MEMORY_STORAGE_KEY =
  "convey.companion-memory.v1";

const MAX_RAW_BYTES = 32 * 1024;
const MAX_INTERACTIONS = 20;
const SUI_ADDRESS_REGEX = /^0x[0-9a-f]{64}$/;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type MemoryWriteResult =
  | {
      ok: true;
      memory: CompanionMemory;
    }
  | {
      ok: false;
      code:
        | "invalid"
        | "duplicate"
        | "address_changed"
        | "not_found";
    };

export interface CompanionMemoryStore {
  read(): CompanionMemory;

  rememberContact(
    input: CompanionContact,
  ): MemoryWriteResult;

  confirmContact(input: {
    contactId: string;
    address: string;
    confirmedAt: number;
  }): MemoryWriteResult;

  recordInteraction(
    input: CompanionInteraction,
  ): MemoryWriteResult;

  forgetContact(
    contactId: string,
  ): MemoryWriteResult;

  clearAll(): MemoryWriteResult;
}

function rawByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasUniqueIds(
  memory: CompanionMemory,
): boolean {
  const contactIds = new Set(
    memory.contacts.map(
      (contact) => contact.id,
    ),
  );

  const interactionIds = new Set(
    memory.interactions.map(
      (interaction) => interaction.id,
    ),
  );

  return (
    contactIds.size ===
      memory.contacts.length &&
    interactionIds.size ===
      memory.interactions.length
  );
}

function parseStoredMemory(
  raw: string | null,
): CompanionMemory {
  if (raw === null) {
    return EMPTY_COMPANION_MEMORY;
  }

  if (rawByteLength(raw) > MAX_RAW_BYTES) {
    return EMPTY_COMPANION_MEMORY;
  }

  try {
    const candidate: unknown =
      JSON.parse(raw);

    const parsed =
      CompanionMemorySchema.safeParse(
        candidate,
      );

    if (!parsed.success) {
      return EMPTY_COMPANION_MEMORY;
    }

    if (!hasUniqueIds(parsed.data)) {
      return EMPTY_COMPANION_MEMORY;
    }

    return parsed.data;
  } catch {
    return EMPTY_COMPANION_MEMORY;
  }
}

function persistMemory(
  storage: KeyValueStorage,
  memory: CompanionMemory,
): MemoryWriteResult {
  const parsed =
    CompanionMemorySchema.safeParse(memory);

  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid",
    };
  }

  if (!hasUniqueIds(parsed.data)) {
    return {
      ok: false,
      code: "duplicate",
    };
  }

  const serialized = JSON.stringify(
    parsed.data,
  );

  if (
    rawByteLength(serialized) >
    MAX_RAW_BYTES
  ) {
    return {
      ok: false,
      code: "invalid",
    };
  }

  try {
    storage.setItem(
      COMPANION_MEMORY_STORAGE_KEY,
      serialized,
    );

    return {
      ok: true,
      memory: parsed.data,
    };
  } catch {
    return {
      ok: false,
      code: "invalid",
    };
  }
}

export function createCompanionMemoryStore(
  storage: KeyValueStorage,
): CompanionMemoryStore {
  return {
    read(): CompanionMemory {
      try {
        const raw = storage.getItem(
          COMPANION_MEMORY_STORAGE_KEY,
        );

        return parseStoredMemory(raw);
      } catch {
        return EMPTY_COMPANION_MEMORY;
      }
    },

    rememberContact(
      input: CompanionContact,
    ): MemoryWriteResult {
      const parsedContact =
        CompanionContactSchema.safeParse(
          input,
        );

      if (!parsedContact.success) {
        return {
          ok: false,
          code: "invalid",
        };
      }

      const current = this.read();

      const duplicate =
        current.contacts.some(
          (contact) =>
            contact.id ===
            parsedContact.data.id,
        );

      if (duplicate) {
        return {
          ok: false,
          code: "duplicate",
        };
      }

      const nextMemory: CompanionMemory = {
        ...current,
        contacts: [
          ...current.contacts,
          parsedContact.data,
        ],
      };

      return persistMemory(
        storage,
        nextMemory,
      );
    },

    confirmContact(
      input,
    ): MemoryWriteResult {
      const {
        contactId,
        address,
        confirmedAt,
      } = input;

      if (
        !contactId ||
        !SUI_ADDRESS_REGEX.test(address) ||
        !Number.isInteger(confirmedAt) ||
        confirmedAt < 0
      ) {
        return {
          ok: false,
          code: "invalid",
        };
      }

      const current = this.read();

      const contactIndex =
        current.contacts.findIndex(
          (contact) =>
            contact.id === contactId,
        );

      if (contactIndex === -1) {
        return {
          ok: false,
          code: "not_found",
        };
      }

      const existingContact =
        current.contacts[contactIndex];

      // TypeScript safety guard:
      // even though findIndex succeeded, prove that
      // the array item exists before using it.
      if (!existingContact) {
        return {
          ok: false,
          code: "not_found",
        };
      }

      if (
        existingContact.confirmation ===
          "confirmed" &&
        existingContact.address !== null &&
        existingContact.address !== address
      ) {
        return {
          ok: false,
          code: "address_changed",
        };
      }

      const updatedContact: CompanionContact =
        {
          ...existingContact,
          address,
          confirmation: "confirmed",
          confirmedAt,
        };

      const nextContacts = [
        ...current.contacts,
      ];

      nextContacts[contactIndex] =
        updatedContact;

      const nextMemory: CompanionMemory = {
        ...current,
        contacts: nextContacts,
      };

      return persistMemory(
        storage,
        nextMemory,
      );
    },

    recordInteraction(
      input: CompanionInteraction,
    ): MemoryWriteResult {
      const parsedInteraction =
        CompanionInteractionSchema.safeParse(
          input,
        );

      if (!parsedInteraction.success) {
        return {
          ok: false,
          code: "invalid",
        };
      }

      const current = this.read();

      const contactExists =
        current.contacts.some(
          (contact) =>
            contact.id ===
            parsedInteraction.data.contactId,
        );

      if (!contactExists) {
        return {
          ok: false,
          code: "not_found",
        };
      }

      const duplicate =
        current.interactions.some(
          (interaction) =>
            interaction.id ===
            parsedInteraction.data.id,
        );

      if (duplicate) {
        return {
          ok: false,
          code: "duplicate",
        };
      }

      const nextInteractions = [
        ...current.interactions,
        parsedInteraction.data,
      ]
        .sort(
          (a, b) =>
            b.occurredAt -
            a.occurredAt,
        )
        .slice(0, MAX_INTERACTIONS);

      const nextMemory: CompanionMemory = {
        ...current,
        interactions:
          nextInteractions,
      };

      return persistMemory(
        storage,
        nextMemory,
      );
    },

    forgetContact(
      contactId: string,
    ): MemoryWriteResult {
      if (!contactId) {
        return {
          ok: false,
          code: "invalid",
        };
      }

      const current = this.read();

      const contactExists =
        current.contacts.some(
          (contact) =>
            contact.id === contactId,
        );

      if (!contactExists) {
        return {
          ok: false,
          code: "not_found",
        };
      }

      const nextMemory: CompanionMemory = {
        ...current,

        contacts:
          current.contacts.filter(
            (contact) =>
              contact.id !== contactId,
          ),

        interactions:
          current.interactions.filter(
            (interaction) =>
              interaction.contactId !==
              contactId,
          ),
      };

      return persistMemory(
        storage,
        nextMemory,
      );
    },

    clearAll(): MemoryWriteResult {
      try {
        storage.removeItem(
          COMPANION_MEMORY_STORAGE_KEY,
        );

        return {
          ok: true,
          memory:
            EMPTY_COMPANION_MEMORY,
        };
      } catch {
        return {
          ok: false,
          code: "invalid",
        };
      }
    },
  };
}