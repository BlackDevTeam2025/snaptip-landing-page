import PropTypes from "prop-types";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthMe } from "@/features/auth/hooks/useAuth";

export function RequireAuth({ children }) {
  const location = useLocation();
  const { data: me, isLoading } = useAuthMe();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-black/10 bg-white p-6 text-sm text-black/70">
        Loading session...
      </div>
    );
  }

  if (!me) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }

  if (me.must_change_password && location.pathname !== "/change-password") {
    return <Navigate replace to="/change-password" />;
  }

  return children;
}

RequireAuth.propTypes = {
  children: PropTypes.node.isRequired,
};
