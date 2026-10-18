import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { DataProvider } from "../state/DataContext";
import Home from "../pages/Home";
import { STAGES } from "../components/home/Workflow";

// jsdom has no layout, so the d3 canvas is replaced by a stand-in with the same props; the real one runs in the browser tests.
vi.mock("../components/GraphCanvas", async () => {
  const React = await import("react");
  const Canvas = React.forwardRef(function Canvas({ ring, selectedNodeId, selectedClusterId, onSelectNode, onSelectCluster, clusters = [], onClear }, ref) {
    React.useImperativeHandle(ref, () => ({ fit() {}, zoomIn() {}, zoomOut() {}, locate: () => true, fitNodes() {} }));
    return (
      <div data-testid="canvas" data-ring={ring.ring_id} data-selected={selectedNodeId || ""} data-cluster={selectedClusterId || ""}>
        {clusters.map((c) => <button key={c.id} onClick={() => onSelectCluster?.(c.id)}>{`cluster ${c.id}`}</button>)}
        {ring.members.map((m) => <button key={m.id} onClick={() => onSelectNode?.(m.id)}>{`node ${m.id}`}</button>)}
        <button onClick={onClear}>clear</button>
      </div>
    );
  });
  return { default: Canvas };
});

const T = (m) => `2022-09-09T${m}:00Z`;
const mkRing = (id, risk, members) => ({
  ring_id: id, risk, accounts: members.length, victims: 1, headline: `Headline of ${id}`, first_seen: T("01:00"), flagged_at: T("23:59"),
  total_amount: 10, summary: null,
  members: members.map(([mid, role, score]) => ({ id: mid, role, score })),
  edges: [{ src: members[0][0], dst: members[1][0], amount: 5, ts: T("10:00") }],
  top_reasons: [{ feature: "f", label: `Reason for ${id}`, contribution: 0.9 }],
});
const RA = mkRing("RNG-AAA111", 90, [["ACC-V1", "victim", 0.3], ["ACC-C1", "collector", 0.95], ["ACC-O1", "cashout", 0.7]]);
const RB = mkRing("RNG-BBB222", 70, [["ACC-V2", "victim", 0.2], ["ACC-C2", "collector", 0.85]]);
const summary = (r) => ({ ring_id: r.ring_id, risk: r.risk, accounts: r.accounts, victims: 1, headline: r.headline, first_seen: r.first_seen, flagged_at: r.flagged_at });

