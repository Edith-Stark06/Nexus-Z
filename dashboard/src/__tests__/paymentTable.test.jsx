import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PaymentTable from "../components/PaymentTable";

const edges = [
  { ts: "2026-10-14T10:00:00Z", src: "ACC-A", dst: "ACC-B", amount: 100 },
  { ts: "2026-10-14T09:00:00Z", src: "ACC-C", dst: "ACC-D", amount: 250.5 },
  { ts: "2026-10-15T11:00:00Z", src: "ACC-E", dst: "ACC-F", amount: 300 },
];

describe("PaymentTable", () => {
  it("renders rows in time order (earliest first), with the exact time kept for readers and tools", () => {
    const { container } = render(<PaymentTable edges={edges} />);
    const times = [...container.querySelectorAll("td.pay-time time")];
    expect(times.map((t) => t.getAttribute("datetime"))).toEqual(["2026-10-14T09:00:00Z", "2026-10-14T10:00:00Z", "2026-10-15T11:00:00Z"]);
    expect(times.map((t) => t.textContent)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("groups payments by day and says how many fall on each", () => {
    const { container } = render(<PaymentTable edges={edges} />);
    const days = [...container.querySelectorAll("tr.pay-day th")].map((t) => t.textContent);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatch(/14 Oct 2026/);
    expect(days[0]).toMatch(/2 payments/);
    expect(days[1]).toMatch(/15 Oct 2026/);
    expect(days[1]).toMatch(/1 payment(?!s)/);
  });

  it("renders the mixed-currencies header with no currency symbol", () => {
    const { container } = render(<PaymentTable edges={edges} />);
    const amountHeader = [...container.querySelectorAll("th")].map((h) => h.textContent).find((h) => /amount/i.test(h));
    expect(amountHeader).toBe("amount (mixed currencies)");
    expect(amountHeader).not.toMatch(/[$€£¥]/);
  });

  it("renders amounts with no currency symbol", () => {
    const { container } = render(<PaymentTable edges={edges} />);
    expect([...container.querySelectorAll("td.pay-amt")].map((t) => t.textContent)).toEqual(["250.50", "100", "300"]);
    expect(container.textContent).not.toMatch(/[$€£¥]/);
  });

  it("marks each account with its estimated role, and still renders an account with none", () => {
    const { container } = render(<PaymentTable edges={edges} roles={{ "ACC-C": "collector", "ACC-D": "cashout" }} />);
    const dots = [...container.querySelectorAll("tr.pay-row")][0].querySelectorAll(".chip-dot");
    expect([...dots].map((d) => d.className)).toEqual(["chip-dot collector", "chip-dot cashout"]);
    expect([...container.querySelectorAll("tr.pay-row")][2].querySelector(".chip-dot").className).toBe("chip-dot unknown");
  });

  it("shows ten payments at first and all of them on request", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ts: `2026-10-14T10:${String(i).padStart(2, "0")}:00Z`, src: `ACC-S${i}`, dst: "ACC-X", amount: i + 1 }));
    const { container } = render(<PaymentTable edges={many} />);
    expect(container.querySelectorAll("tr.pay-row")).toHaveLength(10);
    expect(screen.getByText("Showing 10 of 25 payments")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 25" }));
    expect(container.querySelectorAll("tr.pay-row")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(container.querySelectorAll("tr.pay-row")).toHaveLength(10);
  });

  it("has no button when everything already fits", () => {
    render(<PaymentTable edges={edges} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("copes with a payment whose time cannot be read", () => {
    const { container } = render(<PaymentTable edges={[{ ts: "not a time", src: "ACC-A", dst: "ACC-B", amount: 5 }]} />);
    expect(container.querySelectorAll("tr.pay-row")).toHaveLength(1);
    expect(container.textContent).toMatch(/Unknown date/);
  });

  it("shows a placeholder when there are no edges", () => {
    render(<PaymentTable edges={[]} />);
    expect(screen.getByText(/No payments recorded/)).toBeInTheDocument();
  });
});
