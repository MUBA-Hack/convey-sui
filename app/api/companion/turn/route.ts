import { NextResponse } from "next/server";
import { parseBoundedJsonRequest } from "@/lib/http/parse-bounded-json-request.server";
import {
  CompanionInputSchema,
  CompanionCandidateSchema,
  CompanionResolutionSchema,
  COMPANION_REQUEST_MAX_BYTES,
} from "@/lib/companion/contracts";
import { EMPTY_COMPANION_MEMORY, CompanionMemorySchema } from "@/lib/companion/memory";
import { parseCompanionTurn, resolveCompanionCandidate } from "@/lib/companion/turn";
import { createGonkaCompanionRouter, resolveCompanionGonkaConfig } from "@/lib/gonka/companion";
import type { CompanionMemory } from "@/lib/companion/memory";
import { DEFAULT_COMPANION_WORKSPACE_ID } from "@/lib/companion/workspaces";
import type { CompanionWorkspaceId } from "@/lib/companion/workspaces";
import type { CompanionOrganizationContext } from "@/lib/companion/organizations";

const TEST_ROUTER_FACTORY: { current: null | ((config: { apiKey: string; modelId: string; baseUrl?: string }) => { run: (input: unknown) => Promise<unknown> }) } = {
  current: null,
};

export function __setGonkaCompanionRouterFactoryForTest(
  factory:
    | null
    | ((config: { apiKey: string; modelId: string; baseUrl?: string }) => { run: (input: unknown) => Promise<unknown> }),
): void {
  TEST_ROUTER_FACTORY.current = factory;
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: Request) {
  const parsedBody = await parseBoundedJsonRequest(req, COMPANION_REQUEST_MAX_BYTES);
  if (!parsedBody.ok) {
    return noStoreJson(
      {
        kind: "rejected",
        reason: "invalid_request",
      },
      400,
    );
  }

  const parsed = CompanionInputSchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return noStoreJson(
      {
        kind: "rejected",
        reason: "invalid_request",
      },
      400,
    );
  }

  const input = {
    ...parsed.data,
    memory: CompanionMemorySchema.parse(parsed.data.memory ?? EMPTY_COMPANION_MEMORY),
    workspaceId: parsed.data.workspaceId ?? DEFAULT_COMPANION_WORKSPACE_ID,
  };
  const routerInput: CompanionMemory extends never ? never : {
    message: string;
    prompt: string;
    localeHint: string;
    memory: CompanionMemory;
    workspaceId: CompanionWorkspaceId;
    organization?: CompanionOrganizationContext;
  } = {
    message: input.message,
    prompt: input.message,
    localeHint: input.localeHint,
    memory: input.memory,
    workspaceId: input.workspaceId,
    organization: input.organization,
  };

  const deterministic = CompanionResolutionSchema.parse(parseCompanionTurn(input));
  if (deterministic.toolId === "splits.propose" || deterministic.toolId === "strategies.propose") {
    return noStoreJson(deterministic);
  }

  const envConfig = resolveCompanionGonkaConfig(process.env);
  if (envConfig.config.apiKey.trim().length > 0 || TEST_ROUTER_FACTORY.current !== null) {
    try {
      const router = (TEST_ROUTER_FACTORY.current ?? createGonkaCompanionRouter)(envConfig.config);
      const result = await router.run(routerInput);
      if (
        typeof result === "object" &&
        result !== null &&
        "type" in result &&
        result.type === "gonka-run-ok" &&
        "candidate" in result &&
        "metadata" in result &&
        typeof result.metadata === "object" &&
        result.metadata !== null &&
        "gonkaRequestId" in result.metadata &&
        "responseModel" in result.metadata &&
        typeof result.metadata.gonkaRequestId === "string" &&
        typeof result.metadata.responseModel === "string"
      ) {
        return noStoreJson(
          resolveCompanionCandidate(input, CompanionCandidateSchema.parse(result.candidate), {
            requestId: result.metadata.gonkaRequestId,
            responseModel: result.metadata.responseModel,
          }),
        );
      }
    } catch {}
  }

  return noStoreJson(deterministic);
}