function fakeApi({ backend = "model", rings = [RA, RB], down = false, gone = [] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (down) throw new TypeError("Failed to fetch");
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const ok = (b) => ({ ok: true, status: 200, json: async () => b });
      if (path === "/health") return ok({ status: "ok", backend, data_as_of: T("23:59"), history_transactions: 1000, state_age_seconds: 30, refreshes_completed: 0 });
      if (path === "/rings") return ok(rings.map(summary));
      if (path.startsWith("/alerts")) return ok([]);
      const r = path.match(/^\/rings\/(.+)$/);
      if (r) {
        const id = decodeURIComponent(r[1]);
        const found = rings.find((x) => x.ring_id === id);
        return found && !gone.includes(id) ? ok(found) : { ok: false, status: 404, json: async () => ({ detail: "Unknown ring" }) };
      }
      const a = path.match(/^\/accounts\/(.+)$/);
      if (a) return ok({ account_id: decodeURIComponent(a[1]), risk: 0.9, role: "collector", ring_id: "RNG-AAA111", reasons: [{ feature: "f", label: "Paid by ACH", contribution: 1 }, { feature: "g", label: "Often changes currency", contribution: 0.5 }], neighborhood: { in_degree: 1, out_degree: 1, ring_size: 3 } });
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
}

const open = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <DataProvider pollMs={60000}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </DataProvider>
    </MemoryRouter>
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

const heroRegion = () => screen.getByRole("region", { name: "Transaction network" });

describe("homepage: introduction", () => {
  it("states the purpose and offers the two actions the brief names", async () => {
    fakeApi();
    open();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Reveal the connections behind suspicious transactions.");
    expect(screen.getByText(/helps investigators explore financial transaction relationships/)).toBeInTheDocument();
    const hero = within(document.querySelector(".hm-hero-copy"));
    expect(hero.getByRole("link", { name: /Open investigation workspace/ })).toHaveAttribute("href", "/rings");
    expect(hero.getByRole("link", { name: "How NEXUS Z Works" })).toHaveAttribute("href", "#how");
  });

  it("keeps the architecture link out of the hero and in the closing section", async () => {
    fakeApi();
    open();
    const hero = within(document.querySelector(".hm-hero-copy"));
    expect(hero.queryByRole("link", { name: /architecture/i })).toBeNull();
    const closing = within(document.getElementById("start"));
    expect(closing.getByRole("link", { name: /technical architecture/i })).toHaveAttribute("href", "#architecture");
    expect(closing.getByRole("link", { name: /Open investigation workspace/ })).toHaveAttribute("href", "/rings");
  });

  it("uses the application shell, not a second marketing header", async () => {
    fakeApi();
    open();
    expect(document.querySelectorAll("header.appbar")).toHaveLength(1);
    expect(document.querySelector(".hm-nav")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("makes no unsupported claims and carries no invented numbers, testimonials or metrics", async () => {
    fakeApi();
    open();
    const text = document.body.textContent;
    expect(text).not.toMatch(/\b\d+(\.\d+)?\s?%\s+(faster|accuracy|prevention|reduction)/i);
    expect(text).not.toMatch(/testimonial|trusted by|production[- ]ready|IBM[- ]certified/i);
    expect(text).toMatch(/Not an IBM product, and not endorsed by IBM/);
  });
});

describe("homepage: the hero shows only what the API returned", () => {
  it("draws the top flagged rings as clusters, with the caption and the backend named", async () => {
    fakeApi();
    open();
    const hero = heroRegion();
    await within(hero).findByTestId("canvas");
    expect(within(hero).getByText(/Showing accounts within returned flagged rings\./)).toBeInTheDocument();
    expect(within(hero).getByText("Model backend")).toBeInTheDocument();
    expect(within(hero).getByText("cluster RNG-AAA111")).toBeInTheDocument();
    expect(within(hero).getByText("cluster RNG-BBB222")).toBeInTheDocument();
    // the hero starts on the highest-scored collector of the top ring (chosen in an effect, so wait for it)
    await waitFor(() => expect(within(hero).getByTestId("canvas")).toHaveAttribute("data-selected", "ACC-C1"));
    await waitFor(() => expect(within(hero).getByText("Paid by ACH")).toBeInTheDocument()); // reasons from GET /accounts/{id}
    expect(within(hero).getByRole("link", { name: /Open account/ })).toHaveAttribute("href", "/account/ACC-C1");
    expect(document.body.textContent).not.toMatch(/illustrative/i);
  });

  it("shows an account score on its own 0 to 1 scale and a ring score on 0 to 100", async () => {
    fakeApi();
    open();
    const hero = heroRegion();
    await within(hero).findByTestId("canvas");
    await waitFor(() => expect(hero.querySelector(".hi")).toHaveTextContent(/Account score\s*0\.95\s*\(0–1\)/));
    fireEvent.click(within(hero).getByText("cluster RNG-BBB222"));
    expect(within(hero).getByText("Flagged ring · ring score")).toBeInTheDocument();
    expect(hero.querySelector(".hi .riskmeter-n").textContent).toBe("70");
  });

  it("selecting an account or a cluster updates the inspector and offers the right link", async () => {
    fakeApi();
    open();
    const hero = heroRegion();
    await within(hero).findByTestId("canvas");
    await waitFor(() => expect(within(hero).getByTestId("canvas")).toHaveAttribute("data-selected", "ACC-C1"));
    fireEvent.click(within(hero).getByText("node ACC-V1"));
    expect(hero.querySelector("div.hi .hi-id").textContent).toBe("ACC-V1");
    fireEvent.click(within(hero).getByText("cluster RNG-BBB222"));
    expect(within(hero).getByRole("link", { name: /Inspect this ring/ })).toHaveAttribute("href", "/ring/RNG-BBB222");
    fireEvent.click(within(hero).getByRole("button", { name: "Clear" }));
    expect(within(hero).getByText(/Hover an account to see its connections/)).toBeInTheDocument();
  });

  it("finds an account by id and reports when there is no match", async () => {
    fakeApi();
    open();
    const hero = heroRegion();
    await within(hero).findByTestId("canvas");
    const box = within(hero).getByLabelText("Find an account in the network");
    fireEvent.change(box, { target: { value: "v2" } });
    fireEvent.submit(box.closest("form"));
    await waitFor(() => expect(within(hero).getByTestId("canvas")).toHaveAttribute("data-selected", "ACC-V2"));
    fireEvent.change(box, { target: { value: "nothing" } });
    fireEvent.submit(box.closest("form"));
    expect(within(hero).getByText("No match")).toBeInTheDocument();
  });

  it("filters roles from the legend, which counts only the accounts that are drawn", async () => {
    fakeApi();
    open();
    const hero = heroRegion();
    await within(hero).findByTestId("canvas");
    const legend = within(hero.querySelector(".hn-legend"));
    // RA has victim/collector/cashout, RB has victim/collector: 2 victims, 2 collectors, 1 cash-out, and no mule at all
    expect(legend.getByRole("button", { name: /Likely victim\s*2/ })).toBeInTheDocument();
    expect(legend.getByRole("button", { name: /Cash-out\s*1/ })).toBeInTheDocument();
    expect(legend.queryByRole("button", { name: /Mule/ })).toBeNull();
  });
});

describe("homepage: no silent fallback to invented data", () => {
  it("says the API is unreachable, draws nothing, and offers a retry that asks again", async () => {
    fakeApi({ down: true });
    open();
    const hero = heroRegion();
    await within(hero).findByText(/The NEXUS Z API is not reachable\./, {}, { timeout: 4000 });
    expect(within(hero).queryByTestId("canvas")).toBeNull();
    expect(document.body.textContent).not.toMatch(/illustrative|ACC-V1|ACC-C1|RNG-AAA111/i);
    expect(within(hero).getByText(/nothing is substituted/)).toBeInTheDocument();
    const calls = fetch.mock.calls.length;
    fireEvent.click(within(hero).getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(calls));
  });

  it("says the API returned no rings and links to the workspace, without drawing anything", async () => {
    fakeApi({ rings: [] });
    open();
    const hero = heroRegion();
    await within(hero).findByText("The API returned no flagged rings.");
    expect(within(hero).queryByTestId("canvas")).toBeNull();
    expect(within(hero).getByRole("link", { name: /Open the investigation workspace/ })).toHaveAttribute("href", "/rings");
  });

  it("calls a stub backend's data a stub sample, not model results", async () => {
    fakeApi({ backend: "stub" });
    open();
    const hero = heroRegion();
    await within(hero).findByTestId("canvas");
    expect(within(hero).getByText("Stub backend")).toBeInTheDocument();
    expect(within(hero).getByText(/serving invented sample data/)).toBeInTheDocument();
    expect(within(hero).queryByText("Model backend")).toBeNull();
  });

  it("explains a ring that changed during a refresh instead of showing invented detail", async () => {
    fakeApi({ gone: ["RNG-BBB222"] });
    open();
    const hero = heroRegion();
    await within(hero).findByTestId("canvas");
    expect(within(hero).getByRole("status")).toHaveTextContent(/A ring changed during a data refresh and was left out/);
    expect(within(hero).queryByText("cluster RNG-BBB222")).toBeNull();
  });
});

describe("homepage: how it works", () => {
  it("lists the six steps with an accurate status for each, and does not present planned work as built", () => {
    fakeApi();
    open();
    const list = screen.getByRole("list", { name: "How NEXUS Z works" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(STAGES.map((s) => s.name)).toEqual([
      "Receive or simulate transaction activity",
      "Build the transaction relationships",
      "Analyse potentially suspicious structures",
      "Apply the configured fraud-scoring model",
      "Expose ring, account and alert information",
      "Support investigation and future intervention",
    ]);
    const last = within(items[5]);
    expect(last.getByText("Payment pre-check: Prototype")).toBeInTheDocument();
    expect(last.getByText("Intervention before payment: Not built")).toBeInTheDocument();
    expect(last.getByText(/no endpoint sends a warning/)).toBeInTheDocument();
    for (const it of items.slice(0, 5)) expect(within(it).getByText("Implemented")).toBeInTheDocument();
  });

  it("names the files each step rests on and says what the step does not do", () => {
    fakeApi();
    open();
    for (const s of STAGES) {
      expect(s.refs.length).toBeGreaterThan(0);
      expect(s.limits.length).toBeGreaterThan(10);
    }
    expect(screen.getAllByText("api/main.py").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/no accelerator speed-up is claimed/);
  });
});

describe("homepage: architecture and closing section", () => {
  it("states only documented facts, each with its source, and says what is not claimed", () => {
    fakeApi();
    open();
    const sec = within(document.getElementById("architecture"));
    expect(sec.getByText(/designed to run on/)).toBeInTheDocument();
    const facts = within(sec.getByRole("list", { name: "Verified in the repository" })).getAllByRole("listitem");
    expect(facts.length).toBeGreaterThanOrEqual(4);
    for (const f of facts) expect(f.querySelector(".ar-src").textContent).toMatch(/docs\/[A-Z_]+\.md/);
    expect(sec.getByText("Not claimed")).toBeInTheDocument();
    expect(sec.getByText(/production banking deployment/)).toBeInTheDocument();
    expect(sec.getByText(/Accelerator speed-up for the fraud model/)).toBeInTheDocument();
  });

  it("every in-page link points at a section that exists", () => {
    fakeApi();
    open();
    const targets = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1));
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(document.getElementById(t), `#${t}`).not.toBeNull();
  });
});
