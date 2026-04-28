import { useMemo, useEffect, useRef, useState } from "react";
import AppShell from "../components/Appshell";
import { useDashboardStore } from "../store/useDashboardStore";



function tokenizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function buildCanonicalName(name) {
  return tokenizeName(name).sort().join(" ");
}

function isLikelySamePersonName(personName, searchValue) {
  const search = (searchValue || "").trim();
  if (!search) return true;

  const personTokens = tokenizeName(personName);
  const searchTokens = tokenizeName(search);

  if (!personTokens.length || !searchTokens.length) return false;

  const personSet = new Set(personTokens);
  const searchSet = new Set(searchTokens);

  const common = [...searchSet].filter((word) => personSet.has(word));
  const searchIsSubset = searchTokens.every((word) => personSet.has(word));

  const rawContains = (personName || "")
    .toLowerCase()
    .includes(search.toLowerCase());

  const canonicalPerson = buildCanonicalName(personName);
  const canonicalSearch = buildCanonicalName(search);
  const canonicalContains =
    canonicalPerson.includes(canonicalSearch) ||
    canonicalSearch.includes(canonicalPerson);

  const fuzzyTokenMatch = common.length >= 2 && searchIsSubset;

  return rawContains || canonicalContains || fuzzyTokenMatch;
}

function dedupePeopleByName(people = []) {
  const bestByKey = new Map();

  for (const person of people) {
    const canonical = buildCanonicalName(person?.name || "");
    const fallbackKey = person?.personKey || person?.id || canonical;
    const key = canonical || fallbackKey;

    if (!bestByKey.has(key)) {
      bestByKey.set(key, person);
      continue;
    }

    const existing = bestByKey.get(key);

    const existingScore =
      (existing?.status === "SAFE" ? 100 : 0) +
      ((existing?.dept ? 1 : 0) + (existing?.role ? 1 : 0));

    const currentScore =
      (person?.status === "SAFE" ? 100 : 0) +
      ((person?.dept ? 1 : 0) + (person?.role ? 1 : 0));

    if (currentScore >= existingScore) {
      bestByKey.set(key, person);
    }
  }

  return Array.from(bestByKey.values());
}

