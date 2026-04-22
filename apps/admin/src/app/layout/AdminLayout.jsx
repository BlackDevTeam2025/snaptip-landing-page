import { Link, Outlet, useNavigate } from "react-router-dom";

import { useAuthActions, useAuthMe } from "@/features/auth/hooks/useAuth";

export function AdminLayout() {
  const navigate = useNavigate();
  const { data: me } = useAuthMe();
  const { logout, isLoggingOut } = useAuthActions();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#f7f7f8]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold text-[#1f140a]">SnapTip Admin</h1>
            <nav className="flex items-center gap-3 text-sm text-black/70">
              <Link className="rounded px-2 py-1 hover:bg-black/5" to="/installations">
                Installations
              </Link>
              <Link className="rounded px-2 py-1 hover:bg-black/5" to="/webhooks">
                Webhooks
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-black/60">{me?.email || "Admin"}</span>
            <button
              className="rounded bg-[#1f140a] px-3 py-1.5 text-white disabled:opacity-50"
              disabled={isLoggingOut}
              onClick={onLogout}
              type="button"
            >
              {isLoggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
