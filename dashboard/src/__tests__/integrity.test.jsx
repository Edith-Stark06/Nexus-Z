import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ringScore, accountScore, ringScoreFull, accountScoreFull, ringPct, accountPct, RING_SCORE_NOTE, ACCOUNT_SCORE_NOTE, AMOUNT_NOTE } from "../lib/scores";
import { describeSystem, sourceLine, formatAge, modelReady } from "../lib/provenance";
import { labelPlan } from "../lib/graph";
import RiskMeter from "../components/RiskMeter";

describe("scores keep their own scale and name", () => {
  it("shows a ring score as a 0 to 100 integer and an account score as a 0 to 1 decimal", () => {
    expect(ringScore(77)).toBe("77");
    expect(ringScore(76.6)).toBe("77");
    expect(accountScore(0.784)).toBe("0.78");
    expect(ringScoreFull(77)).toBe("77 / 100");
    expect(accountScoreFull(0.55)).toBe("0.55 / 1");
  });

  it("never turns a missing score into a number", () => {
    for (const v of [null, undefined, "", NaN]) {
      expect(ringScore(v)).toBe("—");
      expect(accountScore(v)).toBe("—");
      expect(ringPct(v)).toBeNull();
      expect(accountPct(v)).toBeNull();
    }
  });

  it("only rescales to 0 to 100 to draw a bar, and clamps it", () => {
    expect(accountPct(0.5)).toBe(50);
    expect(accountPct(1.4)).toBe(100);
    expect(ringPct(140)).toBe(100);
    expect(ringPct(-5)).toBe(0);
  });

  it("says in words that the two scores differ and neither is a probability or a finding", () => {
    expect(ACCOUNT_SCORE_NOTE).toMatch(/different model from the ring score/);
    expect(ACCOUNT_SCORE_NOTE).toMatch(/not comparable/);
    expect(RING_SCORE_NOTE).toMatch(/not a probability of fraud and not a finding/);
    expect(AMOUNT_NOTE).toMatch(/does not report a currency/);
    expect(AMOUNT_NOTE).toMatch(/not summed or converted/);
  });

  it("RiskMeter prints the native number and names the scale, for both kinds", () => {
    const ring = render(<RiskMeter value={77} />).container;
    expect(ring.querySelector(".riskmeter-n").textContent).toBe("77");
    expect(ring.querySelector(".riskmeter").title).toMatch(/Ring score 77 on a 0–100 scale/);
    const acc = render(<RiskMeter kind="account" value={0.55} />).container;
    expect(acc.querySelector(".riskmeter-n").textContent).toBe("0.55");
    expect(acc.querySelector(".riskmeter").title).toMatch(/Account score 0.55 on a 0–1 scale/);
  });

  it("colours a ring score by severity only in the full meter; list rows and account scores stay neutral", () => {
    expect(render(<RiskMeter value={77} />).container.querySelector(".riskbar").className).toMatch(/high/);
    expect(render(<RiskMeter value={77} compact />).container.querySelector(".riskbar").className).not.toMatch(/high|medium|low/);
    expect(render(<RiskMeter kind="account" value={0.95} />).container.querySelector(".riskbar").className).not.toMatch(/high|medium|low/);
  });
});

const T = "2022-09-09T23:59:00+00:00";
const modelHealth = { status: "ok", backend: "model", history_transactions: 654467, data_as_of: T, state_age_seconds: 5364, refreshes_completed: 0, last_rebuild_seconds: 18.3, pending_transactions: 0, refreshing: false, last_error: null };
const live = (health, extra = {}) => ({ mode: "live", health, lastOk: new Date("2026-10-18T10:00:00Z"), lastError: null, ...extra });

describe("system status keeps four facts apart", () => {
  it("states API, backend, source data and refresh separately for a working model backend", () => {
    const s = describeSystem(live(modelHealth));
    expect(s.api).toMatchObject({ tone: "ok", label: "Responding" });
    expect(s.backend).toMatchObject({ tone: "ok", label: "Model backend" });
    expect(s.source.label).toBe("Source data through 2022-09-09 23:59 UTC");
    expect(s.source.detail).toMatch(/not the present/);
    expect(s.refresh.label).toBe("Model state built 89 min before the last check");
    expect(s.refresh.detail).toMatch(/No refresh since the first build/);
  });

  it("takes the data time from /health, never from the browser clock", () => {
    const s = describeSystem(live(modelHealth, { lastOk: new Date("2031-01-01T00:00:00Z") }));
    expect(s.source.asOf).toBe(T);
    expect(JSON.stringify(s)).not.toMatch(/2031/);
  });

  it("does not call a bare HTTP 200 'model active': without a built state the model backend is a warning", () => {
    const s = describeSystem(live({ status: "ok", backend: "model" }));
    expect(modelReady({ status: "ok", backend: "model" })).toBe(false);
    expect(s.api.tone).toBe("ok"); // the API is answering...
    expect(s.backend.tone).toBe("warn"); // ...but that is not a model
    expect(s.backend.label).toMatch(/no state yet/);
  });

  it("discloses a stub backend and gives it no source data", () => {
    const s = describeSystem(live({ status: "ok", backend: "stub" }));
    expect(s.backend).toMatchObject({ tone: "warn", label: "Stub backend" });
    expect(s.backend.detail).toMatch(/invented sample data/);
    expect(s.source.label).toBe("No source data");
    expect(s.source.asOf).toBeNull();
  });

  it("reports a degraded model refresh as degraded, not healthy", () => {
    const s = describeSystem(live({ ...modelHealth, status: "degraded", last_error: { type: "MemoryError" } }));
    expect(s.api.tone).toBe("warn");
    expect(s.api.detail).toMatch(/MemoryError/);
    expect(s.backend.tone).not.toBe("ok");
  });

  it("separates unreachable, stale and demo from a live connection", () => {
    expect(describeSystem({ mode: "unreachable", health: null, lastError: "The API did not answer." }).api).toMatchObject({ tone: "danger", label: "Unreachable" });
    const stale = describeSystem({ mode: "stale", health: modelHealth, lastOk: new Date(), lastError: "The API did not answer." });
    expect(stale.api).toMatchObject({ tone: "warn", label: "Not answering" });
    const demo = describeSystem({ mode: "demo", health: null });
    expect(demo.backend.label).toBe("Demo sample");
    expect(demo.source.label).toBe("Invented sample");
  });

  it("never describes historical data as live", () => {
    for (const d of [live(modelHealth), live({ status: "ok", backend: "stub" }), { mode: "demo", health: null }, { mode: "stale", health: modelHealth, lastOk: new Date() }]) {
      expect(JSON.stringify(describeSystem(d)).toLowerCase()).not.toMatch(/\blive\b/);
      expect(sourceLine(d).toLowerCase()).not.toMatch(/\blive\b/);
    }
  });

  it("gives one source line for page headers, with the synthetic-data disclosure", () => {
    expect(sourceLine(live(modelHealth))).toBe("Model backend · Source data through 2022-09-09 23:59 UTC · synthetic evaluation data");
    expect(sourceLine({ mode: "demo", health: null })).toMatch(/Demo sample · invented sample/);
    expect(sourceLine({ mode: "stale", health: modelHealth, lastOk: new Date() })).toMatch(/may be out of date/);
  });

  it("formats an age without inventing precision", () => {
    expect(formatAge(5)).toBe("5 s");
    expect(formatAge(5364)).toBe("89 min");
    expect(formatAge(7200)).toBe("2.0 h");
    expect(formatAge(400000)).toBe("5 days");
    expect(formatAge(null)).toBeNull();
  });
});

