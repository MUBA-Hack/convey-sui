import { z } from "zod";

export const PROTECTED_AGREEMENT_STORE_KEY = "convey.protected-agreements.v1";
const MAX_ARTIFACTS = 20;
const MAX_CANONICAL_BYTES = 16 * 1024;

const ProtectedAgreementArtifactSchema = z.strictObject({
  version: z.literal("convey.protected-agreement-artifact.v1"),
  commitmentHex: z.string().regex(/^0x[0-9a-f]{64}$/),
  canonicalEncoding: z.string().min(2).max(MAX_CANONICAL_BYTES),
  createdDigest: z.string().min(1).max(120),
  storedAt: z.number().int().finite().safe(),
});

const ProtectedAgreementArtifactListSchema = z
  .array(ProtectedAgreementArtifactSchema)
  .max(MAX_ARTIFACTS);

export type ProtectedAgreementArtifact = z.infer<
  typeof ProtectedAgreementArtifactSchema
>;

export interface ProtectedAgreementStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): ProtectedAgreementStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function listProtectedAgreementArtifacts(
  storage: ProtectedAgreementStorage | null = browserStorage(),
): ProtectedAgreementArtifact[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PROTECTED_AGREEMENT_STORE_KEY);
    if (!raw) return [];
    const parsed = ProtectedAgreementArtifactListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function storeProtectedAgreementArtifact(
  input: Omit<ProtectedAgreementArtifact, "version">,
  storage: ProtectedAgreementStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const artifact = ProtectedAgreementArtifactSchema.parse({
      version: "convey.protected-agreement-artifact.v1",
      ...input,
    });
    const current = listProtectedAgreementArtifacts(storage).filter(
      (item) => item.commitmentHex !== artifact.commitmentHex,
    );
    const next = [artifact, ...current].slice(0, MAX_ARTIFACTS);
    storage.setItem(PROTECTED_AGREEMENT_STORE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
