import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { DataProvider } from "../state/DataContext";
import Explorer from "../pages/Explorer";

// jsdom has no layout, so the d3 canvas is replaced by a stand-in with the same props. The real canvas is exercised in a browser.
vi.mock("../components/GraphCanvas", () => ({
  default: ({ ring, selectedNodeId, onSelectNode, onClear }) => (
    <div data-testid="canvas" data-ring={ring.ring_id}>
      {ring.members.map((m) => (
        <button key={m.id} aria-pressed={m.id === selectedNodeId} onClick={() => onSelectNode(m.id)}>{`node ${m.id}`}</button>
      ))}
      <button onClick={onClear}>clear</button>
    </div>
  ),
}));

const T = (m) => `2022-09-09T${m}:00Z`;
const RING_A = { ring_id: "RNG-AAA111", risk: 90, accounts: 3, victims: 1, headline: "Three accounts, money leaves fast", first_seen: T("01:00"), flagged_at: T("23:59") };
const RING_B = { ring_id: "RNG-BBB222", risk: 30, accounts: 2, victims: 0, headline: "Two accounts, slow", first_seen: T("02:00"), flagged_at: T("23:59") };
const DETAIL_A = {
  ...RING_A,
  total_amount: 1234.5,
  summary: "Ring RNG-AAA111 links 3 accounts. Verify the accounts before any action; roles are estimates.",
  members: [
    { id: "ACC-V1", role: "victim", score: 0.4 },
    { id: "ACC-C1", role: "collector", score: 0.95 },
    { id: "ACC-O1", role: "cashout", score: 0.8 },
  ],
  edges: [
    { src: "ACC-V1", dst: "ACC-C1", amount: 100, ts: T("10:00") },
    { src: "ACC-C1", dst: "ACC-O1", amount: 90, ts: T("10:10") },
  ],
  top_reasons: [{ feature: "pt", label: "Money leaves within minutes", contribution: 0.9 }, { feature: "x", label: "Receiver: many transfers to itself (absent)", contribution: 0.3 }],
};
const ALERTS = [
  { alert_id: "a1", type: "ring", severity: "high", ring_id: "RNG-AAA111", account_id: null, recipient_id: null, message: "Three accounts", ts: T("23:59") },
  { alert_id: "a2", type: "victim_warning", severity: "medium", ring_id: "RNG-AAA111", account_id: "ACC-P9", recipient_id: "ACC-C1", message: "Recent payment went to an account in a flagged ring.", ts: T("23:00") },
];

// accounts: ACC-C1 is in RNG-AAA111; ACC-OLD1 used to be in a ring that changed and is now in RNG-AAA111
const ACCOUNTS = {
  "ACC-C1": { account_id: "ACC-C1", risk: 0.95, role: "collector", ring_id: "RNG-AAA111", reasons: [{ feature: "f", label: "Paid by ACH", contribution: 1.2 }], neighborhood: { in_degree: 1, out_degree: 1, ring_size: 3 } },
  "ACC-OLD1": { account_id: "ACC-OLD1", risk: 0.5, role: "mule", ring_id: "RNG-AAA111", reasons: [], neighborhood: { in_degree: 1, out_degree: 1, ring_size: 3 } },
  "ACC-LONE": { account_id: "ACC-LONE", risk: 0.01, role: null, ring_id: null, reasons: [], neighborhood: { in_degree: 0, out_degree: 1, ring_size: null } },
};
const STALE_RING = { ...RING_A, ring_id: "RNG-GONE00", members: [{ id: "ACC-OLD1", role: "mule", score: 0.9 }], edges: [] };