describe("label planning keeps names readable", () => {
  const radius = () => 8;
  const size = { width: 800, height: 600 };
  const pos = (pairs) => new Map(pairs.map(([id, x, y]) => [id, { x, y }]));
  const nodes = (ids) => ids.map((id) => ({ id }));

  it("names only the higher-priority account when two sit on top of each other", () => {
    const plan = labelPlan({ nodes: nodes(["ACC-AAAA01", "ACC-BBBB02"]), pos: pos([["ACC-AAAA01", 100, 100], ["ACC-BBBB02", 104, 102]]), tf: { k: 1, x: 0, y: 0 }, size, radius, priority: ["ACC-BBBB02", "ACC-AAAA01"] });
    expect([...plan.shown]).toEqual(["ACC-BBBB02"]);
    expect(plan.hidden).toBe(1);
  });

  it("names both once zooming in has given the labels room", () => {
    // two accounts a realistic distance apart: close enough that one label would run across the other account at k=1
    const base = { nodes: nodes(["ACC-AAAA01", "ACC-BBBB02"]), pos: pos([["ACC-AAAA01", 100, 100], ["ACC-BBBB02", 140, 110]]), size, radius, priority: ["ACC-AAAA01", "ACC-BBBB02"] };
    const far = labelPlan({ ...base, tf: { k: 1, x: 0, y: 0 } });
    expect(far.shown.size).toBe(1);
    expect(far.hidden).toBe(1);
    const near = labelPlan({ ...base, tf: { k: 3, x: -200, y: -200 } });
    expect(near.visible).toBe(2);
    expect(near.shown.size).toBe(2);
    expect(near.hidden).toBe(0);
  });

  it("always names a forced account (the selected or hovered one), even in a crowd", () => {
    const ids = ["ACC-000001", "ACC-000002", "ACC-000003"];
    const plan = labelPlan({ nodes: nodes(ids), pos: pos(ids.map((id, i) => [id, 100 + i, 100])), tf: { k: 1, x: 0, y: 0 }, size, radius, priority: ids, forced: ["ACC-000003"] });
    expect(plan.shown.has("ACC-000003")).toBe(true);
  });

  it("does not put a label on top of another account", () => {
    const plan = labelPlan({ nodes: nodes(["ACC-LEFT01", "ACC-RIGHT2"]), pos: pos([["ACC-LEFT01", 100, 100], ["ACC-RIGHT2", 118, 100]]), tf: { k: 1, x: 0, y: 0 }, size, radius, priority: ["ACC-LEFT01", "ACC-RIGHT2"] });
    // LEFT's label would run across RIGHT's disc, so it is left unnamed
    expect(plan.shown.has("ACC-LEFT01")).toBe(false);
  });

  it("ignores accounts outside the visible area", () => {
    const plan = labelPlan({ nodes: nodes(["ACC-NEAR01", "ACC-FAR001"]), pos: pos([["ACC-NEAR01", 100, 100], ["ACC-FAR001", 5000, 5000]]), tf: { k: 1, x: 0, y: 0 }, size, radius, priority: ["ACC-NEAR01", "ACC-FAR001"] });
    expect(plan.visible).toBe(1);
    expect(plan.hidden).toBe(0);
  });

  it("is deterministic for the same input", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `ACC-${String(i).padStart(6, "0")}`);
    const p = pos(ids.map((id, i) => [id, 40 + (i % 6) * 22, 40 + Math.floor(i / 6) * 18]));
    const a = labelPlan({ nodes: nodes(ids), pos: p, tf: { k: 1, x: 0, y: 0 }, size, radius, priority: ids });
    const b = labelPlan({ nodes: nodes(ids), pos: p, tf: { k: 1, x: 0, y: 0 }, size, radius, priority: ids });
    expect([...a.shown]).toEqual([...b.shown]);
  });
});
