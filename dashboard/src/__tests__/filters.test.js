import { describe, it, expect } from "vitest";
import { filterRings, sortRings, victimFlagCounts, filterAlerts, sortAlerts, overviewNumbers } from "../lib/filters";
import { formatUtc, riskTone } from "../lib/constants";

const rings = [
  { ring_id: "RNG-AAA111", risk: 90, accounts: 3, victims: 1, headline: "Paid by ACH", first_seen: "2022-09-01T00:00:00Z", flagged_at: "2022-09-02T00:00:00Z" },
  { ring_id: "RNG-BBB222", risk: 60, accounts: 12, victims: 4, headline: "Money leaves within minutes", first_seen: "2022-09-03T00:00:00Z", flagged_at: "2022-09-04T00:00:00Z" },
  { ring_id: "RNG-CCC333", risk: 20, accounts: 6, victims: 0, headline: "Night-time bursts", first_seen: "2022-08-30T00:00:00Z", flagged_at: "2022-09-03T00:00:00Z" },
];
const alerts = [
  { alert_id: "1", type: "ring", severity: "high", ring_id: "RNG-AAA111", account_id: null, recipient_id: null, message: "3 linked accounts", ts: "2022-09-02T00:00:00Z" },
  { alert_id: "2", type: "victim_warning", severity: "medium", ring_id: "RNG-AAA111", account_id: "ACC-1", recipient_id: "ACC-9", message: "Recent payment went to an account in a flagged ring.", ts: "2022-09-02T05:00:00Z" },
  { alert_id: "3", type: "victim_warning", severity: "medium", ring_id: "RNG-BBB222", account_id: "ACC-2", recipient_id: null, message: "Recent payment went to an account in a flagged ring.", ts: "2022-09-01T05:00:00Z" },
  { alert_id: "4", type: "ring", severity: "low", ring_id: "RNG-CCC333", account_id: null, message: "6 linked accounts", ts: "2022-09-03T00:00:00Z" },
];

describe("ring filters and sorting", () => {
  it("searches ring id and headline, case-insensitively", () => {
    expect(filterRings(rings, { query: "bbb" }).map((r) => r.ring_id)).toEqual(["RNG-BBB222"]);
    expect(filterRings(rings, { query: "NIGHT" }).map((r) => r.ring_id)).toEqual(["RNG-CCC333"]);
    expect(filterRings(rings, { query: "nothing" })).toEqual([]);
  });

  it("filters by minimum risk and size", () => {
    expect(filterRings(rings, { minRisk: 50 }).map((r) => r.ring_id)).toEqual(["RNG-AAA111", "RNG-BBB222"]);
    expect(filterRings(rings, { minAccounts: 6 }).map((r) => r.ring_id)).toEqual(["RNG-BBB222", "RNG-CCC333"]);
    expect(filterRings(rings, { minRisk: 50, minAccounts: 6 }).map((r) => r.ring_id)).toEqual(["RNG-BBB222"]);
  });

  it("keeps only rings with likely victims flagged when asked", () => {
    const victimCounts = victimFlagCounts(alerts);
    expect(victimCounts).toEqual({ "RNG-AAA111": 1, "RNG-BBB222": 1 });
    expect(filterRings(rings, { onlyWithVictims: true, victimCounts }).map((r) => r.ring_id)).toEqual(["RNG-AAA111", "RNG-BBB222"]);
  });

  it("sorts by risk, size, flagged time and first seen without changing the input", () => {
    const before = rings.map((r) => r.ring_id);
    expect(sortRings(rings, "risk").map((r) => r.ring_id)).toEqual(["RNG-AAA111", "RNG-BBB222", "RNG-CCC333"]);
    expect(sortRings(rings, "size").map((r) => r.ring_id)).toEqual(["RNG-BBB222", "RNG-CCC333", "RNG-AAA111"]);
    expect(sortRings(rings, "flagged").map((r) => r.ring_id)).toEqual(["RNG-BBB222", "RNG-CCC333", "RNG-AAA111"]);
    expect(sortRings(rings, "first_seen").map((r) => r.ring_id)).toEqual(["RNG-CCC333", "RNG-AAA111", "RNG-BBB222"]);
    expect(sortRings(rings, "bogus").map((r) => r.ring_id)).toEqual(["RNG-AAA111", "RNG-BBB222", "RNG-CCC333"]);
    expect(rings.map((r) => r.ring_id)).toEqual(before);
  });

  it("handles no rings", () => {
    expect(filterRings(undefined, {})).toEqual([]);
    expect(sortRings([], "risk")).toEqual([]);
  });
});

describe("alert filters and sorting", () => {
  it("filters by type, severity and free text over ring, accounts and message", () => {
    expect(filterAlerts(alerts, { type: "victim_warning" })).toHaveLength(2);
    expect(filterAlerts(alerts, { severity: "high" }).map((a) => a.alert_id)).toEqual(["1"]);
    expect(filterAlerts(alerts, { query: "acc-9" }).map((a) => a.alert_id)).toEqual(["2"]); // finds the paid account
    expect(filterAlerts(alerts, { query: "rng-ccc" }).map((a) => a.alert_id)).toEqual(["4"]);
    expect(filterAlerts(alerts, { type: "ring", severity: "low", query: "6 linked" }).map((a) => a.alert_id)).toEqual(["4"]);
  });

  it("sorts newest first, or by severity then newest", () => {
    expect(sortAlerts(alerts, "time").map((a) => a.alert_id)).toEqual(["4", "2", "1", "3"]);
    expect(sortAlerts(alerts, "severity").map((a) => a.alert_id)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("overview numbers", () => {
  it("are derived only from what the API returned", () => {
    expect(overviewNumbers(rings, alerts)).toEqual({ rings: 3, accountsInRings: 21, highRisk: 2, ringAlerts: 2, victimFlags: 2 });
    expect(overviewNumbers(undefined, undefined)).toEqual({ rings: 0, accountsInRings: 0, highRisk: 0, ringAlerts: 0, victimFlags: 0 });
  });
});

describe("time and risk helpers", () => {
  it("shows absolute UTC time, never a relative label", () => {
    expect(formatUtc("2022-09-10T12:55:00Z")).toBe("2022-09-10 12:55 UTC");
    expect(formatUtc("2022-09-10T12:55:00+02:00")).toBe("2022-09-10 10:55 UTC");
    expect(formatUtc(null)).toBe("—");
    expect(formatUtc("not a date")).toBe("not a date");
  });

  it("uses the alert-severity cut-offs for risk tone", () => {
    expect(riskTone(50)).toBe("high");
    expect(riskTone(49)).toBe("medium");
    expect(riskTone(25)).toBe("medium");
    expect(riskTone(24)).toBe("low");
    expect(riskTone(null)).toBe("none");
  });
});
