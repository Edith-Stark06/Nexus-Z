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
      if (path === "/health") return ok({ status: "ok", backend, data_as_of: T("23:59") });
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

describe("homepage: hero", () => {
  it("says what the product is, with working primary and secondary actions", async () => {
    fakeApi();
    open();
    expect(screen.getByRole("heading", { level: 1 }).textContent.replace(/\s+/g, " ")).toBe("Follow the money.Reveal the network.");
    expect(document.querySelector(".hm-label").textContent).toBe("NEXUS Z / FINANCIAL INTELLIGENCE");
    expect(screen.getByRole("link", { name: /Explore Fraud Networks/ })).toHaveAttribute("href", "/rings");
    expect(screen.getByRole("link", { name: "How NEXUS Z Works" })).toHaveAttribute("href", "#how");
    const strip = screen.getByRole("list", { name: "Built with" });
    expect(within(strip).getAllByRole("listitem").map((x) => x.textContent)).toEqual(["Graph analysis", "Risk scoring", "FastAPI", "IBM LinuxONE target"]);
  });

  it("draws the top flagged rings as clusters and starts on the best collector, labelled as live results", async () => {
    fakeApi();
    open();
    const hero = screen.getByRole("region", { name: "Transaction network" });
    await within(hero).findByTestId("canvas");
    expect(within(hero).getByText(/Live results/)).toBeInTheDocument();
    expect(within(hero).getByText("cluster RNG-AAA111")).toBeInTheDocument();
    expect(within(hero).getByText("cluster RNG-BBB222")).toBeInTheDocument();
    expect(within(hero).getByTestId("canvas")).toHaveAttribute("data-selected", "ACC-C1"); // highest-scored collector of the top ring
    await waitFor(() => expect(within(hero).getByText("Paid by ACH")).toBeInTheDocument()); // reasons from GET /accounts/{id}
    expect(within(hero).getByRole("link", { name: /Open account/ })).toHaveAttribute("href", "/account/ACC-C1");
  });

  it("selecting an account or a cluster updates the inspector and offers the right link", async () => {
    fakeApi();
    open();
    const hero = screen.getByRole("region", { name: "Transaction network" });
    await within(hero).findByTestId("canvas");
    fireEvent.click(within(hero).getByText("node ACC-V1"));
    expect(hero.querySelector("div.hi .hi-id").textContent).toBe("ACC-V1");
    fireEvent.click(within(hero).getByText("cluster RNG-BBB222"));
    expect(within(hero).getByText("Flagged ring")).toBeInTheDocument();
    expect(within(hero).getByRole("link", { name: /Inspect this ring/ })).toHaveAttribute("href", "/ring/RNG-BBB222");
    fireEvent.click(within(hero).getByRole("button", { name: "Clear" }));
    expect(within(hero).getByText(/Hover an account to see its connections/)).toBeInTheDocument();
  });

  it("finds an account by id and reports when there is no match", async () => {
    fakeApi();
    open();
    const hero = screen.getByRole("region", { name: "Transaction network" });
    await within(hero).findByTestId("canvas");
    const box = within(hero).getByLabelText("Find an account in the network");
    fireEvent.change(box, { target: { value: "v2" } });
    fireEvent.submit(box.closest("form"));
    await waitFor(() => expect(within(hero).getByTestId("canvas")).toHaveAttribute("data-selected", "ACC-V2"));
    fireEvent.change(box, { target: { value: "nothing" } });
    fireEvent.submit(box.closest("form"));
    expect(within(hero).getByText("No match")).toBeInTheDocument();
  });
});

