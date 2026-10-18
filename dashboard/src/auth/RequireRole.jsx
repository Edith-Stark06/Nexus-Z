import { Navigate, useLocation } from "react-router-dom";
import { allowed, homeFor, useSession } from "./session";

/**
 * Keeps a screen to the roles that may open it. This is a convenience of the demo, not a security
 * control: the API behind it has no authentication (see ./session.js).
 */
export default function RequireRole({ children }) {
  const session = useSession();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!allowed(session.role, location.pathname)) {
    return <Navigate to={homeFor(session.role)} replace />;
  }
  return children;
}
