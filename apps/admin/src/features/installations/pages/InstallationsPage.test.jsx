import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getInstallations,
  sendBulkInstallationEmail,
} from "../services/installationsService";

import { InstallationsPage } from "./InstallationsPage";

vi.mock("../services/installationsService", () => ({
  getInstallations: vi.fn(),
  sendBulkInstallationEmail: vi.fn(),
}));

function renderPage(initialPath = "/installations") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<InstallationsPage />} path="/installations" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("InstallationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendBulkInstallationEmail.mockResolvedValue({
      data: { sent: 1, failed: 0 },
    });
  });

  it("shows loading state", async () => {
    getInstallations.mockImplementation(
      () => new Promise(() => {})
    );
    renderPage();
    expect(screen.getByText("Loading installations...")).toBeInTheDocument();
  });

  it("shows error state", async () => {
    getInstallations.mockRejectedValue(new Error("Load failed"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Failed to load installations/)).toBeInTheDocument()
    );
  });

  it("keeps filter values and requests filtered data", async () => {
    getInstallations.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    });

    renderPage("/installations?q=demo");

    await waitFor(() => expect(getInstallations).toHaveBeenCalled());
    expect(getInstallations).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "demo",
      })
    );

    const input = screen.getByPlaceholderText("Search by shop/email");
    fireEvent.change(input, { target: { value: "new-shop" } });
    expect(input).toHaveValue("new-shop");
  });

  it("shows bulk email columns and selectable active rows only", async () => {
    getInstallations.mockResolvedValue({
      data: [
        {
          id: 1,
          platform: "shopify",
          shop_identifier: "demo.myshopify.com",
          email: "merchant@example.com",
          status: "installed",
          active_at: "2026-04-01T00:00:00.000Z",
          deactivated_at: null,
          current_month_tip_amount: 25,
          current_month_tip_currency: "USD",
          is_selectable_for_email: true,
        },
        {
          id: 2,
          platform: "woocommerce",
          shop_identifier: "store.example.com",
          email: "",
          status: "installed",
          active_at: "2026-04-02T00:00:00.000Z",
          deactivated_at: null,
          current_month_tip_amount: 10,
          current_month_tip_currency: "USD",
          is_selectable_for_email: false,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("demo.myshopify.com")).toBeInTheDocument()
    );
    expect(screen.getByText("Active Date")).toBeInTheDocument();
    expect(screen.getByText("Deactivate Date")).toBeInTheDocument();
    expect(screen.getByText("Tip Amount")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();

    const selectable = screen.getByLabelText("Select demo.myshopify.com");
    const disabled = screen.getByLabelText("Select store.example.com");
    expect(selectable).not.toBeDisabled();
    expect(disabled).toBeDisabled();
  });

  it("sends bulk email for selected rows", async () => {
    getInstallations.mockResolvedValue({
      data: [
        {
          id: 1,
          platform: "shopify",
          shop_identifier: "demo.myshopify.com",
          email: "merchant@example.com",
          status: "installed",
          current_month_tip_amount: 25,
          current_month_tip_currency: "USD",
          is_selectable_for_email: true,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("demo.myshopify.com")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByLabelText("Select demo.myshopify.com"));
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));

    await waitFor(() =>
      expect(sendBulkInstallationEmail).toHaveBeenCalledWith([1])
    );
    expect(await screen.findByText("Sent 1 email(s).")).toBeInTheDocument();
  });
});
