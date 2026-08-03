import { useCallback, useMemo, useEffect, useRef, useState } from "react";
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

function normalizeEmergencyPerson(row, index = 0) {
  return {
    id: row?.id ?? `risk-${index}`,
    personKey:
      row?.person_key ??
      row?.personKey ??
      buildCanonicalName(row?.person ?? row?.Person ?? row?.name ?? "") ??
      `risk-${index}`,
    name: row?.person ?? row?.Person ?? row?.name ?? "Unknown",
    dept:
      row?.persongroup ?? row?.PersonGroup ?? row?.dept ?? "Unknown Department",
    role: row?.initial_mode ?? row?.role ?? "Emergency Accountability",
    status: row?.current_status ?? row?.status ?? "NOT SAFE",
    isRescue: false,
  };
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
  const setPersonnelDepartment = useDashboardStore(
    (s) => s.setPersonnelDepartment,
  );
  const fetchPersonnel = useDashboardStore((s) => s.fetchPersonnel);
  const emergencyActionLoading = useDashboardStore(
    (s) => s.emergencyActionLoading,
  );
  const didSearchEffectInitRef = useRef(false);

  const didInitRef = useRef(false);
  const prevEmergencyRef = useRef(emergencyActive);
  const scrollRef = useRef(null);
  const riskScrollRef = useRef(null);
  const riskRequestIdRef = useRef(0);

  const [searchInput, setSearchInputLocal] = useState(searchTerm || "");
  const [riskPeople, setRiskPeople] = useState([]);
  const [riskOffset, setRiskOffset] = useState(0);
  const [riskHasMore, setRiskHasMore] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskLoadingMore, setRiskLoadingMore] = useState(false);
  const [musteringSyncing, setMusteringSyncing] = useState(false);

  const rememberScrollPositions = useCallback(() => {
    const mainEl = scrollRef.current;
    const riskEl = riskScrollRef.current;

    return {
      windowX: window.scrollX || 0,
      windowY: window.scrollY || 0,
      mainTop: mainEl?.scrollTop ?? 0,
      riskTop: riskEl?.scrollTop ?? 0,
    };
  }, []);

  const restoreScrollPositions = useCallback((positions) => {
    if (!positions) return;

    window.requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = positions.mainTop;
      }

      if (riskScrollRef.current) {
        riskScrollRef.current.scrollTop = positions.riskTop;
      }

      window.scrollTo(positions.windowX, positions.windowY);

      window.requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = positions.mainTop;
        }

        if (riskScrollRef.current) {
          riskScrollRef.current.scrollTop = positions.riskTop;
        }

        window.scrollTo(positions.windowX, positions.windowY);
      });
    });
  }, []);

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

  const loadPotentialRisks = useCallback(
    async ({ reset = false } = {}) => {
      if (!emergencyActive) {
        setRiskPeople([]);
        setRiskOffset(0);
        setRiskHasMore(false);
        return;
      }

      if (riskLoading || riskLoadingMore) return;

      const requestId = riskRequestIdRef.current + 1;
      riskRequestIdRef.current = requestId;

      const nextOffset = reset ? 0 : riskOffset;

      if (reset) {
        setRiskLoading(true);
      } else {
        setRiskLoadingMore(true);
      }

      try {
        const params = new URLSearchParams({
          status: "NOT_SAFE",
          limit: "20",
          offset: String(nextOffset),
        });

        const response = await fetch(
          `/api/emergency-accountability?${params.toString()}`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to load potential risks: ${response.status}`);
        }

        const data = await response.json();
        const normalized = (data.rows || []).map(normalizeEmergencyPerson);

        if (riskRequestIdRef.current !== requestId) return;

        setRiskPeople((prev) => {
          const merged = reset ? normalized : [...prev, ...normalized];
          return dedupePeopleByName(merged).filter((p) => p.status !== "SAFE");
        });
        setRiskOffset(nextOffset + normalized.length);
        setRiskHasMore(Boolean(data.hasMore));
      } catch {
        console.error("[dashboard] Potential risks could not be loaded.");
      } finally {
        if (riskRequestIdRef.current === requestId) {
          setRiskLoading(false);
          setRiskLoadingMore(false);
        }
      }
    },
    [emergencyActive, riskLoading, riskLoadingMore, riskOffset],
  );

  const syncMusteringWithoutJump = useCallback(async () => {
    if (!emergencyActive || musteringSyncing) return;

    const positions = rememberScrollPositions();
    setMusteringSyncing(true);

    try {
      const response = await fetch("/api/emergency/sync-mustering", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Sync mustering failed: ${response.status}`);
      }

      await response.json().catch(() => null);
      await loadEmergencyStatus?.({ forceRefreshPersonnel: true });
      await loadPotentialRisks({ reset: true });
    } catch {
      console.error("[dashboard] Mustering sync failed.");
      await loadEmergencyStatus?.({ forceRefreshPersonnel: true });
      await loadPotentialRisks({ reset: true });
    } finally {
      setMusteringSyncing(false);
      restoreScrollPositions(positions);
    }
  }, [
    emergencyActive,
    musteringSyncing,
    rememberScrollPositions,
    restoreScrollPositions,
    loadEmergencyStatus,
    loadPotentialRisks,
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
  }, [
    emergencyActive,
    setSearchTerm,
    setPersonnelSearch,
    setPersonnelDepartment,
  ]);

  useEffect(() => {
    if (!emergencyActive) {
      setRiskPeople([]);
      setRiskOffset(0);
      setRiskHasMore(false);
      setRiskLoading(false);
      setRiskLoadingMore(false);
      return;
    }

    setRiskPeople([]);
    setRiskOffset(0);
    setRiskHasMore(false);
    loadPotentialRisks({ reset: true });
  }, [emergencyActive]);

  useEffect(() => {
    const el = riskScrollRef.current;
    if (!el) return;

    const handleWatchlistScroll = () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;

      if (!nearBottom) return;

      if (emergencyActive) {
        if (riskHasMore && !riskLoading && !riskLoadingMore) {
          loadPotentialRisks({ reset: false });
        }

        return;
      }

      if (personnelHasMore && !personnelLoadingMore && !personnelLoading) {
        loadMorePersonnel?.();
      }
    };

    el.addEventListener("scroll", handleWatchlistScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleWatchlistScroll);
  }, [
    emergencyActive,
    riskHasMore,
    riskLoading,
    riskLoadingMore,
    loadPotentialRisks,
    personnelHasMore,
    personnelLoadingMore,
    personnelLoading,
    loadMorePersonnel,
  ]);

  useEffect(() => {
    const el = riskScrollRef.current;
    if (!el) return;

    const canScroll = el.scrollHeight > el.clientHeight + 10;
    if (canScroll) return;

    if (emergencyActive) {
      if (riskHasMore && !riskLoading && !riskLoadingMore) {
        loadPotentialRisks({ reset: false });
      }

      return;
    }

    if (personnelHasMore && !personnelLoadingMore && !personnelLoading) {
      loadMorePersonnel?.();
    }
  }, [
    emergencyActive,
    riskPeople.length,
    riskHasMore,
    riskLoading,
    riskLoadingMore,
    loadPotentialRisks,
    personnel.length,
    personnelHasMore,
    personnelLoadingMore,
    personnelLoading,
    loadMorePersonnel,
  ]);

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

      const textOk = !search || isLikelySamePersonName(p.name, search);
      return deptOk && textOk;
    });
  }, [civilians, selectedDepartment, searchTerm, emergencyActive]);

  const watchlistPeople = useMemo(() => {
    if (!emergencyActive) {
      return filtered;
    }

    const search = (searchTerm || "").trim();

    return dedupePeopleByName(riskPeople)
      .filter((person) => person.status !== "SAFE")
      .filter((person) => {
        const departmentMatches =
          !selectedDepartment ||
          selectedDepartment === "ALL" ||
          person.dept === selectedDepartment;
        const searchMatches =
          !search || isLikelySamePersonName(person.name, search);

        return departmentMatches && searchMatches;
      });
  }, [emergencyActive, filtered, riskPeople, searchTerm, selectedDepartment]);

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
          {emergencyActionLoading
            ? "Loading..."
            : emergencyActive
              ? "Stop"
              : "Start"}
        </button>
      }
      workspaceClassName="personnel-workspace"
    >
      <aside className="panel left-panel personnel-roster-panel">
        <div className="personnel-sidebar-heading">
          <div className="panel-title">
            {emergencyActive ? "Potential Risks" : "Inside Plant"}
          </div>
        </div>

        <div className="personnel-filter-stack">
          <input
            className="styled-input personnel-filter-input"
            value={searchInput}
            onChange={(e) => setSearchInputLocal(e.target.value)}
            placeholder="Search personnel"
            aria-label="Search personnel"
          />

          <select
            className="styled-input personnel-filter-input"
            value={selectedDepartment}
            aria-label="Filter department"
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
        </div>

        {emergencyActive && (
          <button
            className="primary-action-btn personnel-sync-btn"
            disabled={personnelLoading || musteringSyncing}
            onClick={syncMusteringWithoutJump}
          >
            {personnelLoading || musteringSyncing
              ? "Syncing..."
              : "Sync Mustering"}
          </button>
        )}

        <div
          className="watchlist-panel personnel-sidebar-list"
          ref={riskScrollRef}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {watchlistPeople.length > 0 ? (
            <>
              {watchlistPeople.map((person) => (
                <div
                  className="watchlist-row"
                  key={`${person.personKey}-${person.id}`}
                >
                  <span
                    className={`watchlist-dot ${
                      emergencyActive ? "danger" : "normal"
                    }`}
                  />
                  <div className="watchlist-name-only">{person.name}</div>
                </div>
              ))}

              {emergencyActive && riskLoadingMore && (
                <div className="watchlist-empty">Loading more risks...</div>
              )}

              {!emergencyActive && personnelLoadingMore && (
                <div className="watchlist-empty">Loading more personnel...</div>
              )}
            </>
          ) : (
            <div className="watchlist-empty">
              {emergencyActive
                ? riskLoading
                  ? "Loading potential risks..."
                  : "All Safe"
                : "No personnel found"}
            </div>
          )}
        </div>
      </aside>

      <section className="panel center-panel personnel-main-panel">
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
                    onClick={async () => {
                      if (!emergencyActive || emergencyActionLoading) return;

                      const wasSafe = person.status === "SAFE";

                      try {
                        await togglePersonStatus?.(person.id);

                        if (!wasSafe) {
                          setRiskPeople((prev) =>
                            prev.filter(
                              (risk) =>
                                risk.personKey !== person.personKey &&
                                String(risk.id) !== String(person.id),
                            ),
                          );
                        }

                        window.setTimeout(() => {
                          loadPotentialRisks({ reset: true });
                        }, 250);
                      } catch {
                        console.error("[dashboard] Status update failed.");
                        loadPotentialRisks({ reset: true });
                      }
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
                  <div className="metric-card personnel-grid-message">
                    <div className="metric-label">Loading</div>
                    <div className="metric-value">
                      Loading more personnel...
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="metric-card personnel-grid-message">
                <div className="metric-label">
                  {personnelLoading
                    ? "Loading personnel..."
                    : "No personnel found"}
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
    </AppShell>
  );
}
