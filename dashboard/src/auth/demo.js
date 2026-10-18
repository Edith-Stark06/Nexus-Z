/**
 * Public demo logins, one per role, so the system can be tried without signing up.
 *
 * The username and password are written here and shown on the sign-in page: they are not secret and give access
 * to nothing but the demo screens (the accounts, like all accounts here, live in this browser only). Turn them off
 * for a build with  VITE_DEMO_ACCOUNTS=off  and they are neither created nor shown.
 */
import { listAccounts, signUp } from "./accounts";

export const DEMO_PASSWORD = "NexusZ-demo-2026";
export const DEMO_ACCOUNTS = [
  { role: "customer", username: "demo.customer", name: "Demo customer" },
  { role: "bank", username: "demo.bank", name: "Demo analyst" },
  { role: "admin", username: "demo.admin", name: "Demo admin" },
  { role: "regulator", username: "demo.regulator", name: "Demo regulator" },
];

export const demoEnabled = () => !(typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_DEMO_ACCOUNTS === "off");

export const demoFor = (role) => (demoEnabled() ? DEMO_ACCOUNTS.find((d) => d.role === role) || null : null);

let seeding = null;

/** For tests: wait for any demo accounts still being created. */
export const _pending = () => seeding || Promise.resolve();

/** Create any demo account this browser does not have yet. Safe to call as often as you like. */
export function ensureDemoAccounts() {
  if (!demoEnabled()) return Promise.resolve();
  if (!seeding) {
    seeding = (async () => {
      const have = new Set(listAccounts().map((a) => a.username));
      for (const d of DEMO_ACCOUNTS) {
        if (!have.has(d.username)) await signUp({ ...d, password: DEMO_PASSWORD, allowReserved: true });
      }
    })().finally(() => { seeding = null; });
  }
  return seeding;
}
