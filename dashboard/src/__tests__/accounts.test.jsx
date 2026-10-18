import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import {
  LOCK_MS, MAX_ACCOUNTS, MAX_FAILS, _setIterations, listAccounts, normalizeUsername, signUp, strength, validatePassword, validateUsername, verifyLogin,
} from "../auth/accounts";
import { RoleSignup } from "../pages/Login";
import { getSession } from "../auth/session";
import { _pending } from "../auth/demo";

const GOOD = "correct horse 9";

beforeEach(async () => { await _pending(); window.localStorage.clear(); window.sessionStorage.clear(); _setIterations(1000); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("username and password rules", () => {
  it("accepts a sensible username and normalises its case", () => {
    expect(validateUsername("Asha.R_01")).toBeNull();
    expect(normalizeUsername("  Asha.R_01 ")).toBe("asha.r_01");
  });

  it("rejects usernames that are too short, too long or use odd characters", () => {
    expect(validateUsername("ab")).toMatch(/3 to 32/);
    expect(validateUsername("a".repeat(33))).toMatch(/3 to 32/);
    expect(validateUsername("bad name")).toMatch(/letters, numbers/);
    expect(validateUsername("-start")).toMatch(/starting with/);
  });

  it("rejects short, repetitive, common and username-equal passwords", () => {
    expect(validatePassword("short")).toMatch(/at least 8/);
    expect(validatePassword("aaaaaaaa")).toMatch(/repetitive/);
    expect(validatePassword("Tr0ub4dor&3")).toBeNull();
    expect(validatePassword("password")).toMatch(/at least 8|common/);
    expect(validatePassword("12345678")).toMatch(/common/);
    expect(validatePassword("asha.r_01", "ASHA.R_01")).toMatch(/same as the username/);
    expect(validatePassword("x".repeat(129))).toMatch(/at most 128/);
    expect(validatePassword(GOOD, "asha")).toBeNull();
  });

  it("scores strength by length and variety, and calls a common password weak", () => {
    expect(strength("")).toBe(0);
    expect(strength("12345678")).toBe(0);
    expect(strength("abcdefgh")).toBe(1);
    expect(strength("Abcdefgh1234!")).toBe(4);
    expect(strength("abcdefghijkl")).toBe(2);
  });
});

describe("signing up", () => {
  it("creates an account and never stores the password, only a salt and a hash", async () => {
    const res = await signUp({ username: "Asha", name: " Asha R ", password: GOOD, role: "bank" });
    expect(res).toMatchObject({ ok: true, account: { username: "asha", name: "Asha R", role: "bank" } });
    const raw = window.localStorage.getItem("nexusz.demo-accounts");
    expect(raw).not.toContain(GOOD);
    const stored = JSON.parse(raw).asha;
    expect(stored.hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(stored.salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(stored.iterations).toBe(1000);
    expect(listAccounts()).toEqual([{ username: "asha", name: "Asha R", role: "bank" }]);
  });

  it("keeps every account when sign-ups overlap, instead of the last one erasing the others", async () => {
    const results = await Promise.all(["one1", "two2", "three3", "four4"].map((u) => signUp({ username: u, password: GOOD, role: "bank" })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(listAccounts().map((a) => a.username).sort()).toEqual(["four4", "one1", "three3", "two2"]);
  });

  it("does not let two overlapping sign-ups both take the same username", async () => {
    const [a, b] = await Promise.all([signUp({ username: "same1", password: GOOD, role: "bank" }), signUp({ username: "same1", password: GOOD, role: "admin" })]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(listAccounts()).toHaveLength(1);
  });

  it("gives two accounts with the same password different salts and hashes", async () => {
    await signUp({ username: "one", password: GOOD, role: "bank" });
    await signUp({ username: "two", password: GOOD, role: "bank" });
    const a = JSON.parse(window.localStorage.getItem("nexusz.demo-accounts"));
    expect(a.one.salt).not.toBe(a.two.salt);
    expect(a.one.hash).not.toBe(a.two.hash);
  });

  it("refuses a taken username, a bad role and invalid input, and saves nothing", async () => {
    await signUp({ username: "asha", password: GOOD, role: "bank" });
    expect((await signUp({ username: "ASHA", password: GOOD, role: "admin" })).error).toMatch(/taken/);
    expect((await signUp({ username: "new1", password: GOOD, role: "emperor" })).error).toMatch(/Choose a role/);
    expect((await signUp({ username: "n", password: GOOD, role: "bank" })).ok).toBe(false);
    expect((await signUp({ username: "new2", password: "short", role: "bank" })).ok).toBe(false);
    expect(listAccounts()).toHaveLength(1);
  });

  it("stops at the most accounts one browser may hold", async () => {
    const accounts = {};
    for (let i = 0; i < MAX_ACCOUNTS; i++) accounts[`user${i}`] = { username: `user${i}`, name: "", role: "bank", salt: "AA==", hash: "AA==", iterations: 1 };
    window.localStorage.setItem("nexusz.demo-accounts", JSON.stringify(accounts));
    expect((await signUp({ username: "onemore", password: GOOD, role: "bank" })).error).toMatch(/most demo accounts/);
  });

  it("says so when the browser will not save an account", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect((await signUp({ username: "asha", password: GOOD, role: "bank" })).error).toMatch(/would not save/);
    spy.mockRestore();
  });
});

describe("signing in", () => {
  beforeEach(async () => { await signUp({ username: "asha", name: "Asha", password: GOOD, role: "bank" }); });

  it("accepts the right password, in any case of the username", async () => {
    expect(await verifyLogin({ username: "ASHA", password: GOOD, role: "bank" })).toMatchObject({ ok: true, account: { username: "asha", role: "bank" } });
  });

  it("gives the same answer for a wrong password and a username that does not exist", async () => {
    const wrong = await verifyLogin({ username: "asha", password: "nope nope nope", role: "bank" });
    const unknown = await verifyLogin({ username: "nobody", password: GOOD, role: "bank" });
    expect(wrong).toEqual(unknown);
    expect(wrong.ok).toBe(false);
  });

  it("does not let a password into a role the account does not have, and names the right one", async () => {
    const res = await verifyLogin({ username: "asha", password: GOOD, role: "admin" });
    expect(res.ok).toBe(false);
    expect(res.wrongRole).toBe("bank");
    expect(res.error).toMatch(/registered as Bank analyst/);
  });

  it("locks the username for a while after repeated failures, even for the right password", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < MAX_FAILS; i++) await verifyLogin({ username: "asha", password: "wrong wrong", role: "bank" });
    const locked = await verifyLogin({ username: "asha", password: GOOD, role: "bank" });
    expect(locked).toMatchObject({ ok: false, locked: true });
    expect(locked.error).toMatch(/Too many attempts/);
    vi.setSystemTime(Date.now() + LOCK_MS + 1000);
    expect((await verifyLogin({ username: "asha", password: GOOD, role: "bank" })).ok).toBe(true);
  });

  it("a successful sign-in clears the count of failures", async () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) await verifyLogin({ username: "asha", password: "wrong wrong", role: "bank" });
    expect((await verifyLogin({ username: "asha", password: GOOD, role: "bank" })).ok).toBe(true);
    for (let i = 0; i < MAX_FAILS - 1; i++) await verifyLogin({ username: "asha", password: "wrong wrong", role: "bank" });
    expect((await verifyLogin({ username: "asha", password: GOOD, role: "bank" })).ok).toBe(true);
  });

  it("an account made with other settings still verifies, because it stores its own", async () => {
    _setIterations(5000);
    await signUp({ username: "later", password: GOOD, role: "admin" });
    _setIterations(1000);
    expect((await verifyLogin({ username: "later", password: GOOD, role: "admin" })).ok).toBe(true);
  });
});

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

describe("the sign-up page", () => {
  const renderSignup = (role = "customer") => render(
    <MemoryRouter initialEntries={[`/signup/${role}`]}>
      <Routes>
        <Route path="/signup/:role" element={<RoleSignup />} />
        <Route path="/protect" element={<Where />} />
        <Route path="/login" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  const fill = (u, p, again) => {
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: u } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: p } });
    fireEvent.change(screen.getByLabelText("Repeat the password"), { target: { value: again } });
  };

  it("creates the account, signs in and goes to the role's home", async () => {
    renderSignup("customer");
    fill("kiran", GOOD, GOOD);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/protect"));
    expect(getSession()).toMatchObject({ role: "customer" });
    expect(listAccounts()).toHaveLength(1);
  });

  it("keeps the button off until everything is filled, and warns when the passwords differ", () => {
    renderSignup();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    fill("kiran", GOOD, "something else");
    expect(screen.getByText("The two passwords do not match.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(getSession()).toBeNull();
    expect(listAccounts()).toHaveLength(0);
  });

  it("explains a weak password as you type, and shows or hides the password on request", () => {
    renderSignup();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "12345678" } });
    expect(screen.getByText(/too common/)).toBeInTheDocument();
    const field = screen.getByLabelText("Password");
    expect(field.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field.type).toBe("text");
  });

  it("says plainly that the account lives in this browser and does not protect the data", () => {
    renderSignup();
    expect(screen.getByRole("note").textContent).toMatch(/this browser only/);
    expect(screen.getByRole("note").textContent).toMatch(/does not protect/);
    expect(screen.getByRole("note").textContent).toMatch(/Do not use a password you use anywhere else/);
  });
});
