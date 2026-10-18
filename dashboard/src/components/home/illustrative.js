/**
 * The invented transactions behind the "A transaction is a point" comparison. Deterministic, never fetched, and always
 * labelled illustrative on screen. Account ids are neutral (A01 to A12): no roles, no scores, no amounts, no currencies.
 *
 * The pattern is the typology NEXUS Z is built around: several accounts pay one account, which passes the money on to
 * one exit. Two unrelated transfers sit beside it to show that ordinary activity stays ordinary.
 *
 * There are two compositions of the same data: a wide one (desktop, tablet) and a tall one (phone), so the labels stay
 * readable instead of the whole picture shrinking.
 */

// the ten transfers, in time order
export const TRANSACTIONS = [
  { id: "T01", src: "A01", dst: "A05" },
  { id: "T02", src: "A02", dst: "A05" },
  { id: "T03", src: "A03", dst: "A05" },
  { id: "T04", src: "A04", dst: "A05" },
  { id: "T05", src: "A05", dst: "A06" },
  { id: "T06", src: "A05", dst: "A07" },
  { id: "T07", src: "A06", dst: "A08" },
  { id: "T08", src: "A07", dst: "A08" },
  { id: "T09", src: "A09", dst: "A10" },
  { id: "T10", src: "A11", dst: "A12" },
];

// accounts that form the illustrative cluster; T09 and T10 stay outside it
export const CLUSTER = ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08"];

export const LAYOUTS = {
  wide: {
    view: { width: 1000, height: 380 },
    accounts: {
      A01: { x: 110, y: 70 }, A02: { x: 110, y: 150 }, A03: { x: 110, y: 230 }, A04: { x: 110, y: 310 },
      A05: { x: 380, y: 190 },
      A06: { x: 620, y: 115 }, A07: { x: 620, y: 265 },
      A08: { x: 860, y: 190 },
      A09: { x: 700, y: 40 }, A10: { x: 850, y: 40 },
      A11: { x: 700, y: 340 }, A12: { x: 850, y: 340 },
    },
    // transfer i on its own: a grid of five by two
    tile(i) {
      const col = i % 5, row = Math.floor(i / 5);
      const cx = 96 + col * 202, cy = 130 + row * 150;
      return { src: { x: cx - 42, y: cy }, dst: { x: cx + 42, y: cy }, cx, cy };
    },
  },
  tall: {
    view: { width: 360, height: 600 },
    accounts: {
      A01: { x: 44, y: 60 }, A02: { x: 44, y: 140 }, A03: { x: 44, y: 220 }, A04: { x: 44, y: 300 },
      A05: { x: 150, y: 180 },
      A06: { x: 236, y: 110 }, A07: { x: 236, y: 250 },
      A08: { x: 318, y: 180 },
      A09: { x: 90, y: 440 }, A10: { x: 210, y: 440 },
      A11: { x: 90, y: 520 }, A12: { x: 210, y: 520 },
    },
    // two columns by five rows
    tile(i) {
      const col = i % 2, row = Math.floor(i / 2);
      const cx = 92 + col * 176, cy = 86 + row * 112;
      return { src: { x: cx - 36, y: cy }, dst: { x: cx + 36, y: cy }, cx, cy };
    },
  },
};

export const lerp = (a, b, t) => a + (b - a) * t;
