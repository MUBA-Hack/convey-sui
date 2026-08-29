"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wave 2 Task 2.3 — voice input hook.
 *
 * Wraps the browser SpeechRecognition / webkitSpeechRecognition API. The hook
 * is the complete fallback surface for speech: when the API is absent it
 * reports `supported=false` and `start()` is a no-op so the chat's text input
 * stays fully usable. When supported it exposes a visible `listening` state,
 * a live `interimTranscript`, and an `onFinal` callback fired with the final
 * transcript when recognition resolves.
 *
 * The hook never signs, never transacts, and never sends raw text to a model.
 * It only produces text that the chat composer then submits through the same
 * typed `/api/commerce/intent` path as keyboard input.
 */

// The browser SpeechRecognition type is not in lib.dom for all TS versions, so
// declare the minimal surface the hook uses.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  resultIndex: number;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceInputOptions {
  /** Fired with the accumulated final transcript when recognition resolves. */
  onFinal?: (text: string) => void;
  /** BCP-47 language tag; defaults to en-US. */
  lang?: string;
}

export interface UseVoiceInputResult {
  /** True when a SpeechRecognition constructor is available in this browser. */
  supported: boolean;
  /** True while a recognition session is active. */
  listening: boolean;
  /** Live partial transcript for the in-flight session. */
  interimTranscript: string;
  /** Last recognition error code, cleared on the next start(). */
  error: string | null;
  /** Begin a recognition session. No-op when unsupported or already listening. */
  start: () => void;
  /** Stop the active recognition session. No-op when not listening. */
  stop: () => void;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputResult {
  const { onFinal, lang = "en-US" } = options;
  const [supported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs hold mutable values the browser callbacks close over without
  // re-creating the recognition instance on every render.
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(onFinal);
  // Keep the latest onFinal in a ref without touching refs during render
  // (react-hooks/refs). Updated in an effect so the browser callbacks, which
  // fire after render, always see the current callback.
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // stop() can throw if already stopped; ignore.
      }
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // unsupported: no-op, text fallback stays usable
    if (recognitionRef.current) return; // already listening

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    finalRef.current = "";

    rec.onresult = (ev: SpeechRecognitionEventLike) => {
      let interim = "";
      let finalChunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i]!;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalChunk += transcript;
        } else {
          interim += transcript;
        }
      }
      if (finalChunk) {
        finalRef.current = (finalRef.current + " " + finalChunk).trim();
        setInterimTranscript("");
        onFinalRef.current?.(finalRef.current);
      } else {
        setInterimTranscript(interim);
      }
    };

    rec.onerror = (ev: { error: string }) => {
      setError(ev.error);
      setListening(false);
      setInterimTranscript("");
      // Real browsers fire onend after onerror, but clearing the ref here
      // lets start() restart immediately without waiting for that pair.
      recognitionRef.current = null;
    };

    rec.onend = () => {
      setListening(false);
      setInterimTranscript("");
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      // start() can throw if called too rapidly; clean up and stay usable.
      recognitionRef.current = null;
      setListening(false);
    }
  }, [lang]);

  // Stop the active recognition on unmount so no leaked listeners survive.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return { supported, listening, interimTranscript, error, start, stop };
}
