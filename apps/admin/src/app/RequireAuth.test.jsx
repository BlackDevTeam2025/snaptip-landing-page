import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RequireAuth } from "./RequireAuth";

import { useAuthMe } from "@/features/auth/hooks/useAuth";

vi.mock("@/features/auth/hooks/useAuth", () => ({
  useAuthMe: vi.fn(),
}));

describe("RequireAuth", () => {
  it("shows loading state", () => {
    useAuthMe.mockReturnValue({ data: null, isLoading: true });

    render(
      <MemoryRouter initialEntries={["/installations"]}>
        <RequireAuth>
          <div>Protected content</div>
        </RequireAuth>
      </MemoryRouter>
    );

    expect(screen.getByText("Loading session...")).toBeInTheDocument();
  });

  it("redirects to /login when not authenticated", () => {
    useAuthMe.mockReturnValue({ data: null, isLoading: false });

    render(
      <MemoryRouter initialEntries={["/installations"]}>
        <Routes>
          <Route
            element={
              <RequireAuth>
                <div>Protected content</div>
              </RequireAuth>
            }
            path="/installations"
          />
          <Route element={<div>Login page</div>} path="/login" />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Login page")).toBeInTheDocument();
  });
});
