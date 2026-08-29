import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseBuildProgress,
  type BuildProgress,
  type BuildTask,
} from "./build-progress";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CANONICAL_JSON = path.join(REPO_ROOT, "public/build-progress.json");

/**
 * Wave 1 Task 1.1 — strict parser for /build-progress.json.
 *
 * The JSON file is the source of truth for the live build-progress page. It is
 * fetched every 3s by a client component and must never silently render
 * malformed state, so the parser fails closed on every shape violation.
 */
describe("parseBuildProgress", () => {
  const VALID: BuildProgress = {
    schemaVersion: 1,
    wave: "Wave 1",
    lastUpdated: "2026-08-29T12:00:00.000Z",
    criticVerdict: "Wave 1 foundation shipped; no material gaps.",
    percent: 75, // round((100 + 50) / 2)
    tasks: [
      {
        id: "1.1",
        title: "Progress data contract and route",
        status: "completed",
        percent: 100,
      },
      {
        id: "1.2",
        title: "Commerce shell without legacy regression",
        status: "active",
        percent: 50,
      },
    ],
  };

  it("parses a well-formed snapshot", () => {
    expect(parseBuildProgress(VALID)).toEqual(VALID);
  });

  it("parses its own canonical JSON file shape (round-trip)", () => {
    const json = JSON.stringify(VALID);
    expect(parseBuildProgress(JSON.parse(json))).toEqual(VALID);
  });

  it("rejects a non-object root", () => {
    expect(() => parseBuildProgress("nope")).toThrow();
    expect(() => parseBuildProgress(null)).toThrow();
    expect(() => parseBuildProgress([])).toThrow();
  });

  it("rejects an unsupported schemaVersion", () => {
    expect(() => parseBuildProgress({ ...VALID, schemaVersion: 2 })).toThrow();
    expect(() => parseBuildProgress({ ...VALID, schemaVersion: "1" })).toThrow();
  });

  it("rejects an empty wave name", () => {
    expect(() => parseBuildProgress({ ...VALID, wave: "" })).toThrow();
    expect(() => parseBuildProgress({ ...VALID, wave: "   " })).toThrow();
  });

  it("rejects a malformed lastUpdated timestamp", () => {
    expect(() => parseBuildProgress({ ...VALID, lastUpdated: "today" })).toThrow();
    expect(() =>
      parseBuildProgress({ ...VALID, lastUpdated: "2026-08-29" }),
    ).toThrow();
  });

  it("rejects a malformed task status", () => {
    const bad: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, status: "done" }],
    };
    expect(() => parseBuildProgress(bad)).toThrow();
  });

  it("rejects a task percent out of [0,100]", () => {
    const high: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, percent: 120 }],
    };
    expect(() => parseBuildProgress(high)).toThrow();
    const neg: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, percent: -1 }],
    };
    expect(() => parseBuildProgress(neg)).toThrow();
  });

  it("rejects a non-integer task percent", () => {
    const frac: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, percent: 33.5 }],
    };
    expect(() => parseBuildProgress(frac)).toThrow();
  });

  it("rejects status/percent inconsistency (completed must be 100)", () => {
    const bad: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, status: "completed", percent: 90 }],
    };
    expect(() => parseBuildProgress(bad)).toThrow();
  });

  it("rejects status/percent inconsistency (pending must be 0)", () => {
    const bad: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, status: "pending", percent: 10 }],
    };
    expect(() => parseBuildProgress(bad)).toThrow();
  });

  it("rejects status/percent inconsistency (active must be 1..99)", () => {
    const zero: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, status: "active", percent: 0 }],
    };
    expect(() => parseBuildProgress(zero)).toThrow();
    const full: unknown = {
      ...VALID,
      tasks: [{ ...VALID.tasks[0]!, status: "active", percent: 100 }],
    };
    expect(() => parseBuildProgress(full)).toThrow();
  });

  it("rejects non-monotonic phase ordering (task ids must ascend)", () => {
    const outOfOrder: unknown = {
      ...VALID,
      tasks: [VALID.tasks[1]!, VALID.tasks[0]!],
    };
    expect(() => parseBuildProgress(outOfOrder)).toThrow();
  });

  it("rejects a non-monotonic overall percent (declared != derived)", () => {
    // tasks: 100 + 0 -> derived overall = 50; declare 40 to force mismatch.
    const bad: unknown = { ...VALID, percent: 40 };
    expect(() => parseBuildProgress(bad)).toThrow();
  });

  it("rejects an empty task list", () => {
    expect(() => parseBuildProgress({ ...VALID, tasks: [] })).toThrow();
  });

  it("rejects a task missing a required field", () => {
    const noId: unknown = {
      ...VALID,
      tasks: [{ title: "x", status: "pending", percent: 0 }],
    };
    expect(() => parseBuildProgress(noId)).toThrow();
  });

  it("derives the overall percent from task percents (rounded)", () => {
    const snap: BuildProgress = {
      ...VALID,
      tasks: [
        { id: "1.1", title: "a", status: "completed", percent: 100 },
        { id: "1.2", title: "b", status: "active", percent: 33 },
        { id: "1.3", title: "c", status: "pending", percent: 0 },
      ],
      percent: 44, // round((100+33+0)/3) = 44
    };
    expect(parseBuildProgress(snap).percent).toBe(44);
  });
});

