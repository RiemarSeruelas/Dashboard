import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../components/Appshell";
import { useDashboardStore } from "../store/useDashboardStore";

function useAnimatedNumber(target, duration = 500) {
  const [value, setValue] = useState(Number(target) || 0);

  useEffect(() => {
    let frameId;
    const startValue = Number(value) || 0;
    const endValue = Number(target) || 0;
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = startValue + (endValue - startValue) * eased;
      setValue(nextValue);

      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    }

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [target, duration]);

  return value;
}

function normalizePerson(person, index = 0) {
  return {
    id:
      person?.id ??
      person?.person_key ??
      person?.l_uid ??
      person?.L_UID ??
      `person-${index}`,
    name:
      person?.name ??
      person?.person ??
      person?.Person ??
      "Unknown",
    dept:
      person?.dept ??
      person?.persongroup ??
      person?.department ??
      person?.PersonGroup ??
      "Unknown Department",
    role:
      person?.role ??
      person?.initial_mode ??
      person?.mode ??
      person?.L_Mode ??
      "Unknown Role",
    status:
      person?.status ??
      person?.current_status ??
      "NOT SAFE",
  };
}

export default function AnalyticsPage() {
  const personnel = useDashboardStore((s) => s.personnel) ?? [];
  const history = useDashboardStore((s) => s.history) ?? [];
  const emergencyActive = useDashboardStore((s) => s.emergencyActive);
  const triggerEmergency = useDashboardStore((s) => s.triggerEmergency);
  const clearEmergency = useDashboardStore((s) => s.clearEmergency);
  const personnelTotal = useDashboardStore((s) => s.personnelTotal) ?? 0;
  const safeTotal = useDashboardStore((s) => s.safeTotal) ?? 0;
  const notSafeTotal = useDashboardStore((s) => s.notSafeTotal) ?? 0;

  const selectedAnalyticsEventId =
    useDashboardStore((s) => s.selectedAnalyticsEventId) ?? "LIVE";
  const setSelectedAnalyticsEventId = useDashboardStore(
    (s) => s.setSelectedAnalyticsEventId
  );
  const fetchPersonnel = useDashboardStore((s) => s.fetchPersonnel);
  const fetchHistory = useDashboardStore((s) => s.fetchHistory);
  const fetchSessionDetails = useDashboardStore((s) => s.fetchSessionDetails);

  const [historicalPeople, setHistoricalPeople] = useState([]);
  const [loadingHistoricalPeople, setLoadingHistoricalPeople] = useState(false);

  const didInitRef = useRef(false);
  const lastLoadedSessionRef = useRef(null);
  const emergencyActionLoading = useDashboardStore((s) => s.emergencyActionLoading);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    if (!Array.isArray(history) || history.length === 0) {
      fetchHistory?.();
    }
  }, [fetchHistory, history]);

  useEffect(() => {
    async function loadAnalyticsSource() {
      try {
        if (selectedAnalyticsEventId === "LIVE") {
          setHistoricalPeople([]);
          lastLoadedSessionRef.current = "LIVE";

          const noPersonnelLoaded = !Array.isArray(personnel) || personnel.length === 0;

          if (noPersonnelLoaded) {
            await fetchPersonnel?.();
          }
          return;
        }

        if (lastLoadedSessionRef.current === selectedAnalyticsEventId) {
          return;
        }

        lastLoadedSessionRef.current = selectedAnalyticsEventId;
        setLoadingHistoricalPeople(true);

        const rows = await fetchSessionDetails?.(selectedAnalyticsEventId);
        setHistoricalPeople(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error("❌ ANALYTICS LOAD ERROR:", err);
        setHistoricalPeople([]);
      } finally {
        setLoadingHistoricalPeople(false);
      }
    }

    loadAnalyticsSource();
  }, [selectedAnalyticsEventId, fetchPersonnel, fetchSessionDetails, personnel]);

  const civiliansLive = useMemo(() => {
    return Array.isArray(personnel)
      ? personnel
          .filter((p) => !p?.isRescue)
          .map((p, index) => normalizePerson(p, index))
      : [];
  }, [personnel]);

  const selectedEvent = useMemo(() => {
    if (selectedAnalyticsEventId === "LIVE") return null;

    return (
      (Array.isArray(history)
        ? history.find((h) => String(h?.id) === String(selectedAnalyticsEventId))
        : null) || null
    );
  }, [history, selectedAnalyticsEventId]);

  const analyticsPeople = useMemo(() => {
    if (selectedAnalyticsEventId === "LIVE") {
      return civiliansLive;
    }

    return Array.isArray(historicalPeople)
      ? historicalPeople.map((p, index) => normalizePerson(p, index))
      : [];
  }, [selectedAnalyticsEventId, civiliansLive, historicalPeople]);

  const isLive = selectedAnalyticsEventId === "LIVE";

  const safeCount = isLive
    ? emergencyActive
      ? safeTotal
      : 0
    : analyticsPeople.filter((p) => p.status === "SAFE").length;

  const notSafeCount = isLive
    ? emergencyActive
      ? notSafeTotal
      : 0
    : analyticsPeople.length - safeCount;

  const trackedCount = isLive
    ? emergencyActive
      ? personnelTotal
      : 0
    : analyticsPeople.length;

  const safePercent = trackedCount
    ? Math.round((safeCount / trackedCount) * 100)
    : 0;

  const deptStats = useMemo(() => {
    if (isLive && !emergencyActive) return [];

    const sourcePeople = analyticsPeople;

    const grouped = [
      ...new Set(sourcePeople.map((p) => p.dept ?? "Unknown Department")),
    ];

    return grouped.map((dept) => {
      const people = sourcePeople.filter(
        (p) => (p.dept ?? "Unknown Department") === dept
      );
      const safe = people.filter((p) => p.status === "SAFE").length;
      const total = people.length;
      const percent = total ? Math.round((safe / total) * 100) : 0;

      return { dept, safe, total, percent };
    });
  }, [analyticsPeople, isLive, emergencyActive]);

  const selectedLabel = selectedEvent
    ? `${selectedEvent?.timestamp ?? "Unknown"} (${
        selectedEvent?.duration ?? "Unknown"
      })`
    : emergencyActive
    ? "LIVE ACTIVE EMERGENCY"
    : "NO ACTIVE EMERGENCY";

  const animatedSafeCount = useAnimatedNumber(safeCount, 500);
  const animatedNotSafeCount = useAnimatedNumber(notSafeCount, 500);
  const animatedSafePercent = useAnimatedNumber(safePercent, 600);

  const donutSize = 150;
  const strokeWidth = 18;
  const radius = (donutSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset =
    circumference - (animatedSafePercent / 100) * circumference;

  return (
    <AppShell
      title="Analytics Overview"
      subtitle="Emergency readiness, personnel safety distribution, and department hotspots"
      summaryStats={[
        { value: trackedCount, label: "TRACKED" },
        { value: safeCount, label: "SAFE", variant: "green" },
        { value: notSafeCount, label: "NOT SAFE", variant: "red" },
        { value: `${safePercent}%`, label: "READINESS", variant: "amber" },
      ]}
      actionSlot={
  <button
    className={`top-nav-btn ${emergencyActive ? "active" : ""}`}
    disabled={emergencyActionLoading}
    style={{
      opacity: emergencyActionLoading ? 0.65 : 1,
      cursor: emergencyActionLoading ? "wait" : "pointer",
    }}
    onClick={() => {
      if (emergencyActionLoading) return;

      if (emergencyActive) {
        clearEmergency?.();
      } else {
        triggerEmergency?.();
      }
    }}
  >
    {emergencyActionLoading
      ? "Loading..."
      : emergencyActive
      ? "Stop"
      : "Start"}
  </button>
}
    >
      <aside className="panel left-panel">
        <div className="panel-section">
          <div className="panel-title">Analytics Source</div>
          <label className="field-label">Pick Event</label>

          <select
            className="styled-input"
            value={selectedAnalyticsEventId}
            onChange={(e) => setSelectedAnalyticsEventId?.(e.target.value)}
          >
            <option value="LIVE">LIVE CURRENT STATE</option>
            {Array.isArray(history) &&
              history.map((item) => (
                <option key={item?.id} value={item?.id}>
                  {item?.timestamp
                    ? new Date(item.timestamp).toLocaleString("en-PH", {
                        timeZone: "Asia/Manila",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "Untitled Event"}
                </option>
              ))}
          </select>
        </div>

        <div className="mini-info-card">
          <div className="mini-info-title">Selected Dataset</div>
          <div className="mini-info-text">{selectedLabel}</div>
        </div>

        {selectedAnalyticsEventId !== "LIVE" && loadingHistoricalPeople && (
          <div className="mini-info-card">
            <div className="mini-info-text">Loading historical snapshot...</div>
          </div>
        )}
      </aside>

      <section className="panel center-panel">
        <div className="two-chart-grid">
          <div className="chart-card">
            <h3>Personnel Status Count</h3>
            <div className="fake-chart">
              <div className="bar-wrap">
                <div className="bar-label">Safe</div>
                <div className="bar-track">
                  <div
                    className="bar-fill safe-bar animated-bar"
                    style={{
                      width: `${
                        trackedCount
                          ? (animatedSafeCount / trackedCount) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="bar-value">
                  {Math.round(animatedSafeCount)}
                </div>
              </div>

              <div className="bar-wrap">
                <div className="bar-label">Not Safe</div>
                <div className="bar-track">
                  <div
                    className="bar-fill unsafe-bar animated-bar"
                    style={{
                      width: `${
                        trackedCount
                          ? (animatedNotSafeCount / trackedCount) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="bar-value">
                  {Math.round(animatedNotSafeCount)}
                </div>
              </div>
            </div>
          </div>

          <div className="chart-card">
            <h3>Safety Distribution (%)</h3>
            <div className="donut-card">
              <div className="svg-donut-wrap">
                <svg
                  width={donutSize}
                  height={donutSize}
                  viewBox={`0 0 ${donutSize} ${donutSize}`}
                  className="svg-donut"
                >
                  <circle
                    className="svg-donut-unsafe"
                    cx={donutSize / 2}
                    cy={donutSize / 2}
                    r={radius}
                    strokeWidth={strokeWidth}
                    fill="none"
                  />
                  <circle
                    className="svg-donut-progress"
                    cx={donutSize / 2}
                    cy={donutSize / 2}
                    r={radius}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                  />
                </svg>

                <div className="svg-donut-center">
                  {Math.round(animatedSafePercent)}%
                </div>
              </div>

              <div className="donut-legend">
                <div>
                  <span className="legend-dot safe" /> Safe
                </div>
                <div>
                  <span className="legend-dot unsafe" /> Not Safe
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="panel right-panel">
        <div className="panel-title">Department Safety Status</div>

        <div className="hotspot-list">
          {deptStats.map((item) => (
            <div key={item.dept} className="hotspot-item">
              <div className="hotspot-head">
                <span>{item.dept}</span>
                <span>{item.percent}%</span>
              </div>

              <div className="hotspot-track">
                <div
                  className={`hotspot-fill animated-bar ${
                    item.percent === 100
                      ? "good"
                      : item.percent >= 50
                      ? "warn"
                      : "bad"
                  }`}
                  style={{ width: `${item.percent}%` }}
                />
              </div>
            </div>
          ))}

          {deptStats.length === 0 && (
            <div className="mini-info-card">
              <div className="mini-info-text">
                {selectedAnalyticsEventId === "LIVE" && !emergencyActive
                  ? "No active emergency analytics."
                  : loadingHistoricalPeople
                  ? "Loading analytics data..."
                  : "No analytics data available yet."}
              </div>
            </div>
          )}
        </div>
      </aside>
    </AppShell>
  );
}