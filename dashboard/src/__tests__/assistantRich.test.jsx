import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Assistant from "../pages/Assistant";
import { RichAnswer, modelLabel, providerName } from "../components/ChatPanel";
import { inline, parseRich, MAX_RICH_CHARS } from "../lib/richText";

const NV = "https://integrate.api.nvidia.com/v1";
const NEMO = "nvidia/nemotron-3-super-120b-a12b";
const nvStatus = { mode: "llm", models: [NEMO, "openai/gpt-oss-20b"], provider: NV, token_configured: true };

function fakeApi({ status = nvStatus, chat }) {
  const sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (path === "/chat/status") return { ok: true, status: 200, json: async () => status };
    if (path === "/chat") {
      sent.push(JSON.parse(init.body));
      const r = typeof chat === "function" ? await chat() : chat;
      if (typeof r === "number") return { ok: false, status: r, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => r };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  return sent;
}
const reply = (over = {}) => ({ answer: "RNG-0417 has risk 94.", mode: "llm", model: NEMO, provider: NV, tools_used: [], warnings: [], note: "", seconds: 14.2, ...over });
const open = () => render(<MemoryRouter><Assistant /></MemoryRouter>);
const type = (t) => fireEvent.change(screen.getByLabelText("Your question"), { target: { value: t } });
const ask = (t) => { type(t); fireEvent.click(screen.getByRole("button", { name: "Ask" })); };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the safe reader for a model's Markdown", () => {
  it("reads paragraphs, line breaks, bold, code, bullet lists, numbered lists and headings", () => {
    const blocks = parseRich("### Summary\nThe **top ring** is `RNG-0417`.\nSecond line.\n\n- one\n- two\n  continued\n\n1. first\n2) second");
    expect(blocks.map((b) => b.type)).toEqual(["h", "p", "ul", "ol"]);
    expect(blocks[1].lines).toHaveLength(2);
    expect(blocks[1].lines[0].map((p) => p.t)).toEqual(["text", "bold", "text", "code", "text"]);
    expect(blocks[2].items).toHaveLength(2);
    expect(blocks[2].items[1][0].v).toBe("two continued");
    expect(blocks[3].items).toHaveLength(2);
  });

  it("leaves an unmatched marker, a table and a link as plain text", () => {
    expect(inline("a ** b")).toEqual([{ t: "text", v: "a ** b" }]);
    expect(inline("**open")).toEqual([{ t: "text", v: "**open" }]);
    const t = parseRich("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(t).toHaveLength(1);
    expect(t[0].type).toBe("p");
    expect(parseRich("[click](javascript:alert(1))")[0].lines[0][0].v).toBe("[click](javascript:alert(1))");
  });

  it("copes with empty, missing and enormous input", () => {
    expect(parseRich("")).toEqual([]);
    expect(parseRich(null)).toEqual([]);
    expect(parseRich(undefined)).toEqual([]);
    const big = parseRich("word ".repeat(100000));
    expect(JSON.stringify(big).length).toBeLessThan(MAX_RICH_CHARS * 2);
    expect(parseRich("a\r\nb\r\n\r\nc")).toHaveLength(2);
  });

  it("renders bold, lists and paragraphs as elements, with every ring and account id still a link", () => {
    const { container } = render(<MemoryRouter><RichAnswer text={"**Riskiest:** RNG-0417 first.\n\n- Ring RNG-0392 paid ACC-7F3A\n- **ACC-00703A** is a collector"} /></MemoryRouter>);
    expect(container.querySelectorAll("strong")).toHaveLength(2);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "RNG-0417" }).getAttribute("href")).toBe("/ring/RNG-0417");
    expect(screen.getByRole("link", { name: "ACC-7F3A" }).getAttribute("href")).toBe("/account/ACC-7F3A");
    expect(container.querySelector("strong a")).not.toBeNull(); // an id inside bold is still a link
  });

  it("never turns text into HTML: tags, event handlers and script stay visible text", () => {
    const evil = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script> **<b>bold</b>** <a href="javascript:alert(1)">x</a>';
    const { container } = render(<MemoryRouter><RichAnswer text={evil} /></MemoryRouter>);
    expect(container.querySelector("img, script, b, a[href^='javascript']")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=");
    expect(container.textContent).toContain("<script>");
    expect(window.__pwned).toBeUndefined();
  });
});

