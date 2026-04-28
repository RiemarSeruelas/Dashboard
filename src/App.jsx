import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";

import PasscodePage from "./pages/PasscodePage";
import PersonnelPage from "./pages/PersonnelPage";
import RescuePage from "./pages/RescuePage";
import AnalyticsPage from "./pages/AnalyticsPage";
import HistoryPage from "./pages/HistoryPage";

export default function App() {
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