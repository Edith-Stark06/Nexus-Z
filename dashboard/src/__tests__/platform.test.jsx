import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DataProvider } from "../state/DataContext";
import Platform, { validatePayment, toPayload } from "../pages/Platform";

const good = { tx_id: "UI-1", ts: "2022-09-09T23:59", src: "ACC-A", dst: "ACC-B", amount: "500", channel: "ACH" };

describe("validatePayment mirrors the API schema", () => {
  it("accepts a complete payment", () => {
    expect(validatePayment(good)).toEqual({});
  });

  it("requires every field", () => {
    const e = validatePayment({ tx_id: "", ts: "", src: " ", dst: "", amount: "", channel: "" });
    expect(Object.keys(e).sort()).toEqual(["amount", "channel", "dst", "src", "ts", "tx_id"]);
  });

  it("rejects an amount that is not greater than 0 or not a number", () => {
    for (const amount of ["0", "-5", "abc", "NaN", "Infinity", ""]) expect(validatePayment({ ...good, amount }).amount).toBeTruthy();
    expect(validatePayment({ ...good, amount: "0.01" }).amount).toBeUndefined();
  });

  it("rejects a sender equal to the receiver and a bad time", () => {
    expect(validatePayment({ ...good, dst: "ACC-A" }).dst).toMatch(/differ/);
    expect(validatePayment({ ...good, ts: "garbage" }).ts).toBeTruthy();
  });

  it("builds the JSON body the API expects", () => {
    expect(toPayload({ ...good, src: " ACC-A ", amount: "12.5" })).toEqual({ tx_id: "UI-1", ts: "2022-09-09T23:59:00", src: "ACC-A", dst: "ACC-B", amount: 12.5, channel: "ACH" });
  });
});

function fakeApi({ post } = {}) {
  const sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const ok = (b) => ({ ok: true, status: 200, json: async () => b });
      if (path === "/health") return ok({ status: "ok", backend: "model", refresh_interval_seconds: 5, data_as_of: "2022-09-09T23:59:00+00:00" });
      if (path === "/rings") return ok([]);
      if (path.startsWith("/alerts")) return ok([]);
      if (path === "/transactions" && init?.method === "POST") {
        sent.push(JSON.parse(init.body));
        return post ? post() : ok({ accepted: 1, backend: "model" });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
  return sent;
}

const open = () => render(<MemoryRouter><DataProvider pollMs={60000}><Platform /></DataProvider></MemoryRouter>);
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Platform page", () => {
  it("shows what /health reports, and does not claim LinuxONE", async () => {
    fakeApi();
    open();
    await screen.findByText("background micro-batch rebuild", {}, { timeout: 3000 }).catch(() => null);
    await waitFor(() => expect(screen.getByText("model")).toBeInTheDocument());
    expect(screen.getByText(/cannot tell where the API is running/i)).toBeInTheDocument();
    expect(screen.getByText(/connected \(the last health check answered\)/)).toBeInTheDocument();
  });

  it("starts the payment time at the newest time the model has seen", async () => {
    fakeApi();
    open();
    await waitFor(() => expect(screen.getByLabelText(/^Time \(UTC\)/).value).toBe("2022-09-09T23:59"));
  });

  it("sends nothing while the form is invalid, and shows each problem", async () => {
    const sent = fakeApi();
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit payment" })).toBeDisabled()); // needs the confirmation first
    fireEvent.click(screen.getByLabelText(/I understand this adds the payment/));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit payment" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit payment" }));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.getAllByText("Required.").length).toBeGreaterThanOrEqual(2);
    expect(sent).toEqual([]);
  });

  it("submits a valid payment once and reports what the API accepted", async () => {
    const sent = fakeApi();
    open();
    await waitFor(() => expect(screen.getByLabelText(/^Time \(UTC\)/).value).not.toBe(""));
    fill("From account", "ACC-A");
    fill("To account", "ACC-B");
    fill(/^Amount/, "500");
    fireEvent.click(screen.getByLabelText(/I understand this adds the payment/));
    fireEvent.click(screen.getByRole("button", { name: "Submit payment" }));
    await screen.findByText(/The API accepted/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ src: "ACC-A", dst: "ACC-B", amount: 500, channel: "ACH", ts: "2022-09-09T23:59:00" });
    expect(screen.getByText(/minimum interval 5 s/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I understand this adds the payment/)).not.toBeChecked(); // each submission needs a fresh confirmation
  });

  it("reports the API's validation error instead of pretending it worked", async () => {
    fakeApi({ post: () => ({ ok: false, status: 422, json: async () => ({ detail: [{ loc: ["body", "amount"], msg: "Input should be greater than 0" }] }) }) });
    open();
    await waitFor(() => expect(screen.getByLabelText(/^Time \(UTC\)/).value).not.toBe(""));
    fill("From account", "ACC-A");
    fill("To account", "ACC-B");
    fill(/^Amount/, "5");
    fireEvent.click(screen.getByLabelText(/I understand this adds the payment/));
    fireEvent.click(screen.getByRole("button", { name: "Submit payment" }));
    const err = await screen.findByText(/Not accepted/);
    expect(err.textContent).toMatch(/amount: Input should be greater than 0/);
    expect(screen.queryByText(/The API accepted/)).toBeNull();
  });
});