describe("naming the provider and the model", () => {
  it("names NVIDIA NIM from the address the API calls, and keeps naming the others", () => {
    expect(providerName("https://integrate.api.nvidia.com/v1")).toBe("NVIDIA NIM");
    expect(providerName("https://router.huggingface.co/v1")).toBe("Hugging Face");
    expect(providerName("https://eu-de.ml.cloud.ibm.com")).toBe("IBM watsonx.ai");
    expect(providerName("http://127.0.0.1:9999/v1")).toBe("127.0.0.1");
    expect(providerName("not a url")).toBe("an external provider");
    expect(providerName("https://integrate.api.nvidia.com.evil.example/v1")).toBe("integrate.api.nvidia.com.evil.example");
  });

  it("calls a model Granite only when it is one", () => {
    expect(modelLabel("ibm-granite/granite-4.2-30b")).toBe("IBM Granite");
    expect(modelLabel("ibm/granite-4-h-small")).toBe("IBM Granite");
    expect(modelLabel(NEMO)).toBe(NEMO);
    expect(modelLabel(undefined)).toBe("Language model");
  });

  it("shows the NVIDIA model and provider in the badge, the disclaimer and under the answer, and not 'IBM Granite'", async () => {
    fakeApi({ chat: reply() });
    open();
    expect(await screen.findByText(`${NEMO} · NVIDIA NIM`)).toBeInTheDocument();
    expect(screen.queryByText(/IBM Granite/)).toBeNull();
    const note = screen.getByText(/runs at NVIDIA NIM, not on the LinuxONE VM/);
    expect(note.textContent).toMatch(/your question and compact synthetic ring facts are sent there/);
    ask("hello");
    expect(await screen.findByText(new RegExp(`Answered by ${NEMO} through NVIDIA NIM in 14.2 s`))).toBeInTheDocument();
  });
});

