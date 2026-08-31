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

export {
  createGonkaFamilyStewardRouter,
  createFamilyStewardManifest,
  validateFamilyStewardCandidate,
  familyStewardCandidateSchema,
  familyStewardInputSchema,
  familyStewardSolicitationTextSchema,
  FamilyStewardSignalSchema,
  FamilyStewardSignalIdSchema,
  FamilyStewardQuestionIdSchema,
  FAMILY_STEWARD_SIGNAL_IDS,
  FAMILY_STEWARD_QUESTION_IDS,
  FAMILY_STEWARD_MAX_CODE_POINTS,
  FAMILY_STEWARD_MAX_TEXT_BYTES,
  FAMILY_STEWARD_MAX_SIGNALS,
  FAMILY_STEWARD_MAX_QUESTIONS,
  FAMILY_STEWARD_MIN_CONFIDENCE,
} from "./family-steward";

export type {
  FamilyStewardCandidate,
  FamilyStewardInput,
  FamilyStewardManifest,
  FamilyStewardQuestionId,
  FamilyStewardSignal,
  FamilyStewardSignalId,
  GonkaFamilyStewardRouter,
} from "./family-steward";

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
