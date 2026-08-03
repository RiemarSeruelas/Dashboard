import { Link, useLocation } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "../store/useDashboardStore";

const MANILA_OFFSET = "+08:00";

function getDefaultScheduleWindow() {
  const now = Date.now();

  return {
    start: getManilaDateTimeInput(new Date(now + 5 * 60 * 1000)),
    finish: getManilaDateTimeInput(new Date(now + 65 * 60 * 1000)),
  };
}

function getManilaDateTimeInput(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function formatManilaDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Invalid schedule";

  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  return data;
}

export default function AppShell({
  title,
  subtitle,
  summaryStats = [],
  actionSlot = null,
  workspaceClassName = "",
  children,
}) {
  const location = useLocation();
  const theme = useDashboardStore((s) => s.theme);
  const toggleTheme = useDashboardStore((s) => s.toggleTheme);
  const loadEmergencyStatus = useDashboardStore((s) => s.loadEmergencyStatus);

  const [navOpen, setNavOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(
    () => getDefaultScheduleWindow().start,
  );
  const [scheduledUntil, setScheduledUntil] = useState(
    () => getDefaultScheduleWindow().finish,
  );
  const [schedules, setSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  const navItems = [
    { label: "Personnel", path: "/personnel" },
    { label: "Analytics", path: "/analytics" },
    { label: "History", path: "/history" },
    { label: "Rescue", path: "/rescue" },
  ];

  const minimumScheduleTime = useMemo(
    () => getManilaDateTimeInput(new Date(Date.now() + 60 * 1000)),
    [scheduleOpen],
  );

  const minimumFinishTime = useMemo(
    () => scheduledFor || minimumScheduleTime,
    [scheduledFor, minimumScheduleTime],
  );

  const fetchSchedules = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setScheduleLoading(true);

    try {
      const response = await fetch("/api/emergency/schedules", {
        cache: "no-store",
      });
      const data = await readJson(response);
      setSchedules(Array.isArray(data?.rows) ? data.rows : []);
      setScheduleError("");
    } catch (error) {
      if (!quiet) setScheduleError(error.message);
    } finally {
      if (!quiet) setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    fetchSchedules({ quiet: true });

    const interval = window.setInterval(() => {
      fetchSchedules({ quiet: true });
      loadEmergencyStatus?.();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [fetchSchedules, loadEmergencyStatus]);

  useEffect(() => {
    if (!scheduleOpen) return;

    const nextWindow = getDefaultScheduleWindow();
    setScheduledFor(nextWindow.start);
    setScheduledUntil(nextWindow.finish);
    setScheduleError("");
    fetchSchedules();
  }, [scheduleOpen, fetchSchedules]);

  const logout = () => {
    sessionStorage.removeItem("appAccess");
    window.location.href = "/passcode";
  };

  const submitSchedule = async (event) => {
    event.preventDefault();

    if (!scheduledFor || !scheduledUntil || scheduleSaving) return;

    const startDate = new Date(`${scheduledFor}:00${MANILA_OFFSET}`);
    const finishDate = new Date(`${scheduledUntil}:00${MANILA_OFFSET}`);

    if (finishDate.getTime() <= startDate.getTime()) {
      setScheduleError("Finish must be later than start.");
      return;
    }

    setScheduleSaving(true);
    setScheduleError("");

    try {
      const response = await fetch("/api/emergency/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduledFor: `${scheduledFor}:00${MANILA_OFFSET}`,
          scheduledUntil: `${scheduledUntil}:00${MANILA_OFFSET}`,
          createdBy: "operator",
        }),
      });

      await readJson(response);
      await fetchSchedules();
      const nextWindow = getDefaultScheduleWindow();
      setScheduledFor(nextWindow.start);
      setScheduledUntil(nextWindow.finish);
    } catch (error) {
      setScheduleError(error.message);
    } finally {
      setScheduleSaving(false);
    }
  };

  const cancelSchedule = async (scheduleId) => {
    setScheduleError("");

    try {
      const response = await fetch(`/api/emergency/schedules/${scheduleId}`, {
        method: "DELETE",
      });

      await readJson(response);
      await fetchSchedules();
    } catch (error) {
      setScheduleError(error.message);
    }
  };

  const scheduleButton = (
    <button
      className={`top-nav-btn schedule-nav-btn ${
        schedules.length > 0 ? "has-schedule" : ""
      }`}
      onClick={() => setScheduleOpen(true)}
      type="button"
    >
      Schedule
      {schedules.length > 0 && (
        <span className="schedule-count">{schedules.length}</span>
      )}
    </button>
  );

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="desktop-topbar">
          <div className="topbar-left">
            <div className="brand-card">
              <div className="brand-icon">🛡️</div>
              <div className="brand-text">
                <div className="brand-title">EMERGENCY DASHBOARD</div>
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
            {scheduleButton}

            <button className="top-nav-btn" onClick={logout}>
              Logout
            </button>

            <button className="top-nav-btn" onClick={toggleTheme}>
              {theme === "dark" ? "☀ Light" : "🌙 Dark"}
            </button>
          </div>
        </div>

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
            <div className="mobile-action-slot">{scheduleButton}</div>

            <button className="mobile-action-btn" onClick={toggleTheme}>
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </header>

      {navOpen && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => setNavOpen(false)}
        />
      )}

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

      <section className="summary-strip">
        <div className="summary-left">
          <div className="summary-badge">⚠️</div>

          <div>
            <div className="summary-title">{title}</div>
            {subtitle && <div className="summary-subtitle">{subtitle}</div>}
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

      <main className={`workspace ${workspaceClassName}`.trim()}>
        {children}
      </main>

      {scheduleOpen && (
        <div
          className="schedule-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setScheduleOpen(false);
          }}
        >
          <section
            className="schedule-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-modal-title"
          >
            <div className="schedule-modal-header">
              <div>
                <div className="schedule-eyebrow">START &amp; FINISH</div>
                <h2 id="schedule-modal-title">Schedule Emergency Window</h2>
              </div>

              <button
                className="schedule-close-btn"
                onClick={() => setScheduleOpen(false)}
                aria-label="Close schedule"
                type="button"
              >
                ×
              </button>
            </div>

            <form className="schedule-form" onSubmit={submitSchedule}>
              <div className="schedule-window-grid">
                <label className="schedule-field" htmlFor="scheduled-for">
                  <span>Start (Asia/Manila)</span>
                  <input
                    id="scheduled-for"
                    className="styled-input"
                    type="datetime-local"
                    min={minimumScheduleTime}
                    value={scheduledFor}
                    onChange={(event) => {
                      const nextStart = event.target.value;
                      setScheduledFor(nextStart);

                      const startDate = new Date(
                        `${nextStart}:00${MANILA_OFFSET}`,
                      );
                      const finishDate = new Date(
                        `${scheduledUntil}:00${MANILA_OFFSET}`,
                      );

                      if (
                        !Number.isNaN(startDate.getTime()) &&
                        (Number.isNaN(finishDate.getTime()) ||
                          finishDate.getTime() <= startDate.getTime())
                      ) {
                        setScheduledUntil(
                          getManilaDateTimeInput(
                            new Date(startDate.getTime() + 60 * 60 * 1000),
                          ),
                        );
                      }
                    }}
                    required
                  />
                </label>

                <label className="schedule-field" htmlFor="scheduled-until">
                  <span>Finish (Asia/Manila)</span>
                  <input
                    id="scheduled-until"
                    className="styled-input"
                    type="datetime-local"
                    min={minimumFinishTime}
                    value={scheduledUntil}
                    onChange={(event) => setScheduledUntil(event.target.value)}
                    required
                  />
                </label>
              </div>

              <button
                className="primary-action-btn schedule-submit-btn"
                disabled={scheduleSaving}
                type="submit"
              >
                {scheduleSaving ? "Saving..." : "Add Schedule"}
              </button>
            </form>

            {scheduleError && (
              <div className="schedule-error">{scheduleError}</div>
            )}

            <div className="schedule-list-header">
              <span>Upcoming schedules</span>
              <span>{schedules.length}</span>
            </div>

            <div className="schedule-list">
              {scheduleLoading ? (
                <div className="schedule-empty">Loading schedules...</div>
              ) : schedules.length > 0 ? (
                schedules.map((schedule) => (
                  <div className="schedule-row" key={schedule.id}>
                    <div>
                      <div className="schedule-row-time">
                        <span>Start</span>
                        {formatManilaDateTime(schedule.scheduled_for)}
                      </div>
                      <div className="schedule-row-time">
                        <span>Finish</span>
                        {formatManilaDateTime(schedule.scheduled_until)}
                      </div>
                      <div className="schedule-row-meta">
                        {schedule.status === "STARTING"
                          ? "Starting now"
                          : schedule.status === "STARTED" ||
                              schedule.status === "STOPPING"
                            ? "Emergency window active"
                            : "Waiting to start"}
                      </div>
                    </div>

                    {schedule.status === "SCHEDULED" && (
                      <button
                        className="schedule-cancel-btn"
                        onClick={() => cancelSchedule(schedule.id)}
                        type="button"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="schedule-empty">No emergency is scheduled.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
