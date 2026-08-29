// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVoiceInput } from "@/components/commerce/use-voice-input";

/**
 * Wave 2 Task 2.3 — DOM tests for the voice-input hook.
 *
 * The hook wraps SpeechRecognition / webkitSpeechRecognition. It must:
 *  - report `supported` based on the browser's SpeechRecognition constructor
 *  - toggle a visible `listening` state and a live `interimTranscript`
 *  - call `onFinal` with the final transcript when recognition resolves
 *  - surface `error` and stop listening on a recognition error
 *  - stop the active recognition on unmount (no leaked listeners)
 *  - keep working as a text-fallback when unsupported (supported=false, no throw)
 *
 * Only the browser SpeechRecognition surface is mocked; the hook itself runs
 * for real.
 */

/**
 * A minimal, controllable SpeechRecognition mock. Each instance records the
 * options the hook set and exposes fire() helpers the tests drive synchronously
 * to simulate the browser's event callbacks.
 */
interface MockRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

let instances: MockRecognition[] = [];
let MockCtor: ReturnType<typeof vi.fn>;

function makeMockCtor() {
  return vi.fn(function (this: MockRecognition) {
    const inst: MockRecognition = {
      lang: "",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    };
    instances.push(inst);
    // vi.fn() with a `function` implementation returns undefined from `new`;
    // assign the instance to `this` so `new MockCtor()` yields the instance.
    Object.assign(this, inst);
    return inst;
  });
}

function installSpeechRecognition() {
  instances = [];
  MockCtor = makeMockCtor();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockCtor;
}

function clearSpeechRecognition() {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
}

/** Build a SpeechRecognitionEvent-like result list from [transcript, isFinal] pairs. */
function resultsOf(...pairs: Array<[string, boolean]>) {
  const results = pairs.map(([transcript, isFinal]) => {
    const alt = { transcript };
    const arr = Object.assign([alt], { isFinal });
    return arr;
  });
  return Object.assign(results, { length: results.length });
}

beforeEach(() => {
  clearSpeechRecognition();
});

afterEach(() => {
  clearSpeechRecognition();
  vi.restoreAllMocks();
});

describe("useVoiceInput — support detection", () => {
  it("reports supported=false and never throws when SpeechRecognition is absent", () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(false);
    // start() is a no-op (not a throw) so the text fallback stays usable.
    act(() => {
      result.current.start();
    });
    expect(result.current.listening).toBe(false);
  });

  it("reports supported=true when window.SpeechRecognition exists", () => {
    installSpeechRecognition();
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(true);
  });

  it("reports supported=true when only webkitSpeechRecognition exists", () => {
    instances = [];
    MockCtor = makeMockCtor();
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = MockCtor;
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(true);
  });
});

describe("useVoiceInput — listening lifecycle", () => {
  beforeEach(() => installSpeechRecognition());

  it("start() constructs a recognition, configures it, and sets listening=true", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    expect(MockCtor).toHaveBeenCalledTimes(1);
    expect(instances.length).toBe(1);
    const inst = instances[0]!;
    expect(inst.lang).toBe("en-US");
    expect(inst.continuous).toBe(false);
    expect(inst.interimResults).toBe(true);
    expect(inst.start).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(true);
  });

  it("stop() calls recognition.stop() and onend flips listening to false", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    const inst = instances[0]!;
    act(() => {
      result.current.stop();
    });
    expect(inst.stop).toHaveBeenCalledTimes(1);
    act(() => {
      inst.onend?.();
    });
    expect(result.current.listening).toBe(false);
  });

  it("does not start a second recognition while already listening", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
      result.current.start();
    });
    expect(MockCtor).toHaveBeenCalledTimes(1);
  });
});

describe("useVoiceInput — transcripts", () => {
  beforeEach(() => installSpeechRecognition());

  it("streams interim transcript and calls onFinal with the final transcript", () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onFinal }));

    act(() => {
      result.current.start();
    });
    const inst = instances[0]!;

    // Interim result: visible live transcript, no final yet.
    act(() => {
      inst.onresult?.({
        results: resultsOf(["buy two", false]),
        resultIndex: 0,
      });
    });
    expect(result.current.interimTranscript).toBe("buy two");
    expect(onFinal).not.toHaveBeenCalled();

    // Final result: onFinal fires with the final transcript and interim clears.
    act(() => {
      inst.onresult?.({
        results: resultsOf(["buy two iced coffees", true]),
        resultIndex: 0,
      });
    });
    expect(onFinal).toHaveBeenCalledWith("buy two iced coffees");
    expect(result.current.interimTranscript).toBe("");
  });

  it("accumulates multiple final segments into onFinal across one session", () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onFinal }));
    act(() => {
      result.current.start();
    });
    const inst = instances[0]!;
    act(() => {
      inst.onresult?.({ results: resultsOf(["buy", true]), resultIndex: 0 });
    });
    act(() => {
      inst.onresult?.({ results: resultsOf(["buy", true], ["two coffees", true]), resultIndex: 1 });
    });
    expect(onFinal).toHaveBeenLastCalledWith("buy two coffees");
  });
});

describe("useVoiceInput — error handling", () => {
  beforeEach(() => installSpeechRecognition());

  it("surfaces the error and stops listening on a recognition error", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    const inst = instances[0]!;
    act(() => {
      inst.onerror?.({ error: "not-allowed" });
    });
    expect(result.current.error).toBe("not-allowed");
    expect(result.current.listening).toBe(false);
  });

  it("clears the error on the next start()", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    const inst = instances[0]!;
    act(() => {
      inst.onerror?.({ error: "network" });
    });
    expect(result.current.error).toBe("network");
    act(() => {
      result.current.start();
    });
    expect(result.current.error).toBeNull();
  });
});

describe("useVoiceInput — unmount cleanup", () => {
  beforeEach(() => installSpeechRecognition());

  it("stops the active recognition when the hook unmounts", () => {
    const { result, unmount } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    const inst = instances[0]!;
    expect(inst.stop).not.toHaveBeenCalled();
    unmount();
    expect(inst.stop).toHaveBeenCalledTimes(1);
  });

  it("does not throw when unmounting without an active recognition", () => {
    const { unmount } = renderHook(() => useVoiceInput());
    expect(() => unmount()).not.toThrow();
  });
});
