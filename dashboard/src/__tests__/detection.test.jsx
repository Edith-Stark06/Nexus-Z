import { describe, it, expect } from "vitest";
import { detectionMinutes } from "../lib/replay";

describe("detectionMinutes (time-to-detection)", () => {
  it("returns the gap between first_seen and flagged_at", () => {
    const m = detectionMinutes(
      "2026-10-14T08:00:00Z",
      "2026-10-14T09:30:00Z"
    );
    expect(m).toBeCloseTo(90, 5);
  });

  it("returns a fractional value for sub-minute gaps", () => {
    const m = detectionMinutes(
      "2026-10-14T08:00:00Z",
      "2026-10-14T08:00:30Z"
    );
    expect(m).toBeCloseTo(0.5, 5);
  });

  it("returns null when first_seen is missing", () => {
    expect(detectionMinutes(null, "2026-10-14T09:00:00Z")).toBeNull();
  });

  it("returns null when flagged_at is missing", () => {
    expect(detectionMinutes("2026-10-14T08:00:00Z", null)).toBeNull();
  });

  it("returns null for unparseable timestamps", () => {
    expect(detectionMinutes("not-a-date", "2026-10-14T09:00:00Z")).toBeNull();
  });

  it("accepts numeric millisecond inputs", () => {
    const a = new Date("2026-10-14T08:00:00Z").getTime();
    const b = new Date("2026-10-14T10:00:00Z").getTime();
    expect(detectionMinutes(a, b)).toBeCloseTo(120, 5);
  });
});