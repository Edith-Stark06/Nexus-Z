import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Assistant from "../pages/Assistant";
import { askAssistant, getChatStatus } from "../services/chat";

const HF = "https://router.huggingface.co/v1";
const llmStatus = { mode: "llm", models: ["ibm-granite/granite-4.2-30b"], provider: HF, token_configured: true };
const rulesStatus = { mode: "rules", models: [], provider: "x", token_configured: false };

// A fake API: /chat/status and /chat answer from the given values; `chat` may be a function of the request body or a status code.
function fakeApi({ status = llmStatus, chat }) {
  const sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      if (path === "/chat/status") return status ? { ok: true, status: 200, json: async () => status } : { ok: false, status: 503, json: async () => ({}) };
      if (path === "/chat") {
        const body = JSON.parse(init.body);
        sent.push(body);
        const r = typeof chat === "function" ? chat(body) : chat;
        if (typeof r === "number") return { ok: false, status: r, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => r };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
  return sent;
}

const reply = (over = {}) => ({
  answer: "RNG-0417 has risk 94.", mode: "llm", model: "ibm-granite/granite-4.2-30b", provider: HF,
  tools_used: [{ tool: "get_ring", args: { ring_id: "RNG-0417" } }], warnings: [], note: "", seconds: 12.3, ...over,
});

const open = () => render(<MemoryRouter><Assistant /></MemoryRouter>);
const ask = (text) => {
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
};

afterEach(() => vi.unstubAllGlobals());

describe("the assistant page", () => {
  it("says which model answers and, when it is a hosted one, that it is not running on the VM", async () => {
    fakeApi({ chat: reply() });
    open();
    expect(await screen.findByText(/IBM Granite · Hugging Face/)).toBeInTheDocument();
    expect(screen.getByText(/runs at Hugging Face, not on the LinuxONE VM/)).toBeInTheDocument();
    expect(screen.getByText(/does not mean guilty/)).toBeInTheDocument();
  });

  it("names the real host when the model is not served by Hugging Face", async () => {
    fakeApi({ status: { ...llmStatus, provider: "http://127.0.0.1:9999/v1" }, chat: reply({ provider: "http://127.0.0.1:9999/v1" }) });
    open();
    expect(await screen.findByText(/IBM Granite · 127.0.0.1/)).toBeInTheDocument();
    expect(screen.queryByText(/Hugging Face/)).toBeNull();
    ask("q");
    expect(await screen.findByText(/through 127.0.0.1 in/)).toBeInTheDocument();
  });

  it("says plainly when no language model is configured and shows no hosted-model notice", async () => {
    fakeApi({ status: rulesStatus, chat: reply() });
    open();
    expect(await screen.findByText(/Built-in rules, no language model/)).toBeInTheDocument();
    expect(screen.queryByText(/Hugging Face, not on/)).toBeNull();
  });

  it("says the API is unreachable instead of pretending", async () => {
    fakeApi({ status: null, chat: reply() });
    open();
    expect(await screen.findByText(/API unreachable/)).toBeInTheDocument();
  });

  it("sends the question, shows the answer with linked ids, who answered, how long, and where it came from", async () => {
    const sent = fakeApi({ chat: reply({ warnings: ["These figures were not found in the data: 777."] }) });
    open();
    await screen.findByText(/IBM Granite/);
    ask("Tell me about RNG-0417");
    const link = await screen.findByRole("link", { name: "RNG-0417" });
    expect(link.getAttribute("href")).toBe("/ring/RNG-0417");
    expect(sent[0]).toEqual({ message: "Tell me about RNG-0417", history: [] });
    expect(screen.getByText(/Answered by ibm-granite\/granite-4.2-30b through Hugging Face in 12.3 s/)).toBeInTheDocument();
    expect(screen.getByText(/777/)).toBeInTheDocument();
    expect(screen.getByText(/Where this came from \(1\)/)).toBeInTheDocument();
  });

  it("an answer by the rules says so and why", async () => {
    fakeApi({ status: rulesStatus, chat: reply({ mode: "rules", model: null, answer: "Highest-risk rings: ACC-7F3A.", note: "No Hugging Face token is configured; answered by rules." }) });
    open();
    await screen.findByText(/Built-in rules/);
    ask("Which rings are riskiest?");
    expect(await screen.findByText(/Answered by the built-in rules in 12.3 s/)).toBeInTheDocument();
    expect(screen.getByText(/No Hugging Face token is configured/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ACC-7F3A" }).getAttribute("href")).toBe("/account/ACC-7F3A");
  });

  it("sends the earlier turns as history, but never an error message", async () => {
    let n = 0;
    const sent = fakeApi({ chat: () => (++n === 2 ? 429 : reply({ answer: `Answer ${n}.` })) });
    open();
    await screen.findByText(/IBM Granite/);
    ask("first");
    await screen.findByText("Answer 1.");
    ask("second");
    expect(await screen.findByText(/Too many questions in the last minute/)).toBeInTheDocument();
    ask("third");
    await screen.findByText("Answer 3.");
    expect(sent[2].history).toEqual([{ role: "user", content: "first" }, { role: "assistant", content: "Answer 1." }, { role: "user", content: "second" }]);
    expect(JSON.stringify(sent[2].history)).not.toMatch(/Too many questions/);
  });

  it("a suggestion sends its question, Enter sends and Shift+Enter does not, and an empty box cannot be sent", async () => {
    const sent = fakeApi({ chat: reply() });
    open();
    await screen.findByText(/IBM Granite/);
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Which rings are riskiest?" }));
    await screen.findByText(/Answered by/);
    expect(sent[0].message).toBe("Which rings are riskiest?");
    const box = screen.getByLabelText("Your question");
    fireEvent.change(box, { target: { value: "typed" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(sent.length).toBe(1);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(sent.length).toBe(2));
    expect(box).toHaveAttribute("maxlength", "500");
  });

  it("a network failure is an honest error, never sample data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => { if (String(url).endsWith("/chat/status")) return { ok: true, json: async () => llmStatus }; throw new Error("down"); }));
    open();
    await screen.findByText(/IBM Granite/);
    ask("anything");
    expect(await screen.findByText(/Could not reach the NEXUS Z API/)).toBeInTheDocument();
  });
});

describe("the chat service", () => {
  it("maps statuses to messages that are safe to show", async () => {
    for (const [code, text] of [[429, /Too many questions/], [422, /too long/], [500, /not available right now \(HTTP 500\)/]]) {
      fakeApi({ chat: code });
      await expect(askAssistant("q")).rejects.toThrow(text);
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("x"); }));
    expect(await getChatStatus()).toBeNull();
  });

  it("sends at most the last six turns", async () => {
    const sent = fakeApi({ chat: reply() });
    const history = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }));
    await askAssistant("now", history);
    expect(sent[0].history.map((t) => t.content)).toEqual(["t3", "t4", "t5", "t6", "t7", "t8"]);
  });
});
