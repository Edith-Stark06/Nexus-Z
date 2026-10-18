import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { DataProvider } from "../state/DataContext";
import Alerts from "../pages/Alerts";
import Accounts from "../pages/Accounts";
import Overview from "../pages/Overview";
import WarningScreen from "../pages/WarningScreen";

const T = (m) => `2022-09-09T${m}:00Z`;
const HEALTH = { status: "ok", backend: "model", data_as_of: T("23:59"), history_transactions: 1000, state_age_seconds: 30, refreshes_completed: 0, last_rebuild_seconds: 2.5, pending_transactions: 0, refreshing: false, last_error: null };
const ringSummary = (id, risk) => ({ ring_id: id, risk, accounts: 3, victims: 1, headline: `Headline of ${id}`, first_seen: T("01:00"), flagged_at: T("23:59") });
const RINGS = [ringSummary("RNG-AAA111", 90), ringSummary("RNG-BBB222", 40)];
const DETAIL = {
  "RNG-AAA111": { ...RINGS[0], total_amount: 99, members: [{ id: "ACC-V1", role: "victim", score: 0.3 }, { id: "ACC-C1", role: "collector", score: 0.95 }], edges: [], top_reasons: [] },
  "RNG-BBB222": { ...RINGS[1], total_amount: 5, members: [{ id: "ACC-V2", role: "victim", score: 0.2 }, { id: "ACC-M2", role: "mule", score: 0.6 }], edges: [], top_reasons: [] },
};
const ALERTS = [
  { alert_id: "AL-A-R", type: "ring", severity: "high", ring_id: "RNG-AAA111", account_id: null, message: "Ring A: five linked accounts", ts: T("23:59") },
  { alert_id: "AL-B-R", type: "ring", severity: "low", ring_id: "RNG-BBB222", account_id: null, message: "Ring B: slow payments", ts: T("20:00") },
  { alert_id: "AL-A-V0", type: "victim_warning", severity: "medium", ring_id: "RNG-AAA111", account_id: "ACC-P9", recipient_id: "ACC-C1", message: "Recent payment went to an account in a flagged ring.", ts: T("22:00") },
];

function fakeApi({ health = HEALTH, rings = RINGS, alerts = ALERTS, down = false, alertsFail = false } = {}) {
  const log = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      log.push(path);
      if (down) throw new TypeError("Failed to fetch");
      const ok = (b) => ({ ok: true, status: 200, json: async () => b });
      if (path === "/health") return ok(health);
      if (path === "/rings") return ok(rings);
      if (path.startsWith("/alerts")) return alertsFail ? { ok: false, status: 500, json: async () => ({ detail: "boom" }) } : ok(alerts);
      const acc = path.match(/^\/accounts\/(.+)$/);
      if (acc) return ok({ account_id: decodeURIComponent(acc[1]), risk: 0.71, role: "victim", ring_id: "RNG-AAA111", reasons: [{ feature: "f", label: "Paid by ACH", contribution: 1 }], neighborhood: { in_degree: 1, out_degree: 1, ring_size: 3 } });
      const r = path.match(/^\/rings\/(.+)$/);
      if (r) return DETAIL[decodeURIComponent(r[1])] ? ok(DETAIL[decodeURIComponent(r[1])]) : { ok: false, status: 404, json: async () => ({}) };
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
  return log;
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const open = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider pollMs={60000}>
        <Routes>
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/warning/:accountId" element={<WarningScreen />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
        <Where />
      </DataProvider>
    </MemoryRouter>
  );

afterEach(() => vi.unstubAllGlobals());

