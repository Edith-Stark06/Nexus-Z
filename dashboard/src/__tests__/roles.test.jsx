import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import Landing from "../pages/Landing";
import { RoleChooser, RoleLogin } from "../pages/Login";
import RequireRole from "../auth/RequireRole";
import { ROLES, ROLE_LIST, allowed, getSession, homeFor, signIn, signOut } from "../auth/session";
import { _setIterations, signUp } from "../auth/accounts";
import { _pending } from "../auth/demo";

vi.mock("../services/api", () => ({
  API_BASE: "http://localhost:8000",
  health: vi.fn(),
  getAccount: vi.fn(),
  startPolling: vi.fn(() => () => {}),
  listRings: vi.fn(),
  listAlerts: vi.fn(),
  getRing: vi.fn(),
}));
import * as api from "../services/api";
import Protect from "../pages/Protect";
import Admin from "../pages/Admin";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

beforeEach(async () => { await _pending(); window.localStorage.clear(); window.sessionStorage.clear(); _setIterations(1000); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("demo session", () => {
  it("signs in, reads back and signs out", () => {
    expect(getSession()).toBeNull();
    signIn("bank", "  Asha  ");
    expect(getSession()).toMatchObject({ role: "bank", name: "Asha" });
    signOut();
    expect(getSession()).toBeNull();
  });

  it("ignores an unknown role and a damaged stored value", () => {
    expect(signIn("emperor")).toBeNull();
    window.sessionStorage.setItem("nexusz.demo-session", "{not json");
    expect(getSession()).toBeNull();
    window.sessionStorage.setItem("nexusz.demo-session", JSON.stringify({ role: "emperor" }));
    expect(getSession()).toBeNull();
  });

  it("each role may open only its own screens", () => {
    expect(allowed("customer", "/protect")).toBe(true);
    expect(allowed("customer", "/monitor")).toBe(false);
    expect(allowed("customer", "/ring/RNG-1")).toBe(false);
    expect(allowed("bank", "/ring/RNG-1")).toBe(true);
    expect(allowed("bank", "/admin")).toBe(false);
    expect(allowed("admin", "/admin")).toBe(true);
    expect(allowed("admin", "/assistant")).toBe(true);
    expect(allowed("regulator", "/assistant")).toBe(false);
    expect(allowed("customer", "/assistant")).toBe(false);
    expect(allowed("regulator", "/oversight")).toBe(true);
    expect(allowed("regulator", "/account/ACC-1")).toBe(false);
    expect(allowed("regulator", "/alerts")).toBe(false);
    expect(allowed("nobody", "/monitor")).toBe(false);
  });

  it("every role has a home it may open and nav links it may open", () => {
    for (const r of ROLE_LIST) {
      expect(allowed(r.id, homeFor(r.id))).toBe(true);
      for (const n of r.nav) expect(allowed(r.id, n.to)).toBe(true);
    }
  });
});

describe("route guard", () => {
  const tree = (start) => (
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/login" element={<Where />} />
        <Route path="/monitor" element={<RequireRole><Where /></RequireRole>} />
        <Route path="/admin" element={<RequireRole><Where /></RequireRole>} />
      </Routes>
    </MemoryRouter>
  );

  it("sends a visitor with no session to the sign-in page", () => {
    render(tree("/monitor"));
    expect(screen.getByTestId("where").textContent).toBe("/login");
  });

  it("lets a role in and bounces it from a screen it may not open", () => {
    signIn("bank");
    render(tree("/monitor"));
    expect(screen.getByTestId("where").textContent).toBe("/monitor");
    cleanup();
    render(tree("/admin"));
    expect(screen.getByTestId("where").textContent).toBe("/monitor");
  });
});

describe("landing and sign-in", () => {
  it("the landing page says the data is synthetic and links to every role", () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);
    expect(screen.getAllByText(/synthetic/i).length).toBeGreaterThan(0);
    for (const r of ROLE_LIST) {
      expect(screen.getByRole("link", { name: new RegExp(`Sign in as ${r.label}`, "i") }).getAttribute("href")).toBe(`/login/${r.id}`);
    }
    expect(document.body.textContent).not.toMatch(/real-time|instant/i);
  });

  it("the chooser lists the four roles and says where accounts are kept", () => {
    render(<MemoryRouter><RoleChooser /></MemoryRouter>);
    expect(screen.getAllByRole("link", { name: /Customer|Bank analyst|Administrator|Government and regulator/ }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("note").textContent).toMatch(/Demo accounts/);
    expect(screen.getByRole("note").textContent).toMatch(/this browser only/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("a signed-up user signs in with the password and lands on that role's home", async () => {
    await signUp({ username: "drrao", name: "Dr Rao", password: "correct horse 9", role: "regulator" });
    render(
      <MemoryRouter initialEntries={["/login/regulator"]}>
        <Routes>
          <Route path="/login/:role" element={<RoleLogin />} />
          <Route path="/oversight" element={<Where />} />
          <Route path="/login" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "drrao" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse 9" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/oversight"));
    expect(getSession()).toMatchObject({ role: "regulator", name: "Dr Rao" });
  });

  it("a wrong password is refused, says so, and does not sign in", async () => {
    await signUp({ username: "asha", password: "correct horse 9", role: "bank" });
    render(<MemoryRouter initialEntries={["/login/bank"]}><Routes><Route path="/login/:role" element={<RoleLogin />} /></Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "asha" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not right/);
    expect(getSession()).toBeNull();
  });

  it("an unknown role goes back to the chooser", () => {
    render(
      <MemoryRouter initialEntries={["/login/emperor"]}>
        <Routes>
          <Route path="/login/:role" element={<RoleLogin />} />
          <Route path="/login" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("where").textContent).toBe("/login");
  });
});

describe("customer check", () => {
  const renderProtect = () => {
    signIn("customer");
    return render(
      <MemoryRouter initialEntries={["/protect"]}>
        <Routes>
          <Route path="/protect" element={<Protect />} />
          <Route path="/warning/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
  };
  const check = (value) => {
    fireEvent.change(screen.getByLabelText(/Recipient account/i), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /Check account/i }));
  };

  it("opens the warning for an account that is in a flagged ring", async () => {
    api.getAccount.mockResolvedValue({ data: { account_id: "ACC-1", ring_id: "RNG-1", risk: 0.99 }, usingMock: false });
    renderProtect();
    check("ACC-1");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/warning/ACC-1"));
  });

  it("says plainly when an account is known but not flagged, without calling it safe", async () => {
    api.getAccount.mockResolvedValue({ data: { account_id: "ACC-2", ring_id: null, risk: 0.01 }, usingMock: false });
    renderProtect();
    check("ACC-2");
    const note = await screen.findByRole("status");
    expect(note.textContent).toMatch(/No flag found for ACC-2/);
    expect(note.textContent).toMatch(/does not prove it is safe/);
  });

  it("says so when the account is not in the data, and keeps the check in the session list", async () => {
    api.getAccount.mockResolvedValue({ data: null, usingMock: false });
    renderProtect();
    check("ACC-NOPE");
    const note = await screen.findByRole("status");
    expect(note.textContent).toMatch(/could not find ACC-NOPE/);
    expect(screen.getByText("Not in our data")).toBeTruthy();
  });

  it("does not send a form post and ignores an empty box", () => {
    renderProtect();
    expect(screen.getByRole("button", { name: /Check account/i }).disabled).toBe(true);
    expect(api.getAccount).not.toHaveBeenCalled();
  });
});

describe("administrator system screen", () => {
  it("shows the backend and says when it is sample-data mode", async () => {
    api.health.mockResolvedValue({ status: "ok", backend: "stub" });
    signIn("admin");
    render(<MemoryRouter><Admin /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Sample-data mode/)).toBeTruthy());
  });

  it("shows numbers with a fixed grouping, not the machine's locale", async () => {
    api.health.mockResolvedValue({ status: "ok", backend: "model", history_transactions: 656743, pending_transactions: 0, last_rebuild_seconds: 36.8, state_age_seconds: 4, refreshes_completed: 2 });
    signIn("admin");
    render(<MemoryRouter><Admin /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("656,743")).toBeTruthy());
    expect(screen.queryByText(/Sample-data mode/)).toBeNull();
  });

  it("says when the API cannot be reached", async () => {
    api.health.mockRejectedValue(new Error("down"));
    signIn("admin");
    render(<MemoryRouter><Admin /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not reachable/));
  });
});

describe("role definitions", () => {
  it("four roles, each with a distinct home", () => {
    expect(Object.keys(ROLES).sort()).toEqual(["admin", "bank", "customer", "regulator"]);
    expect(new Set(ROLE_LIST.map((r) => r.home)).size).toBe(4);
  });
});