describe("waiting for a hosted model", () => {
  it("says it can take up to 30 seconds, counts, disables sending, and ignores Enter until the answer arrives", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let release;
    const sent = fakeApi({ chat: () => new Promise((r) => { release = () => r(reply({ answer: "Done." })); }) });
    open();
    await screen.findByText(`${NEMO} · NVIDIA NIM`);
    ask("slow question");
    const wait = await screen.findByRole("status");
    expect(wait.textContent).toMatch(/Asking the model, this can take up to 30 seconds \(0 s so far\)/);
    expect(screen.getByRole("button", { name: "Waiting…" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Assistant" })).toHaveAttribute("aria-busy", "true");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole("status").textContent).toMatch(/\(3 s so far\)/);
    type("another");
    fireEvent.keyDown(screen.getByLabelText("Your question"), { key: "Enter" });
    expect(sent).toHaveLength(1); // Enter did not send a second question
    await act(async () => { release(); });
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Ask" })).not.toBeDisabled();
  });

  it("local and rules modes do not promise a long wait", async () => {
    let release;
    fakeApi({ status: { mode: "rules", models: [], provider: "x", token_configured: false }, chat: () => new Promise((r) => { release = () => r(reply({ mode: "rules", model: null })); }) });
    open();
    await screen.findByText(/Built-in rules/);
    ask("q");
    expect((await screen.findByRole("status")).textContent).toMatch(/Looking at the data/);
    expect(screen.getByRole("status").textContent).not.toMatch(/30 seconds/);
    await act(async () => { release(); });
  });
});

describe("answers and errors", () => {
  it("renders a hosted model's Markdown, and shows checker warnings, the fallback note and the tools used", async () => {
    fakeApi({
      chat: reply({
        answer: "**Top rings**\n\n- RNG-0417 (risk 94)\n- RNG-0392 (risk 81)",
        warnings: ["These figures were not found in the data: 777."], note: "The first model was busy; openai/gpt-oss-20b answered.",
        tools_used: [{ tool: "list_rings", args: {} }, { tool: "get_ring", args: { ring_id: "RNG-0417" } }],
      }),
    });
    const { container } = open();
    await screen.findByText(`${NEMO} · NVIDIA NIM`);
    ask("riskiest?");
    await screen.findByText(/Answered by/);
    expect(container.querySelectorAll(".chat-rich ul li")).toHaveLength(2);
    expect(container.querySelector(".chat-rich strong").textContent).toBe("Top rings");
    expect(screen.getByRole("link", { name: "RNG-0392" })).toBeInTheDocument();
    expect(screen.getByRole("note").textContent).toMatch(/777.*Check them against the ring page/);
    expect(screen.getByText(/The first model was busy/)).toBeInTheDocument();
    expect(screen.getByText(/Where this came from \(2\)/)).toBeInTheDocument();
  });

  it("an answer from the rules or the local model is shown as written, not parsed as Markdown", async () => {
    fakeApi({ status: { mode: "rules", models: [], provider: "x", token_configured: false }, chat: reply({ mode: "rules", model: null, answer: "Rings: **not bold** RNG-0417" }) });
    const { container } = open();
    await screen.findByText(/Built-in rules/);
    ask("q");
    await screen.findByText(/Answered by the built-in rules/);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**not bold**");
    expect(screen.getByRole("link", { name: "RNG-0417" })).toBeInTheDocument();
  });

  it("an error is shown as an alert, the question goes back into the box, and the next question still works", async () => {
    let n = 0;
    const sent = fakeApi({ chat: () => (++n === 1 ? 429 : reply({ answer: "Back again." })) });
    open();
    await screen.findByText(`${NEMO} · NVIDIA NIM`);
    ask("my careful question");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Too many questions/);
    expect(screen.getByLabelText("Your question").value).toBe("my careful question");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Back again.")).toBeInTheDocument();
    expect(sent).toHaveLength(2);
    expect(sent[1].history.some((t) => /Too many/.test(t.content))).toBe(false);
  });

  it("does not overwrite what the person typed while the failed question was in flight", async () => {
    let fail;
    fakeApi({ chat: () => new Promise((_, rej) => { fail = () => rej(new Error("down")); }) });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/chat/status")) return { ok: true, json: async () => nvStatus };
      await new Promise((r) => setTimeout(r, 30));
      throw new Error("down");
    }));
    open();
    await screen.findByText(`${NEMO} · NVIDIA NIM`);
    ask("first try");
    type("a newer thought");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not reach the NEXUS Z API/);
    expect(screen.getByLabelText("Your question").value).toBe("a newer thought");
    void fail;
  });

  it("never shows sample data for a chat: a failure is an error and nothing else", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/chat/status")) return { ok: true, json: async () => nvStatus };
      return { ok: false, status: 500, json: async () => ({}) };
    }));
    open();
    await screen.findByText(`${NEMO} · NVIDIA NIM`);
    ask("anything");
    expect((await screen.findByRole("alert")).textContent).toMatch(/not available right now \(HTTP 500\)/);
    expect(document.body.textContent).not.toMatch(/sample data/i);
  });

  it("offers exactly the four suggested questions", async () => {
    fakeApi({ chat: reply() });
    open();
    await screen.findByText(`${NEMO} · NVIDIA NIM`);
    for (const q of ["Which rings are riskiest?", "Why was the top ring flagged?", "Who may pay in next?", "How current is the data?"]) {
      expect(screen.getByRole("button", { name: q })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getAllByRole("button").filter((b) => /\?$/.test(b.textContent))).toHaveLength(4));
  });
});