describe("application shell", () => {
  it("has one header with the product, the five areas and the current page marked", async () => {
    fakeApi();
    open("/alerts");
    await screen.findByRole("table");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Overview", "Investigations", "Alerts", "Accounts", "Assistant", "Platform"]);
    expect(within(nav).getByRole("link", { name: "Alerts" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(document.querySelectorAll("header.appbar")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "NEXUS Z home page" })).toHaveAttribute("href", "/");
  });

  it("opens and closes the navigation on small screens, and names the control", async () => {
    fakeApi();
    open("/alerts");
    await screen.findByRole("table");
    const btn = screen.getByRole("button", { name: "Open navigation" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("appnav").className).toMatch(/open/);
  });

  it("offers a skip link to the main content", async () => {
    fakeApi();
    open("/alerts");
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(document.getElementById("main")).not.toBeNull();
  });
});

describe("system status control", () => {
  it("shows the backend and the source-data time, and opens a panel with four separate facts", async () => {
    fakeApi();
    open("/alerts");
    const btn = await screen.findByRole("button", { name: /Model backend/ });
    expect(btn).toHaveTextContent("Data through 2022-09-09 23:59");
    fireEvent.click(btn);
    const panel = screen.getByRole("dialog", { name: /System status/ });
    for (const k of ["api", "backend", "source", "refresh"]) expect(panel.querySelector(`[data-row="${k}"]`)).not.toBeNull();
    expect(within(panel).getByText("API health")).toBeInTheDocument();
    expect(within(panel).getByText("Responding")).toBeInTheDocument();
    expect(within(panel).getByText("Source data through 2022-09-09 23:59 UTC")).toBeInTheDocument();
    expect(within(panel).getByText(/No refresh since the first build/)).toBeInTheDocument();
    expect(within(panel).getByText(/A responding API does not mean the data is current/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not show a green model indicator for a bare HTTP 200", async () => {
    fakeApi({ health: { status: "ok", backend: "model" } });
    open("/alerts");
    const btn = await screen.findByRole("button", { name: /Model backend, no state yet/ });
    expect(btn.querySelector(".dot").className).toMatch(/warn/);
    expect(btn.querySelector(".dot").className).not.toMatch(/ok/);
  });

  it("says stub when the API runs its stub backend, in the header and in a banner", async () => {
    fakeApi({ health: { status: "ok", backend: "stub" } });
    open("/alerts");
    expect(await screen.findByRole("button", { name: /Stub backend/ })).toBeInTheDocument();
    expect(screen.getByText(/The API is running its stub backend\./)).toBeInTheDocument();
    expect(screen.queryByText(/Data through/)).toBeNull();
  });

  it("shows an unreachable API as an error with a retry, never as data", async () => {
    const log = fakeApi({ down: true });
    open("/alerts");
    expect(await screen.findByText(/The NEXUS Z API is not reachable\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unreachable/ })).toBeInTheDocument();
    expect(screen.getByText(/No alerts: the API is not reachable/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    const before = log.length;
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(log.length).toBeGreaterThan(before));
  });
});

describe("alerts page", () => {
  it("lists the returned alerts with one set of columns, merging account columns by alert type", async () => {
    fakeApi();
    open("/alerts");
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Time (UTC)", "Alert", "Severity", "Ring", "Accounts", "Detail"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Whole ring")).toBeInTheDocument(); // a ring alert has no account columns
    const victim = rows.find((r) => within(r).queryByText("ACC-P9"));
    expect(within(victim).getByRole("link", { name: "ACC-C1" })).toHaveAttribute("href", "/account/ACC-C1");
    expect(within(victim).getByRole("link", { name: "pre-check" })).toHaveAttribute("href", "/warning/ACC-C1");
    expect(screen.getByText(/Showing/).textContent).toMatch(/Showing 3 of 3/);
  });

  it("filters by type, severity and search across ring id, account id and message, and counts the result", async () => {
    fakeApi();
    open("/alerts");
    await screen.findByRole("table");
    const count = () => screen.getByText(/Showing/).textContent.replace(/\s+/g, " ");
    fireEvent.change(screen.getByLabelText("Alert type"), { target: { value: "victim_warning" } });
    expect(count()).toMatch(/Showing 1 of 3/);
    fireEvent.change(screen.getByLabelText("Alert type"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "low" } });
    expect(count()).toMatch(/Showing 1 of 3/);
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Search alerts"), { target: { value: "acc-p9" } }); // an account id
    expect(count()).toMatch(/Showing 1 of 3/);
    fireEvent.change(screen.getByLabelText("Search alerts"), { target: { value: "slow payments" } }); // message text
    expect(screen.getByRole("link", { name: "RNG-BBB222" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search alerts"), { target: { value: "rng-aaa" } }); // a ring id
    expect(count()).toMatch(/Showing 2 of 3/);
    fireEvent.change(screen.getByLabelText("Search alerts"), { target: { value: "zzz" } });
    expect(screen.getByText("No alert matches these filters.")).toBeInTheDocument();
  });

  it("sorts by real values: newest first by time, or by severity rank rather than by the word", async () => {
    fakeApi();
    open("/alerts");
    const table = await screen.findByRole("table");
    const ringIds = () => within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("link")[0].textContent);
    expect(ringIds()).toEqual(["RNG-AAA111", "RNG-AAA111", "RNG-BBB222"]); // 23:59, 22:00, 20:00
    fireEvent.click(screen.getByRole("button", { name: "Severity first" }));
    const sev = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.cells[2].textContent);
    expect(sev()).toEqual(["High", "Medium", "Low"]); // alphabetical would give High, Low, Medium
  });

  it("makes filters reversible and puts them in the address", async () => {
    fakeApi();
    open("/alerts");
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "high" } });
    expect(screen.getByTestId("where")).toHaveTextContent("severity=high");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByTestId("where")).not.toHaveTextContent("severity=");
    expect(screen.getByText(/Showing/).textContent).toMatch(/Showing 3 of 3/);
  });

  it("opens the related ring when the row itself is clicked", async () => {
    fakeApi();
    open("/alerts");
    const table = await screen.findByRole("table");
    const victim = within(table).getAllByRole("row").find((r) => within(r).queryByText("ACC-P9"));
    fireEvent.click(victim.cells[0]);
    expect(screen.getByTestId("where")).toHaveTextContent("/ring/RNG-AAA111");
  });

  it("lets a link inside a row keep its own target instead of the row's", async () => {
    fakeApi();
    open("/alerts");
    const table = await screen.findByRole("table");
    const victim = within(table).getAllByRole("row").find((r) => within(r).queryByText("ACC-P9"));
    fireEvent.click(within(victim).getByRole("link", { name: "ACC-P9" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/account/ACC-P9");
    expect(screen.getByTestId("where")).not.toHaveTextContent("/ring/");
  });

  it("states what the alerts do and do not cover", async () => {
    fakeApi();
    open("/alerts");
    await screen.findByRole("table");
    expect(screen.getByText(/10 highest-scored rings, and lists at most 3 likely victims per ring/)).toBeInTheDocument();
    expect(screen.getByText(/has not been evaluated\s+for accuracy/)).toBeInTheDocument();
    expect(screen.getByText(/a signal for review, not a finding of fraud/)).toBeInTheDocument();
  });

  it("shows a message, not an empty table, when the API returns no alerts", async () => {
    fakeApi({ alerts: [] });
    open("/alerts");
    expect(await screen.findByText("The API returned no alerts.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("tells the analyst when only the alerts request failed, and offers a retry", async () => {
    const log = fakeApi({ alertsFail: true });
    open("/alerts");
    expect(await screen.findByText(/Some data could not be refreshed\./)).toBeInTheDocument();
    const before = log.length;
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(log.length).toBeGreaterThan(before));
  });
});

describe("accounts page", () => {
  it("looks an account up by the id that was typed, and lets the API decide whether it exists", async () => {
    fakeApi();
    open("/accounts");
    await screen.findByRole("table");
    const submit = screen.getByRole("button", { name: "Look up" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Account id"), { target: { value: "  ACC-ANY1  " } });
    fireEvent.click(submit);
    expect(screen.getByTestId("where")).toHaveTextContent("/account/ACC-ANY1"); // trimmed, and no format is enforced
  });

  it("builds the list from real ring detail, highest account score first, with each score on its own scale", async () => {
    const log = fakeApi();
    open("/accounts");
    const table = await screen.findByRole("table");
    expect(log).toContain("/rings/RNG-AAA111");
    expect(log).toContain("/rings/RNG-BBB222");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(["ACC-C1", "ACC-M2", "ACC-V1", "ACC-V2"]); // 0.95, 0.6, 0.3, 0.2
    expect(rows[0].cells[2].textContent).toBe("0.95");
    expect(within(table).getByRole("columnheader", { name: "Account score (0–1)" })).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "RNG-AAA111" })).toHaveAttribute("href", "/ring/RNG-AAA111?account=ACC-C1");
  });

  it("is honest that there is no list of all accounts", async () => {
    fakeApi();
    open("/accounts");
    await screen.findByRole("table");
    expect(screen.getByText(/has no list of all accounts/)).toBeInTheDocument();
    expect(screen.getByText(/not the same as a safe account/)).toBeInTheDocument();
  });

  it("shows an error and no invented accounts when the API is unreachable", async () => {
    fakeApi({ down: true });
    open("/accounts");
    expect(await screen.findByText("The API is not reachable.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("skips a ring that fails to load and says so, instead of replacing it", async () => {
    fakeApi({ rings: [...RINGS, ringSummary("RNG-GONE00", 30)] });
    open("/accounts");
    await screen.findByRole("table");
    expect(screen.getByText(/1 of the top rings could not be loaded and are not included/)).toBeInTheDocument();
  });
});

describe("overview", () => {
  it("names the ring score and uses the same four-fact status as the header", async () => {
    fakeApi();
    open("/overview");
    await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: "Ring score" })).toBeInTheDocument();
    const side = screen.getByRole("heading", { name: "System and data" }).closest("section");
    for (const k of ["api", "backend", "source", "refresh"]) expect(side.querySelector(`[data-row="${k}"]`)).not.toBeNull();
    expect(within(side).getByText("Source data through 2022-09-09 23:59 UTC")).toBeInTheDocument();
  });
});

describe("payment pre-check", () => {
  it("shows the account score on its own 0 to 1 scale and never as a percentage or a ring-style severity", async () => {
    fakeApi();
    open("/warning/ACC-C1");
    await screen.findByText("Check before you send");
    const card = document.querySelector(".ws-card");
    expect(within(card).getByText("Account score")).toBeInTheDocument();
    expect(card.textContent).toMatch(/0\.71/);
    expect(card.textContent).toMatch(/account score 0\.71 on a 0 to 1 scale/);
    expect(card.textContent).not.toMatch(/71\s*%/); // 0.71 printed as 71% would read as a probability
    expect(card.textContent).not.toMatch(/risk signal/i);
    expect(screen.getByText(/is not a probability of fraud/)).toBeInTheDocument();
  });
});
