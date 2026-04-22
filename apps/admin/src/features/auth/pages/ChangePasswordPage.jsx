import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthActions } from "../hooks/useAuth";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { changePassword, isChangingPassword, changePasswordError } = useAuthActions();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });

  async function onSubmit(event) {
    event.preventDefault();
    await changePassword(form);
    navigate("/installations", { replace: true });
  }

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-black/10 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-xl font-semibold text-[#1f140a]">Change password</h2>
      <p className="mb-6 text-sm text-black/60">
        First login requires password update before using the admin dashboard.
      </p>

      <form onSubmit={onSubmit}>
        <label
          className="mb-2 block text-sm font-medium text-black/70"
          htmlFor="currentPassword"
        >
          Current password
        </label>
        <input
          className="mb-4 w-full rounded-lg border border-black/15 px-3 py-2 outline-none ring-brand-500 focus:ring-2"
          id="currentPassword"
          onChange={(event) =>
            setForm((prev) => ({ ...prev, currentPassword: event.target.value }))
          }
          required
          type="password"
          value={form.currentPassword}
        />

        <label
          className="mb-2 block text-sm font-medium text-black/70"
          htmlFor="newPassword"
        >
          New password (min 10 chars)
        </label>
        <input
          className="mb-4 w-full rounded-lg border border-black/15 px-3 py-2 outline-none ring-brand-500 focus:ring-2"
          id="newPassword"
          minLength={10}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, newPassword: event.target.value }))
          }
          required
          type="password"
          value={form.newPassword}
        />

        {changePasswordError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {changePasswordError.message}
          </div>
        ) : null}

        <button
          className="rounded-lg bg-[#1f140a] px-4 py-2 font-semibold text-white disabled:opacity-60"
          disabled={isChangingPassword}
          type="submit"
        >
          {isChangingPassword ? "Saving..." : "Save new password"}
        </button>
      </form>
    </div>
  );
}
