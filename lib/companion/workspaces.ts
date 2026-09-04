import { z } from "zod";

export const CompanionWorkspaceIdSchema = z.enum([
  "personal",
  "ngo",
  "treasury",
]);

export type CompanionWorkspaceId = z.infer<typeof CompanionWorkspaceIdSchema>;

export const DEFAULT_COMPANION_WORKSPACE_ID: CompanionWorkspaceId = "personal";
export const COMPANION_WORKSPACE_STORAGE_KEY = "convey.companion-workspace.v1";

export const COMPANION_WORKSPACES = [
  {
    id: "personal",
    label: "Personal",
    role: "Your money",
    description: "Pay, split, protect, and remember people.",
    welcome: "I’m ready. Tell me what should happen with your money.",
  },
  {
    id: "ngo",
    label: "NGO operations",
    role: "Aid operations",
    description: "Review field evidence, release aid, and show donor outcomes.",
    welcome: "I’m ready. Describe what the NGO should fund, verify, collect, or release.",
  },
  {
    id: "treasury",
    label: "Club treasury",
    role: "Shared approvals",
    description: "Collect dues, reimburse members, and protect reserves.",
    welcome: "I’m ready. Describe what the club should collect, reimburse, protect, or release.",
  },
] as const;

const StoredCompanionWorkspaceSchema = z.strictObject({
  version: z.literal("convey.companion-workspace.v1"),
  workspaceId: CompanionWorkspaceIdSchema,
});

export interface CompanionWorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CompanionWorkspaceStore {
  read(): CompanionWorkspaceId;
  write(workspaceId: CompanionWorkspaceId): boolean;
}

export function getCompanionWorkspace(workspaceId: CompanionWorkspaceId) {
  return COMPANION_WORKSPACES.find((workspace) => workspace.id === workspaceId)
    ?? COMPANION_WORKSPACES[0];
}

export function createCompanionWorkspaceStore(
  storage: CompanionWorkspaceStorage,
): CompanionWorkspaceStore {
  return {
    read() {
      try {
        const raw = storage.getItem(COMPANION_WORKSPACE_STORAGE_KEY);
        if (raw === null || raw.length > 256) return DEFAULT_COMPANION_WORKSPACE_ID;

        const parsed = StoredCompanionWorkspaceSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data.workspaceId : DEFAULT_COMPANION_WORKSPACE_ID;
      } catch {
        return DEFAULT_COMPANION_WORKSPACE_ID;
      }
    },
    write(workspaceId) {
      const parsed = CompanionWorkspaceIdSchema.safeParse(workspaceId);
      if (!parsed.success) return false;

      try {
        storage.setItem(
          COMPANION_WORKSPACE_STORAGE_KEY,
          JSON.stringify({
            version: "convey.companion-workspace.v1",
            workspaceId: parsed.data,
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
