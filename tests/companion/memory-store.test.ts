import { describe, expect, it } from "vitest";
import {
  COMPANION_MEMORY_STORAGE_KEY,
  createCompanionMemoryStore,
  type KeyValueStorage,
} from "@/lib/companion/memory-store";
import {
  EMPTY_COMPANION_MEMORY,
  type CompanionContact,
  type CompanionInteraction,
} from "@/lib/companion/memory";

function createFakeStorage(): KeyValueStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,

    setItem: (key, value) => {
      values.set(key, value);
    },

    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function createContact(
  overrides: Partial<CompanionContact> = {},
): CompanionContact {
  return {
    id: "contact-dave",
    displayName: "Dave Lim",
    aliases: ["Dave"],
    relationshipLabel: "friend",
    address: null,
    previousAddress: null,
    confirmation: "inferred",
    confirmedAt: null,
    ...overrides,
  };
}

function createInteraction(
  overrides: Partial<CompanionInteraction> = {},
): CompanionInteraction {
  return {
    id: "interaction-1",
    contactId: "contact-dave",
    kind: "payment",
    summary: "Paid Dave for dinner",
    occurredAt: 1000,
    ...overrides,
  };
}

const ADDRESS_A = `0x${"a".repeat(64)}`;
const ADDRESS_B = `0x${"b".repeat(64)}`;

