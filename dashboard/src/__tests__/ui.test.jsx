import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import InfoTip from "../components/InfoTip";
import FloatingAssistant from "../components/FloatingAssistant";
import { HELP } from "../lib/help";
import { TILE_H, makeTile, rng, visibleTiles } from "../lib/backdrop";
import { signIn } from "../auth/session";

vi.mock("../services/chat", () => ({
  getChatStatus: vi.fn(() => Promise.resolve({ mode: "rules", models: [], token_configured: false })),
  askAssistant: vi.fn(),
}));

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(() => cleanup());

describe("the i tips", () => {
  it("opens on hover and on focus, names what it explains, and closes on Escape", () => {
    render(<InfoTip k="flowGraph" />);
    const button = screen.getByRole("button", { name: "About: Flow graph" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(button.parentElement);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toMatch(/Roles are estimates/);
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("toggles on click for touch screens and closes when you tap elsewhere", () => {
    render(<div><InfoTip title="Thing" text="What it is." /><p>elsewhere</p></div>);
    const button = screen.getByRole("button", { name: "About: Thing" });
    fireEvent.click(button);
    expect(screen.getByRole("tooltip").textContent).toMatch(/What it is\./);
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders nothing for a key it does not know, instead of failing", () => {
    const { container } = render(<InfoTip k="no-such-key" />);
    expect(container.firstChild).toBeNull();
  });

  it("every explanation has a title and a plain sentence, and none claims what the system cannot do", () => {
    for (const [key, e] of Object.entries(HELP)) {
      expect(e.title, key).toBeTruthy();
      expect(e.text.length, key).toBeGreaterThan(40);
      expect(`${e.title} ${e.text}`, key).not.toMatch(/real-time|instant|guilty|warnings? (are |were )?sent to/i);
    }
    expect(HELP.kpiVictims.text).toMatch(/not evaluated|has not been evaluated/);
    expect(HELP.likelyVictims.text).toMatch(/no warning is sent/);
    expect(HELP.flowGraph.text).toMatch(/estimates/);
  });
});

describe("the floating assistant", () => {
  const show = (path = "/monitor") => render(<MemoryRouter initialEntries={[path]}><FloatingAssistant /></MemoryRouter>);

  it("is not shown to a visitor who has not signed in", () => {
    show();
    expect(screen.queryByRole("button", { name: /Ask NEXUS Z/ })).toBeNull();
  });

  it("is shown to analysts and administrators, and only to them", () => {
    for (const [role, shown] of [["bank", true], ["admin", true], ["customer", false], ["regulator", false]]) {
      window.sessionStorage.clear();
      signIn(role);
      const { unmount } = show();
      expect(!!screen.queryByRole("button", { name: /Ask NEXUS Z/ }), role).toBe(shown);
      unmount();
    }
  });

  it("is hidden on the full assistant page, where the chat already is", () => {
    signIn("bank");
    show("/assistant");
    expect(screen.queryByRole("button", { name: /Ask NEXUS Z/ })).toBeNull();
  });

  it("opens into a chat panel, and closes from the button and from Escape", async () => {
    signIn("bank");
    show();
    const orb = screen.getByRole("button", { name: "Ask NEXUS Z" });
    expect(orb.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(orb);
    const dialog = screen.getByRole("dialog", { name: "Ask NEXUS Z" });
    expect(within(dialog).getByLabelText("Your question")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open full page" }).getAttribute("href")).toBe("/assistant");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close the assistant" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask NEXUS Z" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the decorative network", () => {
  it("a tile is always the same picture for the same index and width", () => {
    expect(makeTile(3, 1200)).toEqual(makeTile(3, 1200));
    expect(makeTile(3, 1200).nodes.map((n) => n.y)).not.toEqual(makeTile(4, 1200).nodes.map((n) => n.y));
    const a = rng(7);
    const b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("keeps every account inside its tile and every link between two accounts of that tile", () => {
    for (const width of [390, 1200]) {
      const { nodes, links } = makeTile(0, width);
      for (const n of nodes) {
        expect(n.x).toBeGreaterThan(0);
        expect(n.x).toBeLessThan(width);
        expect(n.y).toBeGreaterThan(0);
        expect(n.y).toBeLessThan(TILE_H);
      }
      const ids = new Set(nodes.map((n) => n.id));
      for (const l of links) { expect(ids.has(l.a.id)).toBe(true); expect(ids.has(l.b.id)).toBe(true); expect(l.b.x).toBeGreaterThan(l.a.x); }
      expect(links.length).toBeGreaterThan(5);
    }
  });

  it("has the same roles as the ring graph, and drops the middle column on a phone", () => {
    expect(new Set(makeTile(0, 1200).nodes.map((n) => n.role))).toEqual(new Set(["victim", "collector", "mule", "cashout"]));
    expect(new Set(makeTile(0, 390).nodes.map((n) => n.role)).has("mule")).toBe(false);
  });

  it("works out which tiles cover a stretch of the page", () => {
    expect(visibleTiles(0, 100)).toEqual([0]);
    expect(visibleTiles(TILE_H - 10, TILE_H + 10)).toEqual([0, 1]);
    expect(visibleTiles(-40, 20)).toEqual([-1, 0]);
  });
});
