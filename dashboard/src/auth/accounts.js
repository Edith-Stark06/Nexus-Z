/**
 * Demo accounts that live in this browser only.
 *
 * There is no server-side login: the API listens on the machine's loopback and has no user accounts. These
 * accounts let someone sign up and sign in with a password inside this browser, and choose which screens they
 * see. The password is never stored: only a random salt and a PBKDF2-SHA256 hash of it are kept in localStorage.
 * Nothing is sent anywhere. This is a demo of the flow, not protection for the data behind it; a real deployment
 * would put the institution's single sign-on in front of the API.
 */
import { ROLES } from "./session";

const KEY = "nexusz.demo-accounts";
const LOCK_KEY = "nexusz.demo-lock";
export const MAX_ACCOUNTS = 50;
export const MAX_FAILS = 5;
export const LOCK_MS = 30_000;
let iterations = 210_000; // OWASP's 2023 guidance for PBKDF2-HMAC-SHA256

/** For tests only: fewer rounds so a test does not wait. Accounts store their own count, so old ones still verify. */
export function _setIterations(n) { iterations = n; }

const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "qwertyui", "qwerty123", "iloveyou", "11111111", "abcd1234", "letmein1", "admin123"]);

function read(key, fallback) {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const normalizeUsername = (u) => String(u || "").trim().toLowerCase();

export function validateUsername(u) {
  const n = normalizeUsername(u);
  if (n.length < 3 || n.length > 32) return "Use 3 to 32 characters for the username.";
  if (!/^[a-z0-9][a-z0-9._@-]*$/.test(n)) return "Use letters, numbers and . _ @ - only, starting with a letter or number.";
  return null;
}

export function validatePassword(p, username = "") {
  const s = String(p || "");
  if (s.length < 8) return "Use at least 8 characters for the password.";
  if (s.length > 128) return "Use at most 128 characters for the password.";
  if (new Set(s).size < 3) return "That password is too repetitive.";
  if (COMMON.has(s.toLowerCase())) return "That password is too common.";
  if (username && s.toLowerCase() === normalizeUsername(username)) return "The password must not be the same as the username.";
  return null;
}

/** 0 to 4: a rough guide shown next to the password box (length and variety only, not a security guarantee). */
export function strength(p) {
  const s = String(p || "");
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s) && /[^A-Za-z0-9]/.test(s)) score++;
  return COMMON.has(s.toLowerCase()) ? 0 : score;
}

const enc = new TextEncoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("This browser cannot hash passwords here. Open the site on localhost or over HTTPS.");
  return c;
}

async function derive(password, salt, rounds) {
  const c = subtle();
  const key = await c.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await c.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function listAccounts() {
  return Object.values(read(KEY, {})).map(({ username, name, role }) => ({ username, name, role }));
}

export async function signUp({ username, name = "", password, role }) {
  if (!ROLES[role]) return { ok: false, error: "Choose a role." };
  const uErr = validateUsername(username);
  if (uErr) return { ok: false, error: uErr };
  const pErr = validatePassword(password, username);
  if (pErr) return { ok: false, error: pErr };
  const accounts = read(KEY, {});
  const key = normalizeUsername(username);
  if (accounts[key]) return { ok: false, error: "That username is taken. Sign in or choose another." };
  if (Object.keys(accounts).length >= MAX_ACCOUNTS) return { ok: false, error: "This browser already holds the most demo accounts it allows." };
  let hash;
  const salt = globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(16)) : null;
  try {
    if (!salt) throw new Error("This browser cannot create random salts here. Open the site on localhost or over HTTPS.");
    hash = await derive(password, salt, iterations);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  accounts[key] = { username: key, name: String(name).trim().slice(0, 60), role, salt: toB64(salt), hash: toB64(hash), iterations, createdAt: Date.now() };
  if (!write(KEY, accounts)) return { ok: false, error: "This browser would not save the account (private window or storage blocked)." };
  return { ok: true, account: { username: key, name: accounts[key].name, role } };
}

function lockState(key) {
  const l = read(LOCK_KEY, {})[key];
  return l && l.until > Date.now() ? Math.ceil((l.until - Date.now()) / 1000) : 0;
}
function recordFailure(key) {
  const all = read(LOCK_KEY, {});
  const cur = all[key] && all[key].until > Date.now() ? all[key] : { fails: all[key] ? all[key].fails : 0, until: 0 };
  cur.fails += 1;
  if (cur.fails >= MAX_FAILS) { cur.until = Date.now() + LOCK_MS; cur.fails = 0; }
  all[key] = cur;
  write(LOCK_KEY, all);
}
function clearFailures(key) {
  const all = read(LOCK_KEY, {});
  delete all[key];
  write(LOCK_KEY, all);
}

/** Check a username and password. The answer is the same for a wrong username and a wrong password. */
export async function verifyLogin({ username, password, role }) {
  const key = normalizeUsername(username);
  const wait = lockState(key);
  if (wait) return { ok: false, locked: true, error: `Too many attempts. Try again in ${wait} seconds.` };
  const account = read(KEY, {})[key];
  let good = false;
  try {
    // an unknown username still costs one hash, so the two cases take about the same time
    const salt = account ? fromB64(account.salt) : new Uint8Array(16);
    const got = await derive(String(password || ""), salt, account ? account.iterations : iterations);
    good = !!account && sameBytes(got, fromB64(account.hash));
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!good) {
    recordFailure(key);
    return { ok: false, error: "The username or password is not right." };
  }
  clearFailures(key);
  if (role && account.role !== role) {
    return { ok: false, wrongRole: account.role, error: `This account is registered as ${ROLES[account.role].label}. Sign in from that role.` };
  }
  return { ok: true, account: { username: account.username, name: account.name, role: account.role } };
}
