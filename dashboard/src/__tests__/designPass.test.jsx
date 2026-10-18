import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ReplaySlider from "../components/ReplaySlider";
import RingDetail from "../pages/RingDetail";
import Admin from "../pages/Admin";
import { signIn } from "../auth/session";

const edges = [
  { src: "ACC-A", dst: "ACC-B", amount: 1, ts: "2022-09-09T10:00:00Z" },
  { src: "ACC-B", dst: "ACC-C", amount: 1, ts: "2022-09-09T11:00:00Z" },
  { src: "ACC-C", dst: "ACC-D", amount: 1, ts: "2022-09-09T12:00:00Z" },
];

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the replay slider", () => {
  it("at the end, Play starts over from the first payment instead of doing nothing", () => {
    const onT = vi.fn();
    const onPlay = vi.fn();
    render(<ReplaySlider edges={edges} t={null} onT={onT} playing={false} onPlay={onPlay} />);
    expect(screen.getByText("3 of 3 moments")).toBeInTheDocument(); // no cutoff means the whole ring is shown
    fireEvent.click(screen.getByRole("button", { name: "Play replay" }));
    expect(onT).toHaveBeenCalledWith("2022-09-09T10:00:00.000Z");
    expect(onPlay).toHaveBeenCalledWith(true);
  });

  it("in the middle, Play carries on from where it is", () => {
    const onT = vi.fn();
    const onPlay = vi.fn();
    render(<ReplaySlider edges={edges} t="2022-09-09T11:00:00.000Z" onT={onT} playing={false} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole("button", { name: "Play replay" }));
    expect(onT).not.toHaveBeenCalled();
    expect(onPlay).toHaveBeenCalledWith(true);
  });
});

function fakeRingApi({ ringStatus = 200, ring }) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/rings/")) return ringStatus === 200 ? { ok: true, status: 200, json: async () => ring } : { ok: false, status: ringStatus, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}
const ring = {
  ring_id: "RNG-TEST01", risk: 90, accounts: 4, victims: 1, headline: "4 linked accounts.", first_seen: "2022-09-09T10:00:00Z", flagged_at: "2022-09-09T13:00:00Z",
  total_amount: 3, summary: "Ring RNG-TEST01 links 4 accounts. Verify the accounts before any action; roles are estimates.",
  members: ["A", "B", "C", "D"].map((x, i) => ({ id: `ACC-${x}`, role: ["victim", "collector", "mule", "cashout"][i], score: 0.8 })), edges, top_reasons: [],
};
const renderRing = () => render(
  <MemoryRouter initialEntries={["/ring/RNG-TEST01"]}>
    <Routes>
      <Route path="/ring/:ringId" element={<RingDetail />} />
      <Route path="/monitor" element={<div>the rings list</div>} />
    </Routes>
  </MemoryRouter>
);

describe("the ring page", () => {
  it("opens on the whole ring, not on its first payment alone", async () => {
    signIn("bank");
    fakeRingApi({ ring });
    const { container } = renderRing();
    await waitFor(() => expect(container.querySelectorAll(".graph-wrap g.node").length).toBe(4));
    expect(screen.getByText("3 of 3 moments")).toBeInTheDocument();
    expect(screen.getByText(/Case summary/i)).toBeInTheDocument();
  });

  it("when the ring was rebuilt under a new id, says so and sends the person back to their own list", async () => {
    signIn("bank");
    fakeRingApi({ ringStatus: 404 });
    renderRing();
    expect(await screen.findByText(/This ring changed after the last refresh/)).toBeInTheDocument();
    expect(screen.queryByText(/sample/i)).toBeNull(); // a 404 never shows sample data
    expect(screen.getByRole("link", { name: "Back to the list of rings" }).getAttribute("href")).toBe("/monitor");
  });
});

describe("times on the status screens", () => {
  it("show the data's own time in UTC, never the browser's zone", async () => {
    signIn("admin");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "ok", backend: "model", data_as_of: "2022-09-10T23:59:00+00:00", history_transactions: 5 }) })));
    render(<MemoryRouter><Admin /></MemoryRouter>);
    expect(await screen.findByText("10 Sept 2022, 23:59 UTC")).toBeInTheDocument();
  });
});