describe("homepage: which data it may call real", () => {
  it("labels the bundled sample as an illustrative network when the API is unreachable, with no live links", async () => {
    fakeApi({ down: true });
    open();
    const hero = screen.getByRole("region", { name: "Transaction network" });
    await within(hero).findByTestId("canvas", {}, { timeout: 4000 });
    expect(within(hero).getByText("Illustrative transaction network")).toBeInTheDocument();
    expect(within(hero).getByText(/bundled, invented sample\. It is not data from the system/)).toBeInTheDocument();
    expect(within(hero).queryByText(/Live results/)).toBeNull();
    expect(within(hero).queryByRole("link", { name: /Open account/ })).toBeNull();
    expect(within(hero).getByText(/no live record behind it/)).toBeInTheDocument();
  });

  it("uses the illustrative network when the API answers but returns no rings, and says why", async () => {
    fakeApi({ rings: [] });
    open();
    const hero = screen.getByRole("region", { name: "Transaction network" });
    await within(hero).findByText("Illustrative transaction network", {}, { timeout: 4000 });
    expect(within(hero).getByText(/returned no rings/)).toBeInTheDocument();
  });

  it("calls a stub backend's data a stub sample, not results", async () => {
    fakeApi({ backend: "stub" });
    open();
    const hero = screen.getByRole("region", { name: "Transaction network" });
    await within(hero).findByText("Stub backend sample", {}, { timeout: 4000 });
    expect(within(hero).getByText(/invented sample data\. Nothing here is a model result/)).toBeInTheDocument();
    expect(within(hero).queryByText(/Live results/)).toBeNull();
  });
});

describe("homepage: the comparison", () => {
  it("starts with isolated transfers and connects them on request, labelled illustrative throughout", () => {
    fakeApi();
    open();
    const section = screen.getByRole("region", { name: /A transaction is a point/ });
    expect(within(section).getByText(/Illustrative: invented accounts and transfers/)).toBeInTheDocument();
    const a = within(section).getByRole("button", { name: "Individual transactions" });
    const b = within(section).getByRole("button", { name: "Connected network" });
    expect(a).toHaveAttribute("aria-pressed", "true");
    expect(within(section).getByText(/Each one is a plausible payment|every one is a plausible payment/)).toBeInTheDocument();
    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(a).toHaveAttribute("aria-pressed", "false");
    expect(within(section).getByText(/Eight of them now form one structure/)).toBeInTheDocument();
    fireEvent.keyDown(within(section).getByRole("group", { name: "View" }), { key: "ArrowLeft" });
    expect(a).toHaveAttribute("aria-pressed", "true");
  });

  it("never gives the invented transfers amounts, scores or currencies", () => {
    fakeApi();
    open();
    const svg = screen.getByRole("img", { name: /Illustrative comparison/ });
    expect(svg.textContent).not.toMatch(/\$|€|£|score|risk \d/i);
  });
});

