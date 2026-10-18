import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { _setIterations, listAccounts, signUp, verifyLogin } from "../auth/accounts";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, _pending, demoEnabled, demoFor, ensureDemoAccounts } from "../auth/demo";
import { ROLES, getSession } from "../auth/session";
import { RoleLogin } from "../pages/Login";

beforeEach(async () => { await _pending(); window.localStorage.clear(); window.sessionStorage.clear(); _setIterations(1000); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

describe("demo accounts", () => {
  it("there is one for each role, with a name that cannot be mistaken for a real one", () => {
    expect(DEMO_ACCOUNTS.map((d) => d.role).sort()).toEqual(Object.keys(ROLES).sort());
    for (const d of DEMO_ACCOUNTS) expect(d.username).toMatch(/^demo\./);
  });

  it("are created once, and sign in with the shown password into their own role only", async () => {
    await ensureDemoAccounts();
    await ensureDemoAccounts(); // a second call changes nothing
    expect(listAccounts().map((a) => a.username).sort()).toEqual(DEMO_ACCOUNTS.map((d) => d.username).sort());
    for (const d of DEMO_ACCOUNTS) {
      expect((await verifyLogin({ username: d.username, password: DEMO_PASSWORD, role: d.role })).ok, d.role).toBe(true);
    }
    const wrongRole = await verifyLogin({ username: "demo.customer", password: DEMO_PASSWORD, role: "admin" });
    expect(wrongRole.ok).toBe(false);
    expect(wrongRole.wrongRole).toBe("customer");
    expect((await verifyLogin({ username: "demo.bank", password: "not the password", role: "bank" })).ok).toBe(false);
  });

  it("make only the missing ones, and keep an account the person changed or made themselves", async () => {
    await signUp({ username: "asha", password: "correct horse 9", role: "bank" });
    await ensureDemoAccounts();
    expect(listAccounts()).toHaveLength(1 + DEMO_ACCOUNTS.length);
    window.localStorage.setItem("nexusz.demo-accounts", JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(window.localStorage.getItem("nexusz.demo-accounts"))).filter(([k]) => k !== "demo.admin"))));
    await ensureDemoAccounts();
    expect(listAccounts().map((a) => a.username)).toContain("demo.admin");
    expect(listAccounts().map((a) => a.username)).toContain("asha");
  });

  it("keep the demo. names for themselves, so a person cannot sign up as one", async () => {
    const res = await signUp({ username: "demo.bank", password: "correct horse 9", role: "bank" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/kept for the demo accounts/);
    expect((await signUp({ username: "Demo.Admin", password: "correct horse 9", role: "admin" })).ok).toBe(false);
  });

  it("can be switched off for a build, and then are neither created nor shown", async () => {
    vi.stubEnv("VITE_DEMO_ACCOUNTS", "off");
    expect(demoEnabled()).toBe(false);
    expect(demoFor("bank")).toBeNull();
    await ensureDemoAccounts();
    expect(listAccounts()).toHaveLength(0);
  });
});

describe("the sign-in page with a demo login", () => {
  const renderLogin = (role) => render(
    <MemoryRouter initialEntries={[`/login/${role}`]}>
      <Routes>
        <Route path="/login/:role" element={<RoleLogin />} />
        <Route path="/monitor" element={<Where />} />
        <Route path="/protect" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );

  it("shows the demo username and password for the role being signed into, and no other role's", () => {
    renderLogin("bank");
    const box = screen.getByRole("group", { name: "Demo login" });
    expect(box.textContent).toMatch(/demo\.bank/);
    expect(box.textContent).toContain(DEMO_PASSWORD);
    expect(box.textContent).not.toMatch(/demo\.admin/);
  });

  it("'Use these' fills the form, and Sign in then reaches that role's home", async () => {
    renderLogin("bank");
    fireEvent.click(screen.getByRole("button", { name: "Use these" }));
    expect(screen.getByLabelText("Username").value).toBe("demo.bank");
    expect(screen.getByLabelText("Password").value).toBe(DEMO_PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/monitor"));
    expect(getSession()).toMatchObject({ role: "bank" });
  });

  it("works on a first visit with no accounts yet, because signing in makes the demo accounts first", async () => {
    expect(listAccounts()).toHaveLength(0);
    renderLogin("customer");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "demo.customer" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: DEMO_PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/protect"));
  });

  it("shows no demo box when the demo logins are switched off", () => {
    vi.stubEnv("VITE_DEMO_ACCOUNTS", "off");
    renderLogin("bank");
    expect(screen.queryByRole("group", { name: "Demo login" })).toBeNull();
  });
});