describe("CompanionMemoryStore", () => {
  it("returns empty memory when storage is empty", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(store.read()).toEqual(EMPTY_COMPANION_MEMORY);
  });

  it("returns empty memory for malformed JSON", () => {
    const storage = createFakeStorage();

    storage.setItem(
      COMPANION_MEMORY_STORAGE_KEY,
      "{not valid json",
    );

    const store = createCompanionMemoryStore(storage);

    expect(store.read()).toEqual(EMPTY_COMPANION_MEMORY);
  });

  it("returns empty memory for the wrong version", () => {
    const storage = createFakeStorage();

    storage.setItem(
      COMPANION_MEMORY_STORAGE_KEY,
      JSON.stringify({
        version: "convey.companion-memory.v999",
        ownerLabel: null,
        contacts: [],
        interactions: [],
      }),
    );

    const store = createCompanionMemoryStore(storage);

    expect(store.read()).toEqual(EMPTY_COMPANION_MEMORY);
  });

  it("returns empty memory for raw storage larger than 32 KiB", () => {
    const storage = createFakeStorage();

    storage.setItem(
      COMPANION_MEMORY_STORAGE_KEY,
      "x".repeat(33 * 1024),
    );

    const store = createCompanionMemoryStore(storage);

    expect(store.read()).toEqual(EMPTY_COMPANION_MEMORY);
  });

  it("reads valid stored memory", () => {
    const storage = createFakeStorage();

    storage.setItem(
      COMPANION_MEMORY_STORAGE_KEY,
      JSON.stringify({
        version: "convey.companion-memory.v1",
        ownerLabel: null,
        contacts: [],
        interactions: [],
      }),
    );

    const store = createCompanionMemoryStore(storage);

    expect(store.read()).toEqual(EMPTY_COMPANION_MEMORY);
  });

  it("returns empty memory when stored contact IDs are duplicated", () => {
    const storage = createFakeStorage();

    const duplicateContact = createContact();

    storage.setItem(
      COMPANION_MEMORY_STORAGE_KEY,
      JSON.stringify({
        version: "convey.companion-memory.v1",
        ownerLabel: null,
        contacts: [
          duplicateContact,
          {
            ...duplicateContact,
            displayName: "Another Dave",
          },
        ],
        interactions: [],
      }),
    );

    const store = createCompanionMemoryStore(storage);

    expect(store.read()).toEqual(EMPTY_COMPANION_MEMORY);
  });

  it("remembers a valid contact", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);
    const contact = createContact();

    const result = store.rememberContact(contact);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.memory.contacts).toEqual([contact]);
    }

    expect(store.read().contacts).toEqual([contact]);
  });

  it("rejects duplicate contact IDs", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);
    const contact = createContact();

    expect(store.rememberContact(contact).ok).toBe(true);

    const duplicate = store.rememberContact({
      ...contact,
      displayName: "Another Dave",
    });

    expect(duplicate).toEqual({
      ok: false,
      code: "duplicate",
    });

    expect(store.read().contacts).toHaveLength(1);
  });

  it("keeps two people with the same name separate", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    const firstDave = createContact({
      id: "dave-1",
      displayName: "Dave",
    });

    const secondDave = createContact({
      id: "dave-2",
      displayName: "Dave",
    });

    expect(store.rememberContact(firstDave).ok).toBe(true);
    expect(store.rememberContact(secondDave).ok).toBe(true);

    const memory = store.read();

    expect(memory.contacts).toHaveLength(2);

    expect(
      memory.contacts.map((contact) => contact.id),
    ).toEqual(["dave-1", "dave-2"]);
  });

  it("rejects the 21st contact", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    for (let index = 1; index <= 20; index += 1) {
      const result = store.rememberContact(
        createContact({
          id: `contact-${index}`,
          displayName: `Contact ${index}`,
          aliases: [`Contact${index}`],
        }),
      );

      expect(result.ok).toBe(true);
    }

    const twentyFirst = store.rememberContact(
      createContact({
        id: "contact-21",
        displayName: "Contact 21",
        aliases: ["Contact21"],
      }),
    );

    expect(twentyFirst).toEqual({
      ok: false,
      code: "invalid",
    });

    expect(store.read().contacts).toHaveLength(20);
  });

  it("rejects extra secret fields on a contact", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    const unsafeContact = {
      ...createContact(),
      apiKey: "secret-value",
    };

    const result = store.rememberContact(
      unsafeContact as CompanionContact,
    );

    expect(result).toEqual({
      ok: false,
      code: "invalid",
    });

    expect(store.read()).toEqual(EMPTY_COMPANION_MEMORY);
  });

  it("rejects extra raw transcript fields on an interaction", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    const unsafeInteraction = {
      ...createInteraction(),
      transcript: "full conversation should never be stored",
    };

    const result = store.recordInteraction(
      unsafeInteraction as CompanionInteraction,
    );

    expect(result).toEqual({
      ok: false,
      code: "invalid",
    });

    expect(store.read().interactions).toHaveLength(0);
  });

  it("rejects forbidden receipt, medical, and scam fields", () => {
    const forbiddenContacts = [
      {
        ...createContact(),
        rawReceiptImage: "base64-image-data",
      },
      {
        ...createContact(),
        medicalDocument: "private medical text",
      },
      {
        ...createContact(),
        scamLabel: "scammer",
      },
    ];

    for (const candidate of forbiddenContacts) {
      const storage = createFakeStorage();
      const store = createCompanionMemoryStore(storage);

      const result = store.rememberContact(
        candidate as CompanionContact,
      );

      expect(result).toEqual({
        ok: false,
        code: "invalid",
      });

      expect(store.read()).toEqual(
        EMPTY_COMPANION_MEMORY,
      );
    }
  });

  it("confirms a contact with a valid Sui address", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    const result = store.confirmContact({
      contactId: "contact-dave",
      address: ADDRESS_A,
      confirmedAt: 1000,
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.memory.contacts[0]).toMatchObject({
        id: "contact-dave",
        address: ADDRESS_A,
        confirmation: "confirmed",
        confirmedAt: 1000,
      });
    }
  });

  it("rejects confirmation for an unknown contact", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    const result = store.confirmContact({
      contactId: "missing-contact",
      address: ADDRESS_A,
      confirmedAt: 1000,
    });

    expect(result).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("rejects an invalid Sui address", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    const result = store.confirmContact({
      contactId: "contact-dave",
      address: "0x1234",
      confirmedAt: 1000,
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("does not silently overwrite a confirmed address", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(
        createContact({
          address: ADDRESS_A,
          confirmation: "confirmed",
          confirmedAt: 1000,
        }),
      ).ok,
    ).toBe(true);

    const result = store.confirmContact({
      contactId: "contact-dave",
      address: ADDRESS_B,
      confirmedAt: 2000,
    });

    expect(result).toEqual({
      ok: false,
      code: "address_changed",
    });

    const storedContact = store.read().contacts[0];

    expect(storedContact).toBeDefined();

    if (!storedContact) {
      throw new Error("Expected stored contact");
    }

    expect(storedContact.address).toBe(ADDRESS_A);
    expect(storedContact.confirmedAt).toBe(1000);
  });

  it("records a valid interaction", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    const interaction = createInteraction();

    const result =
      store.recordInteraction(interaction);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.memory.interactions).toEqual([
        interaction,
      ]);
    }

    expect(store.read().interactions).toEqual([
      interaction,
    ]);
  });

  it("rejects an interaction for an unknown contact", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    const result = store.recordInteraction(
      createInteraction({
        contactId: "missing-contact",
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("rejects duplicate interaction IDs", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    const interaction = createInteraction();

    expect(
      store.recordInteraction(interaction).ok,
    ).toBe(true);

    const duplicate =
      store.recordInteraction({
        ...interaction,
        occurredAt: 2000,
      });

    expect(duplicate).toEqual({
      ok: false,
      code: "duplicate",
    });

    expect(store.read().interactions).toHaveLength(1);
  });

  it("stores interactions newest first", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    expect(
      store.recordInteraction(
        createInteraction({
          id: "older",
          occurredAt: 1000,
        }),
      ).ok,
    ).toBe(true);

    expect(
      store.recordInteraction(
        createInteraction({
          id: "newer",
          occurredAt: 2000,
        }),
      ).ok,
    ).toBe(true);

    expect(
      store
        .read()
        .interactions.map(
          (interaction) => interaction.id,
        ),
    ).toEqual(["newer", "older"]);
  });

  it("keeps only the newest 20 interactions", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    for (
      let index = 1;
      index <= 21;
      index += 1
    ) {
      expect(
        store.recordInteraction(
          createInteraction({
            id: `interaction-${index}`,
            occurredAt: index,
          }),
        ).ok,
      ).toBe(true);
    }

    const interactions =
      store.read().interactions;

    expect(interactions).toHaveLength(20);

    const newestInteraction = interactions[0];

    expect(newestInteraction).toBeDefined();

    if (!newestInteraction) {
      throw new Error("Expected newest interaction");
    }

    expect(newestInteraction.id).toBe(
      "interaction-21",
    );

    expect(
      interactions.some(
        (interaction) =>
          interaction.id ===
          "interaction-1",
      ),
    ).toBe(false);
  });

  it("forgets a contact and removes its interactions", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    expect(
      store.recordInteraction(
        createInteraction({
          id: "interaction-for-dave",
        }),
      ).ok,
    ).toBe(true);

    const result =
      store.forgetContact("contact-dave");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(
        result.memory.contacts,
      ).toHaveLength(0);

      expect(
        result.memory.interactions,
      ).toHaveLength(0);
    }

    expect(
      store.read().contacts,
    ).toHaveLength(0);

    expect(
      store.read().interactions,
    ).toHaveLength(0);
  });

  it("rejects forgetting an unknown contact", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    const result =
      store.forgetContact("missing-contact");

    expect(result).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("clears all memory", () => {
    const storage = createFakeStorage();
    const store = createCompanionMemoryStore(storage);

    expect(
      store.rememberContact(createContact()).ok,
    ).toBe(true);

    const result = store.clearAll();

    expect(result).toEqual({
      ok: true,
      memory: EMPTY_COMPANION_MEMORY,
    });

    expect(store.read()).toEqual(
      EMPTY_COMPANION_MEMORY,
    );
  });

  it("clear all survives a new store instance", () => {
    const storage = createFakeStorage();

    const firstStore =
      createCompanionMemoryStore(storage);

    expect(
      firstStore.rememberContact(
        createContact(),
      ).ok,
    ).toBe(true);

    expect(firstStore.clearAll().ok).toBe(
      true,
    );

    const secondStore =
      createCompanionMemoryStore(storage);

    expect(secondStore.read()).toEqual(
      EMPTY_COMPANION_MEMORY,
    );
  });
});