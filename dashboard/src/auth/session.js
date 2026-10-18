/**
 * Demo sign-in. NOT authentication.
 *
 * The system has no user accounts, no passwords and no server-side session: the API listens on the
 * VM's loopback and is reached through an SSH tunnel. Choosing a role only decides which screens the
 * dashboard shows, and the choice is kept in this browser tab (sessionStorage). Nothing secret is asked,
 * stored or sent. A real deployment would put the institution's single sign-on in front of this.
 */
import { useEffect, useState } from "react";

export const ROLES = {
  customer: {
    id: "customer", label: "Customer", short: "Customer",
    blurb: "Check who you are about to pay before you send money.",
    sees: ["Check a payment before you send it", "A plain-language warning with the reasons", "Your checks in this session"],
    home: "/protect",
    nav: [{ to: "/protect", label: "Protection" }],
    allow: ["/protect", "/warning"],
  },
  bank: {
    id: "bank", label: "Bank analyst", short: "Analyst",
    blurb: "Review flagged rings, the reasons behind them and who recently paid in.",
    sees: ["Flagged rings with the money flow", "Why each ring was flagged, including absences", "Likely-victim flags and the assistant"],
    home: "/monitor",
    nav: [{ to: "/monitor", label: "Rings" }, { to: "/alerts", label: "Alerts" }, { to: "/assistant", label: "Assistant" }],
    allow: ["/monitor", "/alerts", "/ring", "/account", "/warning", "/assistant"],
  },
  admin: {
    id: "admin", label: "Administrator", short: "Admin",
    blurb: "Watch system health, data freshness and how the service is configured.",
    sees: ["Backend mode, rebuild time and state age", "How much history is loaded", "What is synthetic in this deployment"],
    home: "/admin",
    nav: [{ to: "/admin", label: "System" }, { to: "/monitor", label: "Rings" }, { to: "/alerts", label: "Alerts" }],
    allow: ["/admin", "/monitor", "/alerts", "/ring"],
  },
  regulator: {
    id: "regulator", label: "Government and regulator", short: "Regulator",
    blurb: "See the overall picture: how many rings, how risky, how current. No account-level drill-down.",
    sees: ["Counts by risk band and ring size", "How current the data is", "Limits of the evidence, stated up front"],
    home: "/oversight",
    nav: [{ to: "/oversight", label: "Oversight" }, { to: "/monitor", label: "Rings" }],
    allow: ["/oversight", "/monitor", "/ring"],
  },
};

export const ROLE_LIST = Object.values(ROLES);
const KEY = "nexusz.demo-session";
const EVENT = "nexusz-session";

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

export function getSession() {
  const raw = safe(() => window.sessionStorage.getItem(KEY));
  if (!raw) return null;
  const s = safe(() => JSON.parse(raw));
  return s && ROLES[s.role] ? s : null;
}

export function signIn(role, name = "") {
  if (!ROLES[role]) return null;
  const s = { role, name: String(name).trim().slice(0, 60), at: Date.now() };
  safe(() => window.sessionStorage.setItem(KEY, JSON.stringify(s)));
  window.dispatchEvent(new Event(EVENT));
  return s;
}

export function signOut() {
  safe(() => window.sessionStorage.removeItem(KEY));
  window.dispatchEvent(new Event(EVENT));
}

export function useSession() {
  const [session, setSession] = useState(getSession);
  useEffect(() => {
    const update = () => setSession(getSession());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener("storage", update); };
  }, []);
  return session;
}

/** Is this path one the role may open? A match on the first path segment. */
export function allowed(role, pathname) {
  const r = ROLES[role];
  if (!r) return false;
  const first = "/" + (pathname.split("/")[1] || "");
  return r.allow.includes(first);
}

export function homeFor(role) {
  return ROLES[role]?.home || "/login";
}

/** Where "back to the list" should go for whoever is signed in (the landing page when nobody is). */
export function useHome() {
  const session = useSession();
  return session ? homeFor(session.role) : "/";
}
