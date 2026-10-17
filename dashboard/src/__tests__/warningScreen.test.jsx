import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import WarningScreen from "../pages/WarningScreen";

// useParams needs a <Routes>/<Route> context, so wrap the component in one
// that declares the /warning/:accountId route.
function renderWithRouter(route, ui = <WarningScreen />) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/warning/:accountId" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

describe("WarningScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the 'Check before you send' title for a known account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => { throw new Error("nope"); },
      }))
    );

    renderWithRouter("/warning/ACC-7F3A");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Check before you send/i })
      ).toBeInTheDocument();
    });
  });

  it("renders the three required buttons for a known account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => { throw new Error("nope"); },
      }))
    );

    renderWithRouter("/warning/ACC-7F3A");
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Cancel payment/i })
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("link", { name: /Talk to my bank/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /I understand the risk, continue/i })
    ).toBeInTheDocument();
  });

  it("shows a friendly message for an unknown account ID", async () => {
    const unknownId = "ACC-UNKNOWN-9999";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => { throw new Error("nope"); },
      }))
    );

    renderWithRouter(`/warning/${unknownId}`);
    await waitFor(() => {
      expect(screen.getByText(/Account not found/)).toBeInTheDocument();
    });

    // The unknown ID appears in the copy so the customer knows which account.
    expect(
      screen.getByText((text) => text.includes(unknownId))
    ).toBeInTheDocument();
    // Friendly, jargon-free copy.
    expect(
      screen.getByText(/could not find this account/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/double-check the recipient before proceeding/i)
    ).toBeInTheDocument();
    // No technical jargon.
    expect(screen.queryByText(/SHAP/i)).toBeNull();
    expect(screen.queryByText(/PageRank/i)).toBeNull();
    expect(screen.queryByText(/in_degree/i)).toBeNull();
  });
});