describe("homepage: how it works", () => {
  it("lists five implemented stages and moves between them from the keyboard", () => {
    fakeApi();
    open();
    const tabs = screen.getByRole("tablist", { name: "Investigation workflow" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["01Ingest", "02Connect", "03Analyse", "04Score", "05Investigate"]);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Ingest");
    fireEvent.keyDown(within(tabs).getByRole("tab", { name: /01/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Connect");
    fireEvent.click(within(tabs).getByRole("tab", { name: /05/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/Prototype/i);
  });

  it("says what each stage does not do, and shows nothing planned as built", () => {
    for (const s of STAGES) {
      expect(s.limits.length).toBeGreaterThan(0);
      expect(["Implemented", "Prototype"]).toContain(s.status);
      expect(s.refs.length).toBeGreaterThan(0);
    }
    const text = JSON.stringify(STAGES).toLowerCase();
    expect(text).toContain("no accelerator speed-up");
    expect(text).toContain("nothing is sent to anyone");
    expect(text).not.toMatch(/planned|coming soon|real-time|instant/);
  });
});

describe("homepage: workspace preview", () => {
  it("lists rings, loads the selected one's evidence, and links to the full investigation", async () => {
    fakeApi();
    open();
    const preview = screen.getByRole("group", { name: "Workspace preview" });
    await within(preview).findByRole("button", { name: /RNG-AAA111/ });
    await within(preview).findByText("Headline of RNG-AAA111");
    expect(within(preview).getByText("Reason for RNG-AAA111")).toBeInTheDocument();
    expect(within(preview).getByRole("link", { name: /Open this in the full investigation/ })).toHaveAttribute("href", "/ring/RNG-AAA111");
    fireEvent.click(within(preview).getByRole("button", { name: /RNG-BBB222/ }));
    await within(preview).findByText("Headline of RNG-BBB222");
    expect(within(preview).getByRole("link", { name: /Open this in the full investigation/ })).toHaveAttribute("href", "/ring/RNG-BBB222");
  });

  it("explains a ring that changed during a refresh instead of showing invented detail", async () => {
    fakeApi({ gone: ["RNG-AAA111"] });
    open();
    const preview = screen.getByRole("group", { name: "Workspace preview" });
    const note = await within(preview).findByText(/changed during a data refresh/, {}, { timeout: 4000 });
    expect(note.textContent).toMatch(/RNG-AAA111/);
    expect(within(preview).queryByText("Headline of RNG-AAA111")).toBeNull();
  });

  it("uses the illustrative sample, labelled, and links to the explorer when there is no live data", async () => {
    fakeApi({ down: true });
    open();
    const preview = screen.getByRole("group", { name: "Workspace preview" });
    await within(preview).findByText(/Illustrative sample · invented/, {}, { timeout: 4000 });
    await waitFor(() => expect(within(preview).getByRole("link", { name: /Open the ring explorer/ })).toHaveAttribute("href", "/rings"));
  });
});

describe("homepage: architecture, call to action and footer", () => {
  it("only states documented facts, each with its source, and says what is not claimed", () => {
    fakeApi();
    open();
    const arch = screen.getByRole("region", { name: /Built for enterprise financial workloads/ });
    expect(within(arch).getAllByText(/docs\/PLATFORM_RESULTS\.md, section 3c/).length).toBe(2); // the container fact and the measurement
    expect(within(arch).getByText(/docs\/ML_RESULTS\.md, section 8/)).toBeInTheDocument();
    const notClaimed = within(arch).getByText("Not claimed").parentElement;
    expect(notClaimed.textContent).toMatch(/production banking deployment/);
    expect(notClaimed.textContent).toMatch(/Accelerator speed-up for the fraud model/);
    expect(notClaimed.textContent).toMatch(/cannot tell where the API runs/);
    expect(arch.textContent).not.toMatch(/certified|SOC 2|ISO 27001|customers? (trust|use)/i);
  });

  it("closes with the required message and real destinations", () => {
    fakeApi();
    open();
    expect(screen.getByRole("heading", { name: /The pattern was always there\. Now you can see it\./ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Investigation Workspace/ })).toHaveAttribute("href", "/rings");
    expect(screen.getByRole("link", { name: "Explore the Technical Architecture" })).toHaveAttribute("href", "#architecture");
    const routes = screen.getByRole("navigation", { name: "Where to go in the workspace" });
    expect(within(routes).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/rings", "/overview", "/alerts", "/assistant", "/platform"]);
    expect(screen.getByText(/Synthetic data\. A risk score is an automated signal for review, not a finding of fraud/)).toBeInTheDocument();
  });

  it("every in-page link points at a section that exists", () => {
    fakeApi();
    const { container } = open();
    const hashes = [...container.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")).filter((h) => h !== "#main");
    expect(hashes.length).toBeGreaterThan(5);
    for (const h of new Set(hashes)) expect(container.querySelector(h), h).not.toBeNull();
  });

  it("opens and closes the mobile menu", () => {
    fakeApi();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = document.getElementById("hm-drawer");
    expect(drawer).not.toBeNull();
    expect(within(drawer).getAllByRole("link").map((l) => l.textContent)).toEqual(["Why networks", "How it works", "Workspace", "Architecture", "Open the workspace"]);
    fireEvent.click(within(drawer).getByRole("link", { name: "How it works" }));
    expect(document.getElementById("hm-drawer")).toBeNull();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
  });
});
