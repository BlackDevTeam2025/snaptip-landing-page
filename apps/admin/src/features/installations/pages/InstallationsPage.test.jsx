import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getInstallations } from "../services/installationsService";

import { InstallationsPage } from "./InstallationsPage";

vi.mock("../services/installationsService", () => ({
  getInstallations: vi.fn(),
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
});
