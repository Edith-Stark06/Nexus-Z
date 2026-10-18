import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Alerts from "../pages/Alerts";
import Dashboard from "../pages/Dashboard";
import RingDetail from "../pages/RingDetail";
import WarningScreen from "../pages/WarningScreen";
import { CaseSummary, RoleLegend } from "../components/CaseSummary";
import { ROLE_COLORS, formatUtc } from "../lib/constants";

// A fake API: each path answers with a status and a body; anything not listed is a 404.
function fakeApi(routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const hit = Object.entries(routes).find(([k]) => path === k);
      if (!hit) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => hit[1] };
    })
  );
}

const at = (route, path, element) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>
  );

afterEach(() => vi.unstubAllGlobals());

describe("alerts", () => {
  const alerts = [
    { alert_id: "AL-1-R", type: "ring", severity: "high", ring_id: "RNG-1", account_id: null, message: "ring", ts: "2022-09-10T12:55:00Z" },
    { alert_id: "AL-1-V0", type: "victim_warning", severity: "medium", ring_id: "RNG-1", account_id: "ACC-PAYER",
      recipient_id: "ACC-PAID", message: "Recent payment went to an account in a flagged ring.", ts: "2022-09-10T12:50:00Z" },
  ];

  it("previews the warning for the account that was paid, not for the payer", async () => {
    fakeApi({ "/health": { status: "ok" }, "/alerts?limit=50": alerts, "/rings": [] });
    at("/alerts", "/alerts", <Alerts />);
    const preview = await screen.findByRole("link", { name: "Preview" });
    expect(preview.getAttribute("href")).toBe("/warning/ACC-PAID");
  });

  it("never says warnings were sent, and shows the data's own time in UTC", async () => {
    fakeApi({ "/health": { status: "ok" }, "/alerts?limit=50": alerts, "/rings": [] });
    at("/alerts", "/alerts", <Alerts />);
    await screen.findByRole("link", { name: "Preview" });
    expect(document.body.textContent).not.toMatch(/\bsent\b/i);
    expect(document.body.textContent).toContain("12:55 UTC");
  });
});

describe("ring page", () => {
  it("says the ring changed instead of showing sample data when the API answers 404", async () => {
    fakeApi({ "/health": { status: "ok" } });
    at("/ring/RNG-GONE", "/ring/:ringId", <RingDetail />);
    expect(await screen.findByText(/This ring changed after the last refresh/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to the list of rings/i })).toBeInTheDocument();
    expect(screen.queryByText(/Using sample data/i)).toBeNull();
  });
});

describe("warning screen", () => {
  const account = (risk) => ({ account_id: "ACC-X", risk, role: "mule", ring_id: "RNG-1", reasons: [], neighborhood: { in_degree: 1, out_degree: 1, ring_size: 4 } });

  it("matches the risk word to the number", async () => {
    fakeApi({ "/health": { status: "ok" }, "/accounts/ACC-X": account(0.2) });
    at("/warning/ACC-X", "/warning/:accountId", <WarningScreen />);
    expect(await screen.findByText(/some risk \(20%\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/high risk/i)).toBeNull();
  });

  it("does not call an account a fraud ring and has no phone link", async () => {
    fakeApi({ "/health": { status: "ok" }, "/accounts/ACC-X": account(0.95) });
    at("/warning/ACC-X", "/warning/:accountId", <WarningScreen />);
    expect(await screen.findByText(/high risk \(95%\)/i)).toBeInTheDocument();
    expect(document.querySelector(".warning").textContent).not.toMatch(/fraud ring/i);   // the card, not the app tagline
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Talk to my bank/i }));
    expect(screen.getByText(/number on the back of your card/i)).toBeInTheDocument();
  });
});

describe("case summary and legend", () => {
  it("shows the summary when the API sends one and hides the block when it does not", () => {
    const { container, rerender } = render(<CaseSummary summary="Ring RNG-1 links 4 accounts." />);
    expect(screen.getByText("Ring RNG-1 links 4 accounts.")).toBeInTheDocument();
    rerender(<CaseSummary summary={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("explains the role colours and says roles are estimated", () => {
    render(<RoleLegend colors={ROLE_COLORS} />);
    ["Likely victim", "Collector", "Mule", "Cash-out"].forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
    expect(screen.getByText(/estimated roles/i)).toBeInTheDocument();
  });
});

describe("dates", () => {
  it("formats the data's own timestamp in UTC, not relative to today", () => {
    expect(formatUtc("2022-09-10T12:55:00Z")).toBe("10 Sept 2022, 12:55 UTC");
    expect(formatUtc(null)).toBe("—");
  });
});


describe("home page", () => {
  const summary = { ring_id: "RNG-1", risk: 91, accounts: 3, victims: 1, headline: "3 linked accounts.", first_seen: "2022-09-09T01:00:00Z", flagged_at: "2022-09-10T12:00:00Z" };
  const full = {
    ...summary, total_amount: 10, summary: "Ring RNG-1 links 3 accounts.",
    members: [{ id: "A", role: "victim", score: 0.2 }, { id: "B", role: "collector", score: 0.9 }, { id: "C", role: "cashout", score: 0.8 }],
    edges: [{ src: "A", dst: "B", amount: 5, ts: "2022-09-09T02:00:00Z" }, { src: "B", dst: "C", amount: 5, ts: "2022-09-09T02:05:00Z" }],
    top_reasons: [{ feature: "s_pt_median", label: "Sender: money leaves within minutes", contribution: 0.9 }],
  };

  it("loads the graph and the reasons of a ring when it is selected, and says likely-victim flags, not warnings", async () => {
    fakeApi({ "/health": { status: "ok" }, "/rings": [summary], "/alerts?limit=50": [], "/rings/RNG-1": full });
    at("/", "/", <Dashboard />);
    fireEvent.click(await screen.findByText("RNG-1"));
    // the reasons panel is filled from the full ring, which the list does not carry
    await waitFor(() => expect(screen.getAllByText("Sender: money leaves within minutes").length).toBeGreaterThan(0));
    expect(document.querySelector("svg.d3-graph")).not.toBeNull();
    expect(screen.queryByText(/No explanation available/i)).toBeNull();
    expect(document.body.textContent).toMatch(/likely-victim flags/i);
    expect(document.body.textContent).not.toMatch(/warnings sent/i);
  });
});
