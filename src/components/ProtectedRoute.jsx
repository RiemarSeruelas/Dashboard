import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }) {
  const hasAccess = sessionStorage.getItem("appAccess") === "passcode-ok";

  if (!hasAccess) {
    return <Navigate to="/passcode" replace />;
  }

  return children;
}