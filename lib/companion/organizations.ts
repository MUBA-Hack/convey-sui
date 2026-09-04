import { z } from "zod";
import type { CompanionWorkspaceId } from "./workspaces";

export const CompanionOrganizationKindSchema = z.enum([
  "ngo",
  "club",
  "business",
  "community",
]);

export const CompanionOrganizationContextSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(2).max(48),
  kind: CompanionOrganizationKindSchema,
  memberRole: z.literal("owner"),
});

const CompanionOrganizationSchema = CompanionOrganizationContextSchema.extend({
  createdAt: z.number().int().nonnegative(),
});

const StoredOrganizationsSchema = z.strictObject({
  version: z.literal("convey.companion-organizations.v1"),
  organizations: z.array(CompanionOrganizationSchema).max(8),
  activeOrganizationId: z.string().max(64).nullable(),
});

export type CompanionOrganizationKind = z.infer<typeof CompanionOrganizationKindSchema>;
export type CompanionOrganizationContext = z.infer<typeof CompanionOrganizationContextSchema>;
export type CompanionOrganization = z.infer<typeof CompanionOrganizationSchema>;

export interface CompanionOrganizationState {
  organizations: CompanionOrganization[];
  activeOrganizationId: string | null;
}

export interface CompanionOrganizationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type CreateOrganizationResult =
  | { ok: true; organization: CompanionOrganization; state: CompanionOrganizationState }
  | { ok: false; reason: "invalid" | "duplicate" | "limit" | "storage" };

export interface CompanionOrganizationStore {
  read(): CompanionOrganizationState;
  create(input: { name: string; kind: CompanionOrganizationKind }): CreateOrganizationResult;
  select(organizationId: string | null): CompanionOrganizationState | null;
}

export const COMPANION_ORGANIZATIONS_STORAGE_KEY = "convey.companion-organizations.v1";
const EMPTY_ORGANIZATION_STATE: CompanionOrganizationState = {
  organizations: [],
  activeOrganizationId: null,
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "organization";
}

function parseState(raw: string | null): CompanionOrganizationState {
  if (raw === null || raw.length > 8_192) return EMPTY_ORGANIZATION_STATE;
  try {
    const parsed = StoredOrganizationsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return EMPTY_ORGANIZATION_STATE;
    const activeExists = parsed.data.activeOrganizationId === null
      || parsed.data.organizations.some((organization) => organization.id === parsed.data.activeOrganizationId);
    return {
      organizations: parsed.data.organizations,
      activeOrganizationId: activeExists ? parsed.data.activeOrganizationId : null,
    };
  } catch {
    return EMPTY_ORGANIZATION_STATE;
  }
}

export function workspaceIdForOrganization(kind: CompanionOrganizationKind): CompanionWorkspaceId {
  return kind === "ngo" ? "ngo" : "treasury";
}

export function organizationKindLabel(kind: CompanionOrganizationKind): string {
  if (kind === "ngo") return "NGO operations";
  if (kind === "club") return "Club treasury";
  if (kind === "business") return "Business treasury";
  return "Community treasury";
}

export function createCompanionOrganizationStore(
  storage: CompanionOrganizationStorage,
  now: () => number = Date.now,
): CompanionOrganizationStore {
  const read = (): CompanionOrganizationState => {
    try {
      return parseState(storage.getItem(COMPANION_ORGANIZATIONS_STORAGE_KEY));
    } catch {
      return EMPTY_ORGANIZATION_STATE;
    }
  };
  const persist = (state: CompanionOrganizationState): boolean => {
    try {
      storage.setItem(COMPANION_ORGANIZATIONS_STORAGE_KEY, JSON.stringify({
        version: "convey.companion-organizations.v1",
        ...state,
      }));
      return true;
    } catch {
      return false;
    }
  };

  return {
    read,
    create(input) {
      const parsed = z.strictObject({
        name: z.string().trim().min(2).max(48),
        kind: CompanionOrganizationKindSchema,
      }).safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid" };

      const current = read();
      if (current.organizations.length >= 8) return { ok: false, reason: "limit" };
      if (current.organizations.some((item) => item.name.toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase())) {
        return { ok: false, reason: "duplicate" };
      }

      const createdAt = now();
      const organization = CompanionOrganizationSchema.parse({
        id: `${slugify(parsed.data.name)}-${createdAt.toString(36)}`.slice(0, 64),
        name: parsed.data.name,
        kind: parsed.data.kind,
        memberRole: "owner",
        createdAt,
      });
      const state = {
        organizations: [...current.organizations, organization],
        activeOrganizationId: organization.id,
      };
      if (!persist(state)) return { ok: false, reason: "storage" };
      return { ok: true, organization, state };
    },
    select(organizationId) {
      const current = read();
      if (organizationId !== null && !current.organizations.some((item) => item.id === organizationId)) {
        return null;
      }
      const state = { ...current, activeOrganizationId: organizationId };
      return persist(state) ? state : null;
    },
  };
}
