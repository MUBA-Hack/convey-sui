/**
 * Wave 1 Task 1.1 — strict parser for the live build-progress JSON.
 *
 * `public/build-progress.json` is the single source of truth for the
 * `/build-progress` page. It is polled every 3 seconds by a client component
 * and must never silently render malformed state, so {@link parseBuildProgress}
 * fails closed on every shape violation.
 *
 * Wire contract: the `percent` field on the snapshot and on each task is an
 * integer in [0, 100]. Status and percent are consistent (completed === 100,
 * pending === 0, active in 1..99). Task ids ascend in declared order (phase
 * ordering). The overall snapshot `percent` equals the rounded mean of the
 * task percents, so a stale or hand-edited overall figure is rejected rather
 * than rendered as truth.
 */

export type TaskStatus = "pending" | "active" | "completed";

export interface BuildTask {
  id: string;
  title: string;
  status: TaskStatus;
  /** Integer 0..100, consistent with {@link status}. */
  percent: number;
}

export interface BuildProgress {
  schemaVersion: 1;
  wave: string;
  /** ISO-8601 UTC timestamp with sub-second precision, e.g. 2026-08-29T12:00:00.000Z. */
  lastUpdated: string;
  criticVerdict: string;
  /** Overall completion, integer 0..100, equal to the rounded mean of task percents. */
  percent: number;
  tasks: BuildTask[];
}

const SCHEMA_VERSION = 1 as const;
const STATUSES: readonly TaskStatus[] = ["pending", "active", "completed"];

function fail(reason: string): never {
  throw new Error(`build-progress: ${reason}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIntegerPercent(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 0 &&
    v <= 100
  );
}

/** Accepts only full ISO-8601 UTC with timezone designator (Z or offset). */
function isIsoUtc(v: unknown): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  // Must carry a timezone designator so local times are never parsed silently.
  if (!/[Zz]|[+-]\d{2}:\d{2}$/.test(v)) return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms);
}

function parseTask(raw: unknown): BuildTask {
  if (!isObject(raw)) fail("task is not an object");
  const { id, title, status, percent } = raw;
  if (typeof id !== "string" || id.trim() === "") fail("task.id missing");
  if (typeof title !== "string" || title.trim() === "")
    fail(`task ${id} title missing`);
  if (typeof status !== "string" || !STATUSES.includes(status as TaskStatus))
    fail(`task ${id} has malformed status`);
  const s = status as TaskStatus;
  if (!isIntegerPercent(percent))
    fail(`task ${id} percent must be an integer in 0..100`);
  const p = percent;
  if (s === "completed" && p !== 100)
    fail(`task ${id} completed but percent !== 100`);
  if (s === "pending" && p !== 0) fail(`task ${id} pending but percent !== 0`);
  if (s === "active" && (p <= 0 || p >= 100))
    fail(`task ${id} active but percent not in 1..99`);
  return { id, title, status: s, percent: p };
}

/**
 * Strictly parse a build-progress snapshot. Throws on any shape violation.
 * The returned object is a fresh, validated copy — never the input reference.
 */
export function parseBuildProgress(raw: unknown): BuildProgress {
  if (!isObject(raw)) fail("root is not an object");
  const { schemaVersion, wave, lastUpdated, criticVerdict, percent, tasks } =
    raw;

  if (schemaVersion !== SCHEMA_VERSION)
    fail(`unsupported schemaVersion ${String(schemaVersion)}`);
  if (typeof wave !== "string" || wave.trim() === "") fail("wave missing");
  if (!isIsoUtc(lastUpdated)) fail("lastUpdated is not an ISO-8601 UTC string");
  if (typeof criticVerdict !== "string") fail("criticVerdict must be a string");
  if (!Array.isArray(tasks) || tasks.length === 0)
    fail("tasks must be a non-empty array");

  const parsedTasks = tasks.map(parseTask);

  // Phase ordering: ids must ascend in declared order.
  for (let i = 1; i < parsedTasks.length; i++) {
    if (parsedTasks[i]!.id <= parsedTasks[i - 1]!.id)
      fail(
        `task ids must ascend: ${parsedTasks[i - 1]!.id} -> ${parsedTasks[i]!.id}`,
      );
  }

  // Overall percent must equal the rounded mean of task percents — a stale or
  // hand-edited overall figure is rejected rather than rendered as truth.
  const derived = Math.round(
    parsedTasks.reduce((sum, t) => sum + t.percent, 0) / parsedTasks.length,
  );
  if (!isIntegerPercent(percent))
    fail("percent must be an integer in 0..100");
  if (percent !== derived)
    fail(`percent ${percent} is non-monotonic (derived ${derived})`);

  return {
    schemaVersion: SCHEMA_VERSION,
    wave,
    lastUpdated,
    criticVerdict,
    percent,
    tasks: parsedTasks,
  };
}
