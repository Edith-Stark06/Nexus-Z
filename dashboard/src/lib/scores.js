/**
 * How scores are named and shown. There are two different numbers in the API and they are never mixed:
 *
 *   ring score     0 to 100 (an integer). `risk` on /rings and /rings/{id}. A small ring-level model (ml/ring_score.py) rates
 *                  how much a detected group resembles the laundering rings it was fitted on.
 *   account score  0 to 1 (a decimal). `score` on a ring member and `risk` on /accounts/{id}. The account model's output,
 *                  calibrated on the project's evaluation data (ml/model.py).
 *
 * They come from different models, so 77 on a ring and 0.78 on an account are not the same number on two scales. Neither is
 * the probability of fraud for a real customer, and neither is a finding.
 */
export const RING_SCORE = { name: "Ring score", scale: "0–100", max: 100 };
export const ACCOUNT_SCORE = { name: "Account score", scale: "0–1", max: 1 };

const finite = (v) => v != null && v !== "" && Number.isFinite(Number(v));

/** "77": the ring score as the API gives it, on its own 0 to 100 scale. */
export function ringScore(v) {
  return finite(v) ? String(Math.round(Number(v))) : "—";
}

/** "0.78": the account score as the API gives it, on its own 0 to 1 scale, to two places. */
export function accountScore(v) {
  return finite(v) ? Number(v).toFixed(2) : "—";
}

export const ringScoreFull = (v) => (finite(v) ? `${ringScore(v)} / 100` : "—");
export const accountScoreFull = (v) => (finite(v) ? `${accountScore(v)} / 1` : "—");

/** The 0 to 100 position used only to draw a bar and to pick a tone; the number itself is always shown on its own scale. */
export const ringPct = (v) => (finite(v) ? Math.max(0, Math.min(100, Number(v))) : null);
export const accountPct = (v) => (finite(v) ? Math.max(0, Math.min(100, Number(v) * 100)) : null);

export const RING_SCORE_NOTE =
  "Ring score (0–100) comes from a ring-level model that rates how much a flagged group resembles the laundering rings it was fitted on. It is an automated signal for review, not a probability of fraud and not a finding.";
export const ACCOUNT_SCORE_NOTE =
  "Account score (0–1) is the account model's calibrated output, fitted on the project's evaluation data. It is a different model from the ring score, so the two numbers are not comparable. It is not a finding of fraud.";
export const RING_SCORE_SHORT = "Ring score, 0–100: a ring-level model's output. A signal for review, not a probability of fraud and not a finding.";
export const ACCOUNT_SCORE_SHORT = "Account score, 0–1: the account model's output, a different model from the ring score. Not a finding of fraud.";
export const ROLE_NOTE = "Roles are estimated from where an account sits in the ring's payments. The data carries no role labels.";
export const AMOUNT_NOTE = "Amounts are shown as recorded. The API does not report a currency, so they are not summed or converted.";
