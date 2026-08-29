/**
 * GonkaRouter commerce intent router — public exports for route integration.
 *
 * Server-only. Importing this module from client code is a boundary violation;
 * the route layer (phase 2) is the only intended consumer.
 */

export {
  createGonkaCommerceRouter,
  gonkaConfigFromEnv,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS,
  extractJsonObject,
} from "./adapter";

export {
  gonkaIntentInputSchema,
  gonkaCatalogManifestSchema,
  gonkaIntentCandidateSchema,
  validateCandidateAgainstManifest,
  MAX_PROMPT_BYTES,
  MAX_LOCALE_BYTES,
  MAX_CATALOG_MERCHANTS,
  MAX_CATALOG_ITEMS,
  MAX_ID_BYTES,
  MAX_NAME_BYTES,
  MAX_LANGUAGE_BYTES,
  MAX_EXPLANATION_BYTES,
  MAX_QUANTITY,
  MAX_SPEND_SUI_BYTES,
} from "./schemas";

export {
  runWithVisibleRetry,
  VisibleRetryError,
  isRetryableGonkaError,
  isGonkaTimeoutError,
  getGonkaErrorStatus,
} from "./retry";

export type {
  GonkaAdapterConfig,
  GonkaAdapterDependencies,
  GonkaAttemptError,
  GonkaAttemptErrorCategory,
  GonkaAttemptKind,
  GonkaAttemptRecord,
  GonkaCatalogItemRef,
  GonkaCatalogManifest,
  GonkaCatalogMerchantRef,
  GonkaCommerceRouter,
  GonkaIntentCandidate,
  GonkaIntentInput,
  GonkaResponseMetadata,
  GonkaRunErr,
  GonkaRunOk,
  GonkaRunResult,
  GonkaTokenUsage,
  isGonkaRunErr,
  isGonkaRunOk,
} from "./types";