describe("canonical public/build-progress.json", () => {
  it("is valid against the strict parser", () => {
    const raw = JSON.parse(readFileSync(CANONICAL_JSON, "utf8"));
    const snap = parseBuildProgress(raw);
    expect(snap.wave).toBe("Wave 1");
    expect(snap.tasks.length).toBeGreaterThan(0);
  });

  /**
   * Live progress must reflect every actually completed working-tree task, not
   * just the Wave 1 foundation. As of this snapshot, four implementation pieces
   * are complete in the working tree: 1.1 (progress data contract + route),
   * 1.2 (commerce shell), 2.1 (deterministic purchase-intent interpreter), and
   * 3.2 (offline QR Ferry envelope + replay defense). The remaining six tasks
   * (2.2, 2.3, 3.1, 4.1, 4.2, 4.3) are still pending at 0, so the derived
   * overall is round((100*4 + 0*6) / 10) = 40. This test pins the exact
   * statuses and percents so the snapshot cannot drift back to a stale
   * "only Wave 1 done" state, and so the overall figure cannot lie about how
   * much is actually built.
   */
  it("marks 1.1, 1.2, 2.1, and 3.2 completed at 100 with the rest pending at 0 and overall percent 40", () => {
    const raw = JSON.parse(readFileSync(CANONICAL_JSON, "utf8"));
    const snap = parseBuildProgress(raw);

    const byId = new Map(snap.tasks.map((t) => [t.id, t]));
    const completed = ["1.1", "1.2", "2.1", "3.2"];
    const pending = ["2.2", "2.3", "3.1", "4.1", "4.2", "4.3"];

    for (const id of completed) {
      const t = byId.get(id);
      expect(t).toBeDefined();
      expect(t?.status).toBe("completed");
      expect(t?.percent).toBe(100);
    }
    for (const id of pending) {
      const t = byId.get(id);
      expect(t).toBeDefined();
      expect(t?.status).toBe("pending");
      expect(t?.percent).toBe(0);
    }

    // No task may be left in an indeterminate "active" state.
    for (const t of snap.tasks) {
      expect(t.status === "completed" || t.status === "pending").toBe(true);
    }

    // Derived overall = round((100*4 + 0*6) / 10) = 40.
    expect(snap.percent).toBe(40);
  });

  it("phrases the critic verdict truthfully: first implementation pieces completed and critic gaps fixed, UI/payment waves pending, no shipped/committed language", () => {
    const raw = JSON.parse(readFileSync(CANONICAL_JSON, "utf8"));
    const snap = parseBuildProgress(raw);
    const v = snap.criticVerdict.toLowerCase();
    expect(v).not.toMatch(/\bshipped\b/);
    expect(v).not.toMatch(/\bcommitted\b/);
    expect(v).toMatch(/working tree|implemented/);
    expect(v).toMatch(/complet/); // first implementation pieces completed
    expect(v).toMatch(/critic/); // critic gaps fixed
    expect(v).toMatch(/fix/); // gaps fixed
    expect(v).toMatch(/pending/); // UI/payment waves pending
    expect(v).toMatch(/ui|payment/); // names the pending waves
  });
});

describe("BuildTask status typing", () => {
  it("accepts the three canonical statuses", () => {
    const statuses: BuildTask["status"][] = [
      "pending",
      "active",
      "completed",
    ];
    expect(statuses).toHaveLength(3);
  });
});
