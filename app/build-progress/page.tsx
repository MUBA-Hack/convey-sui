"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseBuildProgress,
  type BuildProgress,
  type TaskStatus,
} from "@/lib/commerce/build-progress";

/**
 * Wave 1 Task 1.1 — live build-progress page.
 *
 * Polls /build-progress.json every 3 seconds and renders the current wave,
 * completed/active/pending tasks, the latest critic verdict, and the
 * last-updated time. It must render even if polling fails: on a fetch or parse
 * error the last successfully parsed snapshot is kept and a clear stale state
 * is shown. Before the first successful load it renders a loading state.
 */

const POLL_MS = 3000;

interface ViewState {
  /** The most recent successfully parsed snapshot, or null before first load. */
  data: BuildProgress | null;
  /** True when the first load has not yet succeeded. */
  loading: boolean;
  /** True when the displayed snapshot is stale (the latest poll failed). */
  stale: boolean;
  /** Human-readable error from the most recent failed poll, if any. */
  error: string | null;
}

const INITIAL: ViewState = { data: null, loading: true, stale: false, error: null };

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  active: "Active",
  completed: "Completed",
};

function statusDotClass(status: TaskStatus): string {
  if (status === "completed") return "bg-black";
  if (status === "active") return "bg-black animate-pulse";
  return "bg-neutral-400";
}

export default function BuildProgressPage() {
  const [state, setState] = useState<ViewState>(INITIAL);
  // Guards against setting state after unmount and against overlapping polls.
  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;

    // One poll: fetch, strictly parse, and reconcile view state. setState only
    // ever runs inside this async boundary (never synchronously in the effect
    // body), matching the established pattern in components/pool/position-panel.
    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        // Cache-bust so a stale CDN/browser cache never freezes the page.
        const res = await fetch(`/build-progress.json?v=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const parsed = parseBuildProgress(json);
        if (!mounted.current) return;
        setState({ data: parsed, loading: false, stale: false, error: null });
      } catch (err) {
        if (!mounted.current) return;
        const message = err instanceof Error ? err.message : "poll failed";
        setState((prev) => ({
          data: prev.data,
          loading: prev.data === null,
          // Stale only once we have something to show; otherwise it is just loading.
          stale: prev.data !== null,
          error: message,
        }));
      } finally {
        inFlight.current = false;
      }
    };

    // Initial fire is deferred to a microtask so it is not a synchronous
    // setState in the effect body.
    void (async () => {
      await tick();
    })();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  if (state.loading) {
    return (
      <section className="mx-auto w-full max-w-3xl px-5 py-16 md:py-24">
        <h1 className="text-2xl font-medium tracking-tight">Build progress</h1>
        <p className="mt-2 text-sm text-neutral-600">Loading live status…</p>
      </section>
    );
  }

  const snap = state.data;
  // snap is non-null here because loading is only true before first data.
  if (!snap) return null;

  const completed = snap.tasks.filter((t) => t.status === "completed").length;
  const active = snap.tasks.filter((t) => t.status === "active").length;
  const pending = snap.tasks.filter((t) => t.status === "pending").length;

  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-16 md:py-24">
      <header className="flex flex-col gap-1">
        <p className="cv-micro cv-micro-sm text-neutral-500">Live build status</p>
        <h1 className="text-2xl font-medium tracking-tight">{snap.wave}</h1>
        {state.stale && (
          <p
            role="status"
            className="mt-1 text-sm font-semibold text-neutral-700"
          >
            Stale — showing last good snapshot ({state.error ?? "poll failed"})
          </p>
        )}
      </header>

      {/* Overall progress */}
      <div className="mt-8 border border-[var(--cv-line)] bg-[var(--cv-paper)] p-5">
        <div className="flex items-baseline justify-between">
          <span className="cv-micro cv-micro-sm text-neutral-500">
            Overall completion
          </span>
          <span className="font-mono text-3xl tabular-nums">
            {snap.percent}%
          </span>
        </div>
        <div
          className="mt-3 h-2 w-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={snap.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-black transition-[width] duration-500"
            style={{ width: `${snap.percent}%` }}
          />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="cv-micro cv-micro-sm text-neutral-500">Completed</dt>
            <dd className="font-mono text-xl tabular-nums">{completed}</dd>
          </div>
          <div>
            <dt className="cv-micro cv-micro-sm text-neutral-500">Active</dt>
            <dd className="font-mono text-xl tabular-nums">{active}</dd>
          </div>
          <div>
            <dt className="cv-micro cv-micro-sm text-neutral-500">Pending</dt>
            <dd className="font-mono text-xl tabular-nums">{pending}</dd>
          </div>
        </dl>
      </div>

      {/* Task list */}
      <ul className="mt-8 flex flex-col divide-y divide-[var(--cv-line)] border border-[var(--cv-line)]">
        {snap.tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-4 bg-white px-5 py-4"
          >
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 shrink-0 ${statusDotClass(
                task.status,
              )}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <span className="font-mono text-neutral-500">{task.id}</span>{" "}
                {task.title}
              </p>
              <p className="cv-micro cv-micro-sm mt-1 text-neutral-500">
                {STATUS_LABEL[task.status]} · {task.percent}%
              </p>
            </div>
            <div className="hidden h-1.5 w-24 shrink-0 bg-neutral-200 sm:block">
              <div
                className="h-full bg-black"
                style={{ width: `${task.percent}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Critic verdict + last updated */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="border border-[var(--cv-line)] bg-white p-5">
          <p className="cv-micro cv-micro-sm text-neutral-500">
            Latest critic verdict
          </p>
          <p className="mt-2 text-sm leading-relaxed">{snap.criticVerdict}</p>
        </div>
        <div className="border border-[var(--cv-line)] bg-white p-5">
          <p className="cv-micro cv-micro-sm text-neutral-500">Last updated</p>
          <p className="mt-2 font-mono text-sm tabular-nums">
            {new Date(snap.lastUpdated).toLocaleString()}
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-500">
            {snap.lastUpdated}
          </p>
        </div>
      </div>
    </section>
  );
}
