import { Navigate, Route, Routes } from "react-router-dom";

import { AdminLayout } from "./layout/AdminLayout";
import { RequireAuth } from "./RequireAuth";

import { useAuthMe } from "@/features/auth/hooks/useAuth";
import { ChangePasswordPage } from "@/features/auth/pages/ChangePasswordPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { InstallationDetailPage } from "@/features/installations/pages/InstallationDetailPage";
import { InstallationsPage } from "@/features/installations/pages/InstallationsPage";
import { WebhooksPage } from "@/features/webhooks/pages/WebhooksPage";

function PublicOnlyRoute({ children }) {
  const { data: me, isLoading } = useAuthMe();
  if (isLoading) {
    return null;
  }
  if (me?.must_change_password) {
    return <Navigate replace to="/change-password" />;
  }
  if (me && !me.must_change_password) {
    return <Navigate replace to="/installations" />;
  }
  return children;
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
        path="/login"
      />
      <Route
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route element={<Navigate replace to="/installations" />} index />
        <Route element={<ChangePasswordPage />} path="change-password" />
        <Route element={<InstallationsPage />} path="installations" />
        <Route element={<InstallationDetailPage />} path="installations/:id" />
        <Route element={<WebhooksPage />} path="webhooks" />
      </Route>
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}