export default function PersonnelPage() {
  const emergencyActive = useDashboardStore((s) => s.emergencyActive);
  const personnel = useDashboardStore((s) => s.personnel) ?? [];
  const selectedDepartment = useDashboardStore((s) => s.selectedDepartment);
  const searchTerm = useDashboardStore((s) => s.searchTerm);
  const setDepartmentFilter = useDashboardStore((s) => s.setDepartmentFilter);
  const setSearchTerm = useDashboardStore((s) => s.setSearchTerm);
  const loadEmergencyStatus = useDashboardStore((s) => s.loadEmergencyStatus);
  const triggerEmergency = useDashboardStore((s) => s.triggerEmergency);
  const clearEmergency = useDashboardStore((s) => s.clearEmergency);
  const togglePersonStatus = useDashboardStore((s) => s.togglePersonStatus);
  const loadMorePersonnel = useDashboardStore((s) => s.loadMorePersonnel);
  const personnelHasMore = useDashboardStore((s) => s.personnelHasMore);
  const personnelLoading = useDashboardStore((s) => s.personnelLoading);
  const personnelLoadingMore = useDashboardStore((s) => s.personnelLoadingMore);
  const setPersonnelSearch = useDashboardStore((s) => s.setPersonnelSearch);
  const setPersonnelDepartment = useDashboardStore((s) => s.setPersonnelDepartment);
  const fetchPersonnel = useDashboardStore((s) => s.fetchPersonnel);
  const emergencyActionLoading = useDashboardStore((s) => s.emergencyActionLoading);
  const didSearchEffectInitRef = useRef(false);
  

  const didInitRef = useRef(false);
  const prevEmergencyRef = useRef(emergencyActive);
  const scrollRef = useRef(null);

  const [searchInput, setSearchInputLocal] = useState(searchTerm || "");

  useEffect(() => {
  if (!didSearchEffectInitRef.current) {
    didSearchEffectInitRef.current = true;
    return;
  }

  const trimmed = (searchInput || "").trim();

  const timer = setTimeout(() => {
    if (trimmed.length > 0 && trimmed.length < 3) {
      return;
    }

    setSearchTerm?.(trimmed);

    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }

    if (emergencyActive) {
      setPersonnelSearch?.(trimmed);
    } else {
      fetchPersonnel?.();
    }
  }, 1000);

  return () => clearTimeout(timer);
}, [
  searchInput,
  emergencyActive,
  setSearchTerm,
  setPersonnelSearch,
  fetchPersonnel,
]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadEmergencyStatus?.({ forceRefreshPersonnel: true });
  }, [loadEmergencyStatus]);

  useEffect(() => {
    const wasEmergency = prevEmergencyRef.current;
    prevEmergencyRef.current = emergencyActive;

    if (wasEmergency && !emergencyActive) {
      setSearchInputLocal("");
      setSearchTerm?.("");
      setPersonnelSearch?.("");
      setPersonnelDepartment?.("ALL");
    }
  }, [emergencyActive, setSearchTerm, setPersonnelSearch, setPersonnelDepartment]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;

      if (nearBottom && personnelHasMore && !personnelLoadingMore) {
        loadMorePersonnel?.();
      }
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [loadMorePersonnel, personnelHasMore, personnelLoadingMore]);

  const civilians = useMemo(() => {
    const source = Array.isArray(personnel)
      ? personnel.filter((p) => !p.isRescue)
      : [];
    return dedupePeopleByName(source);
  }, [personnel]);

  const watchlistPeople = useMemo(() => {
    const source = emergencyActive
      ? civilians.filter((p) => p.status !== "SAFE")
      : civilians;

    return dedupePeopleByName(source);
  }, [civilians, emergencyActive]);

  const filtered = useMemo(() => {
    if (emergencyActive) {
      return civilians;
    }

    const search = (searchTerm || "").trim();

    return civilians.filter((p) => {
      const deptOk =
        !selectedDepartment ||
        selectedDepartment === "ALL" ||
        p.dept === selectedDepartment;

      const textOk =
        !search || isLikelySamePersonName(p.name, search);
      return deptOk && textOk;
    });
  }, [civilians, selectedDepartment, searchTerm, emergencyActive]);

  const personnelTotal = useDashboardStore((s) => s.personnelTotal) ?? 0;
  const safeCount = useDashboardStore((s) => s.safeTotal) ?? 0;
  const notSafeCount = useDashboardStore((s) => s.notSafeTotal) ?? 0;

  const departments = [
    "ALL",
    ...new Set(civilians.map((p) => (p.dept || "").trim()).filter(Boolean)),
  ];

  return (
    <AppShell
      title="Personnel Command Center"
      subtitle={
        emergencyActive
          ? "Emergency active: persistent accountability from emergency session"
          : "Normal mode: live personnel from turnstile entrance"
      }
      summaryStats={[
        { value: personnelTotal, label: "TRACKED" },
        {
          value: emergencyActive ? safeCount : "-",
          label: "SAFE",
          variant: "green",
        },
        {
          value: emergencyActive ? notSafeCount : "-",
          label: "NOT SAFE",
          variant: "red",
        },
        {
          value: emergencyActive ? "ACTIVE" : "NORMAL",
          label: "STATE",
          variant: "amber",
        },
      ]}
      actionSlot={
        <button
  className={`top-nav-btn ${emergencyActive ? "active" : ""}`}
  disabled={emergencyActionLoading}
  style={{
    opacity: emergencyActionLoading ? 0.6 : 1,
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
  {emergencyActionLoading ? "Loading..." : emergencyActive ? "Stop" : "Start"}
</button>
      }
    >
      <aside className="panel left-panel">
  <div className="panel-title">Filters</div>

  <input
    className="styled-input"
    value={searchInput}
    onChange={(e) => setSearchInputLocal(e.target.value)}
    placeholder="Search personnel..."
  />

  <select
    className="styled-input"
    value={selectedDepartment}
    onChange={(e) => {
      const value = e.target.value;
      setDepartmentFilter?.(value);

      if (emergencyActive) {
        setPersonnelDepartment?.(value);
      } else {
        fetchPersonnel?.();
      }

      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    }}
  >
    {departments.map((dept) => (
      <option key={dept} value={dept}>
        {dept === "ALL" ? "All Departments" : dept}
      </option>
    ))}
  </select>

  {emergencyActive && (
    <button
      className="primary-action-btn"
      disabled={personnelLoading}
      onClick={() => {
        loadEmergencyStatus?.({ forceRefreshPersonnel: true });
      }}
    >
      {personnelLoading ? "Syncing..." : "Sync Mustering"}
    </button>
  )}
</aside>

      <section className="panel center-panel">
        <div className="table-card">
          <div className="table-title">
            {emergencyActive ? "Emergency Accountability" : "Current Personnel"}
          </div>

        <div className="personnel-scroll-area" ref={scrollRef}>
            {filtered.length > 0 ? (
              <>
                {filtered.map((person) => (
                  <div
                    className="personnel-card-simple"
                    key={`${person.personKey}-${person.id}`}
                    onClick={() => {
                        if (!emergencyActive) return;
                        togglePersonStatus?.(person.id);
                        }}
                    style={{
                      cursor: emergencyActive ? "pointer" : "default",
                      opacity: person.status === "SAFE" ? 0.9 : 1,
                    }}
                  >
                    <div className="personnel-card-left">
                      <div className="personnel-dot" />
                      <div className="personnel-card-main">
                        <div className="personnel-name-lg">{person.name}</div>
                        <div className="personnel-group-sm">{person.dept}</div>
                      </div>
                    </div>

                    {emergencyActive && (
                      <div>
                        <span
                          className={`status-chip ${
                            person.status === "SAFE" ? "done" : ""
                          }`}
                          style={{
                            ...(person.status !== "SAFE"
                              ? {
                                  background: "rgba(239,68,68,0.12)",
                                  color: "#ef4444",
                                }
                              : {}),
                          }}
                        >
                          {person.status}
                        </span>
                      </div>
                    )}
                  </div>
                ))}

                {personnelLoadingMore && (
                  <div className="metric-card">
                    <div className="metric-label">Loading</div>
                    <div className="metric-value">Loading more personnel...</div>
                  </div>
                )}
              </>
            ) : (
              <div className="metric-card">
                <div className="metric-label">
                  {personnelLoading ? "Loading personnel..." : "No personnel found"}
                </div>
                <div className="metric-value">
                  {emergencyActive
                    ? "No emergency accountability snapshot available"
                    : "No live personnel detected"}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="panel right-panel">
        <div className="panel-title">
          {emergencyActive ? "Potential Risks" : "Inside Plant"}
        </div>

        <div className="watchlist-panel">
          {watchlistPeople.length > 0 ? (
            watchlistPeople.map((p) => (
              <div className="watchlist-row" key={`${p.personKey}-${p.id}`}>
                <span
                  className={`watchlist-dot ${emergencyActive ? "danger" : "normal"}`}
                />
                <div className="watchlist-name-only">{p.name}</div>
              </div>
            ))
          ) : (
            <div className="watchlist-empty">
              {emergencyActive ? "All Safe" : "No personnel found"}
            </div>
          )}
        </div>
      </aside>
    </AppShell>
  );
}