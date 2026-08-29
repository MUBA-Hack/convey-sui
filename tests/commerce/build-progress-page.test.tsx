// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BuildProgressPage from "@/app/build-progress/page";
import type { BuildProgress } from "@/lib/commerce/build-progress";

/**
 * Wave 1 Task 1.1 — DOM tests pinning the live build-progress page behavior.
 *
 * The page polls /build-progress.json every 3000ms, renders a loading state
 * before the first successful parse, keeps the last good snapshot and shows a
 * stale banner when a later poll fails (fetch rejection, HTTP error, or a
 * malformed payload that the strict parser rejects), and clears its interval
 * on unmount so it never polls or setState after the component is gone.
 *
 * The strict parser (`parseBuildProgress`) is exercised for real — only the
 * network seam (`fetch`) and the clock (`setInterval`) are mocked.
 */

const VALID: BuildProgress = {
  schemaVersion: 1,
  wave: "Wave 1",
  lastUpdated: "2026-08-29T12:00:00.000Z",
  criticVerdict: "Wave 1 foundation in the working tree; no material gaps.",
  percent: 75, // round((100 + 50) / 2)
  tasks: [
    { id: "1.1", title: "Progress data contract and route", status: "completed", percent: 100 },
    { id: "1.2", title: "Commerce shell without legacy regression", status: "active", percent: 50 },
  ],
};

/** A fetch Response-like that resolves to a parsed body. */
function okResponse(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

/** A fetch Response-like with a failing HTTP status. */
function httpErrorResponse(status = 500): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as unknown as Response);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe("BuildProgressPage — loading and first snapshot", () => {
  it("renders the loading state before the first poll resolves", () => {
    vi.mocked(globalThis.fetch).mockReturnValue(okResponse(VALID));
    render(<BuildProgressPage />);
    expect(screen.getByText("Loading live status…")).toBeInTheDocument();
  });

  it("renders the valid snapshot after the first successful poll", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(okResponse(VALID));
    render(<BuildProgressPage />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByText("Loading live status…")).not.toBeInTheDocument();
    // Wave title, overall percent, and every task title are rendered.
    expect(screen.getByRole("heading", { name: VALID.wave })).toBeInTheDocument();
    expect(screen.getByText(`${VALID.percent}%`)).toBeInTheDocument();
    for (const task of VALID.tasks) {
      expect(screen.getByText(task.title)).toBeInTheDocument();
    }
    // The raw ISO timestamp is rendered verbatim alongside the locale string.
    expect(screen.getByText(VALID.lastUpdated)).toBeInTheDocument();
    // No stale banner while polls succeed.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("BuildProgressPage — 3000ms polling cadence", () => {
  it("fires the initial poll on mount and re-polls every 3000ms", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValue(okResponse(VALID));

    render(<BuildProgressPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Just under the interval: no second poll yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Crossing 3000ms fires the second poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // And a third at 6000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses a cache-busting query and no-store on every fetch", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValue(okResponse(VALID));

    render(<BuildProgressPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/^\/build-progress\.json\?v=\d+$/);
    expect(init).toEqual({ cache: "no-store" });
  });
});

describe("BuildProgressPage — stale-on-failure keeps last good snapshot", () => {
  it("keeps the last good snapshot and shows stale when the next poll returns HTTP 500", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValueOnce(okResponse(VALID)).mockReturnValue(httpErrorResponse(500));

    render(<BuildProgressPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: VALID.wave })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Last good snapshot is still rendered.
    expect(screen.getByRole("heading", { name: VALID.wave })).toBeInTheDocument();
    expect(screen.getByText(`${VALID.percent}%`)).toBeInTheDocument();
    // Stale banner is now shown, carrying the error message.
    const stale = screen.getByRole("status");
    expect(stale).toHaveTextContent(/Stale/);
    expect(stale).toHaveTextContent(/HTTP 500/);
  });

  it("keeps the last good snapshot and shows stale when the next poll is malformed", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    // First poll valid; second poll returns a body the strict parser rejects.
    fetchMock
      .mockReturnValueOnce(okResponse(VALID))
      .mockReturnValue(okResponse({ schemaVersion: 99 }));

    render(<BuildProgressPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: VALID.wave })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByRole("heading", { name: VALID.wave })).toBeInTheDocument();
    const stale = screen.getByRole("status");
    expect(stale).toHaveTextContent(/Stale/);
  });

  it("keeps the last good snapshot and shows stale when the next poll rejects (network error)", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    // mockRejectedValue creates the rejected promise at call time (inside the
    // page's await) rather than eagerly at setup, so the rejection is always
    // handled by the page's catch and never floats unhandled.
    fetchMock.mockReturnValueOnce(okResponse(VALID)).mockRejectedValue(new Error("network down"));

    render(<BuildProgressPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByRole("heading", { name: VALID.wave })).toBeInTheDocument();
    const stale = screen.getByRole("status");
    expect(stale).toHaveTextContent(/Stale/);
    expect(stale).toHaveTextContent(/network down/);
  });
});

describe("BuildProgressPage — unmount clears the interval", () => {
  it("does not poll after unmount", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValue(okResponse(VALID));

    const { unmount } = render(<BuildProgressPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();

    // Advancing well past several intervals must not trigger any more polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
