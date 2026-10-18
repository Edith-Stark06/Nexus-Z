import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PaymentTable from "../components/PaymentTable";

const edges = [
  { ts: "2026-10-14T10:00:00Z", src: "ACC-A", dst: "ACC-B", amount: 100 },
  { ts: "2026-10-14T09:00:00Z", src: "ACC-C", dst: "ACC-D", amount: 250.5 },
  { ts: "2026-10-14T11:00:00Z", src: "ACC-E", dst: "ACC-F", amount: 300 },
];

describe("PaymentTable", () => {
  it("renders rows in time order (earliest first)", () => {
    const { container } = render(<PaymentTable edges={edges} />);
    const times = [...container.querySelectorAll("td.pay-time")].map((t) =>
      t.textContent
    );
    expect(times).toEqual([
      "2026-10-14 09:00 UTC",
      "2026-10-14 10:00 UTC",
      "2026-10-14 11:00 UTC",
    ]);
  });

  it("labels the amount column as recorded (no currency reported) and draws no currency symbol", () => {
    const { container } = render(<PaymentTable edges={edges} />);
    const headers = [...container.querySelectorAll("th")].map((h) =>
      h.textContent
    );
    const amountHeader = headers.find((h) => /amount/i.test(h));
    expect(amountHeader).toBe("Amount*");
    expect(container.textContent).toMatch(/does not report a currency/);
    expect(amountHeader).not.toMatch(/[$€£¥]/);
  });

  it("renders amounts with no currency symbol", () => {
    const { container } = render(<PaymentTable edges={edges} />);
    const amounts = [...container.querySelectorAll("td.pay-amt")].map((t) =>
      t.textContent
    );
    expect(amounts).toEqual(["250.50", "100", "300"]);
    expect(container.textContent).not.toMatch(/[$€£¥]/);
  });

  it("shows a placeholder when there are no edges", () => {
    render(<PaymentTable edges={[]} />);
    expect(screen.getByText(/No payments recorded/)).toBeInTheDocument();
  });
});