import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";

import PasscodePage from "./pages/PasscodePage";
import PersonnelPage from "./pages/PersonnelPage";
import RescuePage from "./pages/RescuePage";
import AnalyticsPage from "./pages/AnalyticsPage";
import HistoryPage from "./pages/HistoryPage";

function createVisitSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `visit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function App() {
  useEffect(() => {
    console.log(
      "%cMade by Riemar R. Seruelas Jr - Data Digital Intern",
      "color: #006bff; font-weight: 800; font-family: monospace;",
    );

    const sessionIdKey = "emergencyVisitSessionId";
    const loggedKey = "emergencyVisitRecorded";
    let sessionId = sessionStorage.getItem(sessionIdKey);
    let retryTimer;
    let cancelled = false;

    if (!sessionId) {
      sessionId = createVisitSessionId();
      sessionStorage.setItem(sessionIdKey, sessionId);
    }

    async function recordVisit(attempt = 0) {
      if (cancelled || sessionStorage.getItem(loggedKey) === "true") return;

      try {
        const response = await fetch("/api/visit-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId,
            firstPath: window.location.pathname || "/",
            userAgent: navigator.userAgent,
          }),
        });

        if (!response.ok) {
          throw new Error(`Visit logging failed: ${response.status}`);
        }

        sessionStorage.setItem(loggedKey, "true");
      } catch {
        if (attempt < 2 && !cancelled) {
          retryTimer = window.setTimeout(
            () => recordVisit(attempt + 1),
            1500 * (attempt + 1),
          );
        } else {
          console.error("[dashboard] Visit session could not be recorded.");
        }
      }
    }

    recordVisit();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/passcode" element={<PasscodePage />} />

        <Route
          path="/personnel"
          element={
            <ProtectedRoute>
              <PersonnelPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/rescue"
          element={
            <ProtectedRoute>
              <RescuePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <AnalyticsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <HistoryPage />
            </ProtectedRoute>
          }
        />

        <Route path="/" element={<Navigate to="/personnel" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
