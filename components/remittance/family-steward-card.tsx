"use client";

import { useEffect, useId, useReducer, useRef, useState } from "react";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import {
  FAMILY_STEWARD_MAX_CODE_POINTS,
  FAMILY_STEWARD_MAX_TEXT_BYTES,
} from "@/lib/gonka/family-steward";
import type { FamilyStewardResponse } from "@/lib/remittance/family-steward";
import {
  requestFamilyStewardReview,
  type FamilyStewardClientRequest,
} from "@/lib/remittance/family-steward-client";
import { StewardChecking, StewardInput, StewardResult } from "./family-steward-panels";

export interface FamilyStewardCardProps {
  quote: QuoteEnvelope;
}

type Phase =
  | { kind: "idle" }
  | { kind: "input" }
  | { kind: "checking"; message: string }
  | { kind: "result"; message: string; response: FamilyStewardResponse }
  | { kind: "unavailable"; message: string };

type Action =
  | { type: "open-input" }
  | { type: "collapse" }
  | { type: "start-checking"; message: string }
  | { type: "set-result"; message: string; response: FamilyStewardResponse }
  | { type: "set-unavailable"; message: string }
  | { type: "back-to-input" };

const REQUEST_TIMEOUT_MS = 35_000;

function reducer(state: Phase, action: Action): Phase {
  switch (action.type) {
    case "open-input":
      return { kind: "input" };
    case "collapse":
      return { kind: "idle" };
    case "start-checking":
      return { kind: "checking", message: action.message };
    case "set-result":
      return { kind: "result", message: action.message, response: action.response };
    case "set-unavailable":
      return { kind: "unavailable", message: action.message };
    case "back-to-input":
      return { kind: "input" };
    default:
      return state;
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function FamilyStewardCard({ quote }: FamilyStewardCardProps) {
  const [phase, dispatch] = useReducer(reducer, { kind: "idle" } as Phase);
  const [text, setText] = useState("");
  const panelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const headlineRef = useRef<HTMLParagraphElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (phase.kind === "input") {
      textareaRef.current?.focus();
    } else if (phase.kind === "result" || phase.kind === "unavailable") {
      queueMicrotask(() => headlineRef.current?.focus());
    }
  }, [phase.kind]);

  const codePoints = Array.from(text).length;
  const tooLong = codePoints > FAMILY_STEWARD_MAX_CODE_POINTS;
  const tooManyBytes = byteLength(text) > FAMILY_STEWARD_MAX_TEXT_BYTES;
  const canSubmit = text.trim().length > 0 && !tooLong && !tooManyBytes;

  async function runCheck() {
    if (!canSubmit) return;
    const message = text;
    dispatch({ type: "start-checking", message });
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const fetchImpl: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: controller.signal });
    try {
      const request: FamilyStewardClientRequest = { quote, solicitationText: message };
      const { response } = await requestFamilyStewardReview({ request, fetchImpl });
      dispatch({ type: "set-result", message, response });
    } catch {
      dispatch({ type: "set-unavailable", message });
    } finally {
      clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function collapse() {
    abortRef.current?.abort();
    abortRef.current = null;
    setText("");
    dispatch({ type: "collapse" });
  }

  const open = phase.kind !== "idle";

  return (
    <div
      data-testid="family-steward-card"
      className="border-t border-black/8"
      aria-labelledby={`${panelId}-trigger`}
    >
      <button
        type="button"
        id={`${panelId}-trigger`}
        data-testid="family-steward-trigger"
        data-hit-target="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? collapse() : dispatch({ type: "open-input" }))}
        className="flex w-full min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:bg-neutral-50"
      >
        <span>Check a payment message</span>
        <span aria-hidden className={open ? "rotate-90" : ""}>›</span>
      </button>

      {open && (
        <div id={panelId} className="cv-disclosure-panel px-4 pb-3">
          {phase.kind === "input" && (
            <StewardInput
              textareaRef={textareaRef}
              text={text}
              codePoints={codePoints}
              tooLong={tooLong}
              tooManyBytes={tooManyBytes}
              canSubmit={canSubmit}
              onChange={setText}
              onSubmit={runCheck}
              onCancel={collapse}
            />
          )}

          {phase.kind === "checking" && (
            <StewardChecking message={phase.message} onCancel={collapse} />
          )}

          {phase.kind === "result" && (
            <StewardResult
              headlineRef={headlineRef}
              message={phase.message}
              response={phase.response}
              onReset={() => dispatch({ type: "back-to-input" })}
              onCollapse={collapse}
            />
          )}

          {phase.kind === "unavailable" && (
            <StewardResult
              headlineRef={headlineRef}
              message={phase.message}
              response={{
                kind: "local_fallback",
                assessment: "review_recommended",
                fallbackReason: "provider_error",
                questionIds: ["verify_sender_in_known_channel"],
              } as FamilyStewardResponse}
              onReset={() => dispatch({ type: "back-to-input" })}
              onCollapse={collapse}
            />
          )}
        </div>
      )}
    </div>
  );
}