function fakeApi({ goneRing = false } = {}) {
  const log = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      log.push(path);
      const ok = (b) => ({ ok: true, status: 200, json: async () => b });
      const no = (s = 404) => ({ ok: false, status: s, json: async () => ({ detail: "Unknown" }) });
      if (path === "/health") return ok({ status: "ok", backend: "model", data_as_of: T("23:59") });
      if (path === "/rings") return ok([RING_A, RING_B]);
      if (path.startsWith("/alerts")) return ok(ALERTS);
      if (path === "/rings/RNG-AAA111") return ok(DETAIL_A);
      if (path === "/rings/RNG-GONE00") return goneRing ? no() : ok(STALE_RING);
      const m = path.match(/^\/accounts\/(.+)$/);
      if (m) return ACCOUNTS[decodeURIComponent(m[1])] ? ok(ACCOUNTS[decodeURIComponent(m[1])]) : no();
      return no();
    })
  );
  return log;
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const open = (route = "/rings") =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <DataProvider pollMs={60000}>
        <Routes>
          <Route path="/rings" element={<><Explorer /><Where /></>} />
          <Route path="/ring/:ringId" element={<><Explorer /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </DataProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  window.innerWidth = 1400; // the three-column layout
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ring explorer", () => {
  it("lists the API's rings, highest risk first, with the likely-victim count (not 'warnings sent')", async () => {
    fakeApi();
    open();
    const list = await screen.findByRole("complementary", { name: "Rings" });
    await waitFor(() => expect(within(list).getAllByRole("button", { name: /RNG-/ })).toHaveLength(2));
    const rows = within(list).getAllByRole("button", { name: /RNG-/ });
    expect(rows[0]).toHaveTextContent("RNG-AAA111");
    expect(rows[0]).toHaveTextContent(/1 likely victim flagged/);
    expect(document.body.textContent).not.toMatch(/warnings? sent/i);
  });

  it("selecting a ring navigates to it and fills the inspector with real fields", async () => {
    fakeApi();
    open();
    const list = await screen.findByRole("complementary", { name: "Rings" });
    fireEvent.click(await within(list).findByRole("button", { name: /RNG-AAA111/ })); // the list row (the empty-state shortcut has the same id)
    await screen.findByTestId("canvas");
    expect(screen.getByTestId("where")).toHaveTextContent("/ring/RNG-AAA111");
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    await within(inspector).findByText(/Three accounts, money leaves fast/);
    expect(within(inspector).getByText("Case summary")).toBeInTheDocument();
    expect(within(inspector).getByText(/Verify the accounts before any action/)).toBeInTheDocument();
    expect(within(inspector).getByText("Money leaves within minutes")).toBeInTheDocument();
    expect(within(inspector).getByText("Receiver: many transfers to itself (absent)")).toBeInTheDocument(); // shown as the API sent it
    expect(within(inspector).getByText("Not a finding of fraud.")).toBeInTheDocument();
    expect(within(inspector).getByText(/mixed currencies/i)).toBeInTheDocument();
    expect(within(inspector).getByText(/Likely victim flagged: ACC-P9 paid ACC-C1/)).toBeInTheDocument(); // related alert, from /alerts
  });

  it("selecting an account shows its own record and sets ?account=; the back link returns to the ring", async () => {
    const log = fakeApi();
    open("/ring/RNG-AAA111");
    fireEvent.click(await screen.findByRole("button", { name: "node ACC-C1" }));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    await within(inspector).findByText("Paid by ACH");
    expect(screen.getByTestId("where")).toHaveTextContent("account=ACC-C1");
    expect(log).toContain("/accounts/ACC-C1");
    expect(within(inspector).getByRole("link", { name: /Preview payment warning/ })).toHaveAttribute("href", "/warning/ACC-C1");
    fireEvent.click(within(inspector).getByRole("button", { name: /Back to ring/ }));
    await within(inspector).findByText(/Three accounts, money leaves fast/);
    expect(screen.getByTestId("where")).not.toHaveTextContent("account=");
  });

  it("filters the list by risk and by search text", async () => {
    fakeApi();
    open();
    const list = await screen.findByRole("complementary", { name: "Rings" });
    await waitFor(() => expect(within(list).getAllByRole("button", { name: /RNG-/ })).toHaveLength(2));
    fireEvent.change(within(list).getByLabelText("Minimum ring risk"), { target: { value: "50" } });
    expect(within(list).getAllByRole("button", { name: /RNG-/ })).toHaveLength(1);
    fireEvent.change(within(list).getByLabelText("Minimum ring risk"), { target: { value: "0" } });
    fireEvent.change(within(list).getByLabelText(/Search rings/), { target: { value: "slow" } });
    expect(within(list).getAllByRole("button", { name: /RNG-/ })[0]).toHaveTextContent("RNG-BBB222");
    fireEvent.change(within(list).getByLabelText(/Search rings/), { target: { value: "zzz" } });
    expect(within(list).getByText(/No ring matches these filters/)).toBeInTheDocument();
  });

  it("looks an account id up through the API and opens the ring it is in", async () => {
    const log = fakeApi();
    open();
    const list = await screen.findByRole("complementary", { name: "Rings" });
    fireEvent.change(within(list).getByLabelText(/Search rings/), { target: { value: "acc-c1" } });
    await within(list).findByText(/is in ring/, {}, { timeout: 3000 });
    expect(log).toContain("/accounts/ACC-C1");
    fireEvent.click(within(list).getByRole("button", { name: "Show in graph" }));
    await screen.findByTestId("canvas");
    expect(screen.getByTestId("where")).toHaveTextContent("/ring/RNG-AAA111?account=ACC-C1");
  });

  it("says 'no record' (not 'safe') for an account the API does not know", async () => {
    fakeApi();
    open();
    const list = await screen.findByRole("complementary", { name: "Rings" });
    fireEvent.change(within(list).getByLabelText(/Search rings/), { target: { value: "ACC-NOBODY" } });
    const note = await within(list).findByText(/No record of/, {}, { timeout: 3000 });
    expect(note.textContent).toMatch(/not the same as safe/);
  });
});

describe("a ring id that no longer exists", () => {
  it("explains it, refreshes the list, and finds where the ring's accounts went", async () => {
    const log = fakeApi({ goneRing: true });
    open("/ring/RNG-GONE00");
    const notice = await screen.findByText(/is not in the current results/, {}, { timeout: 3000 });
    expect(notice.closest(".notice").textContent).toMatch(/derived from the ring's members/);
    // no stale copy exists for a first visit, so the list stays usable and the analyst can pick another ring
    expect(await screen.findByRole("button", { name: /RNG-AAA111/ })).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).toBeNull();
    expect(log).toContain("/rings");
  });
});

describe("narrow screens", () => {
  it("shows one panel at a time behind tabs", async () => {
    window.innerWidth = 700;
    fakeApi();
    open("/ring/RNG-AAA111");
    const tabs = await screen.findByRole("tablist", { name: "Panels" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(3);
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole("tab", { name: /Rings/ }));
    expect(screen.queryByTestId("canvas")).toBeNull();
    expect(await screen.findByRole("button", { name: /RNG-BBB222/ })).toBeInTheDocument();
  });
});
