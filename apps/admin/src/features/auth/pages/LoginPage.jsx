import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { useAuthActions, useAuthMe } from "../hooks/useAuth";

export function LoginPage() {
  const navigate = useNavigate();
  const { data: me } = useAuthMe();
  const { login, isLoggingIn, loginError } = useAuthActions();
  const [form, setForm] = useState({ email: "", password: "" });

  if (me?.must_change_password) {
    return <Navigate replace to="/change-password" />;
  }

  if (me && !me.must_change_password) {
    return <Navigate replace to="/installations" />;
  }

  async function onSubmit(event) {
    event.preventDefault();
    const response = await login(form);
    if (response?.data?.must_change_password) {
      navigate("/change-password", { replace: true });
      return;
    }
    navigate("/installations", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8] p-4">
      <form
        className="w-full max-w-md rounded-xl border border-black/10 bg-white p-6 shadow-sm"
        onSubmit={onSubmit}
      >
        <h1 className="mb-1 text-2xl font-semibold text-[#1f140a]">SnapTip Admin</h1>
        <p className="mb-6 text-sm text-black/60">
          Login with your internal admin account.
        </p>

        <label className="mb-2 block text-sm font-medium text-black/70" htmlFor="email">
          Email
        </label>
        <input
          className="mb-4 w-full rounded-lg border border-black/15 px-3 py-2 outline-none ring-brand-500 focus:ring-2"
          id="email"
          onChange={(event) =>
            setForm((prev) => ({ ...prev, email: event.target.value }))
          }
          required
          type="email"
          value={form.email}
        />

        <label
          className="mb-2 block text-sm font-medium text-black/70"
          htmlFor="password"
        >
          Password
        </label>
        <input
          className="mb-4 w-full rounded-lg border border-black/15 px-3 py-2 outline-none ring-brand-500 focus:ring-2"
          id="password"
          onChange={(event) =>
            setForm((prev) => ({ ...prev, password: event.target.value }))
          }
          required
          type="password"
          value={form.password}
        />

        {loginError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loginError.message}
          </div>
        ) : null}

        <button
          className="w-full rounded-lg bg-[#1f140a] px-4 py-2 font-semibold text-white disabled:opacity-60"
          disabled={isLoggingIn}
          type="submit"
        >
          {isLoggingIn ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
