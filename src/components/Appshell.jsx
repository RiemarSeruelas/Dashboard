import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useDashboardStore } from "../store/useDashboardStore";

export default function AppShell({
  title,
  subtitle,
  summaryStats = [],
  actionSlot = null,
  children,
}) {
  const location = useLocation();
  const theme = useDashboardStore((s) => s.theme);
  const toggleTheme = useDashboardStore((s) => s.toggleTheme);
  const [navOpen, setNavOpen] = useState(false);

  const navItems = [
    { label: "Personnel", path: "/personnel" },
    { label: "Analytics", path: "/analytics" },
    { label: "History", path: "/history" },
    { label: "Rescue", path: "/rescue" },
  ];

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const logout = () => {
    sessionStorage.removeItem("appAccess");
    window.location.href = "/passcode";
  };

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        {/* DESKTOP TOPBAR */}
        <div className="desktop-topbar">
          <div className="topbar-left">
            <div className="brand-card">
              <div className="brand-icon">🛡️</div>
              <div className="brand-text">
                <div className="brand-title">EMERGENCY DASHBOARD</div>
                <div className="brand-subtitle">Safety Monitoring System</div>
              </div>
            </div>

            {navItems.map((item) => (
              <Link key={item.path} to={item.path} className="top-nav-link">
                <button
                  className={`top-nav-btn ${
                    location.pathname === item.path ? "active" : ""
                  }`}
                >
                  {item.label}
                </button>
              </Link>
            ))}
          </div>

          <div className="topbar-right">
            {actionSlot}

            <button className="top-nav-btn" onClick={logout}>
              Logout
            </button>

            <button className="top-nav-btn" onClick={toggleTheme}>
              {theme === "dark" ? "☀ Light" : "🌙 Dark"}
            </button>

            <div className="admin-chip">Admin</div>
          </div>
        </div>

        {/* MOBILE TOPBAR */}
        <div className="mobile-topbar">
          <div className="mobile-topbar-row">
            <button
              className="mobile-icon-btn"
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>

            <div className="mobile-brand">
              <div className="mobile-brand-icon">🛡️</div>
              <div className="mobile-brand-title">Emergency Dashboard</div>
            </div>

            <button
              className="mobile-icon-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "☀" : "🌙"}
            </button>
          </div>

          <div className="mobile-action-row">
            <div className="mobile-action-slot">{actionSlot}</div>

            <button className="mobile-action-btn" onClick={toggleTheme}>
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </header>

      {/* MOBILE DRAWER BACKDROP */}
      {navOpen && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* MOBILE DRAWER */}
      <aside className={`mobile-drawer ${navOpen ? "open" : ""}`}>
        <div className="mobile-drawer-header">
          <div className="mobile-drawer-title">Menu</div>

          <button
            className="mobile-drawer-close"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div className="mobile-drawer-links">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="mobile-drawer-link"
              onClick={() => setNavOpen(false)}
            >
              <button
                className={`mobile-drawer-btn ${
                  location.pathname === item.path ? "active" : ""
                }`}
              >
                {item.label}
              </button>
            </Link>
          ))}

          <button className="mobile-drawer-btn" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      {/* SUMMARY */}
      <section className="summary-strip">
        <div className="summary-left">
          <div className="summary-badge">⚠️</div>

          <div>
            <div className="summary-title">{title}</div>
            <div className="summary-subtitle">{subtitle}</div>
          </div>
        </div>

        <div className="summary-stats">
          {summaryStats.map((stat, idx) => (
            <div key={idx} className={`summary-stat ${stat.variant || ""}`}>
              <div className="summary-value">{stat.value}</div>
              <div className="summary-label">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <main className="workspace">{children}</main>
    </div>
  );
}