import { create } from "zustand";

const PAGE_SIZE = 20;

function getTodayManilaClient() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value) {
  if (!value) return "";

  const raw = String(value);

  // Plain DB date: 2026-05-13
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  // ISO timestamp: convert using Manila timezone
  const date = new Date(raw);

  if (!Number.isNaN(date.getTime())) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;

    return `${year}-${month}-${day}`;
  }

  return raw.slice(0, 10);
}

function normalizePerson(row, index = 0, isEmergency = false) {
  if (isEmergency) {
    return {
      id: row?.id ?? row?.l_uid ?? row?.L_UID ?? `row-${index}`,
      personKey:
        row?.person_key ??
        `${(row?.person ?? row?.Person ?? "").trim().toLowerCase()}|${(
          row?.persongroup ??
          row?.PersonGroup ??
          ""
        )
          .trim()
          .toLowerCase()}`,
      name: row?.person ?? row?.Person ?? "Unknown",
      dept:
        row?.persongroup ??
        row?.PersonGroup ??
        row?.department ??
        "Unknown Department",
      role:
        row?.initial_mode ??
        row?.L_Mode ??
        row?.mode ??
        "Unknown Role",
      status: row?.current_status ?? row?.status ?? "NOT SAFE",
      isRescue: false,
      phone: row?.phone ?? "",
      email: row?.email ?? "",
      img: row?.img ?? "",
      time: row?.updated_at ?? row?.C_Time ?? null,
      timeIn: row?.timeIn ?? "",
      timeOut: row?.timeOut ?? "",
      ltid: row?.initial_tid ?? row?.L_TID ?? null,
    };
  }

  return {
    id: row?.L_UID ?? row?.l_uid ?? `row-${index}`,
    personKey:
      row?.person_key ??
      `${(row?.Person ?? row?.person ?? "").trim().toLowerCase()}|${(
        row?.PersonGroup ??
        row?.persongroup ??
        ""
      ).trim()}`,
    name: row?.Person ?? row?.person ?? "Unknown",
    dept:
      row?.PersonGroup ??
      row?.persongroup ??
      row?.department ??
      "Unknown Department",
    role:
      row?.L_Mode ??
      row?.initial_mode ??
      row?.mode ??
      "Unknown Role",
    status: row?.status ?? "IN PLANT",
    isRescue: false,
    phone: row?.phone ?? "",
    email: row?.email ?? "",
    img: row?.img ?? "",
    time: row?.C_Time ?? row?.updated_at ?? null,
    timeIn: row?.timeIn ?? "",
    timeOut: row?.timeOut ?? "",
    ltid: row?.L_TID ?? row?.initial_tid ?? null,
  };
}

function formatDuration(startedAt, endedAt, isActive) {
  if (isActive || !startedAt || !endedAt) return "Active";

  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const diffMs = end - start;

  if (Number.isNaN(diffMs) || diffMs < 0) return "Unknown";

  const mins = Math.floor(diffMs / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);

  return `${mins}m ${secs}s`;
}

async function parseJsonResponse(res) {
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return data;
}

function buildPagingUrl(baseUrl, offset, limit = PAGE_SIZE, extraParams = {}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  return `${baseUrl}?${params.toString()}`;
}

export const useDashboardStore = create((set, get) => ({
  emergencyActive: false,
  emergencyStartTime: null,
  emergencyActionLoading: false,

  personnel: [],
  rescuePersonnel: [],
  history: [],
  analytics: [],

  selectedDepartment: "ALL",
  searchTerm: "",
  selectedAnalyticsEventId: "LIVE",
  theme: localStorage.getItem("dashboard-theme") || "light",

  personnelOffset: 0,
  personnelHasMore: true,
  personnelLoading: false,
  personnelLoadingMore: false,
  personnelTotal: 0,
  safeTotal: 0,
  notSafeTotal: 0,
  personnelDate: null,
  personnelSearch: "",
  personnelDepartment: "ALL",

  historyOffset: 0,
  historyHasMore: true,
  historyLoading: false,
  historyLoadingMore: false,
  historyTotal: 0,

  // rescue search state
  rescueSearch: "",
  rescueDepartment: "ALL",

  mapRecord: null,

  // optimization guards
  statusLoading: false,
  lastMusteringSyncAt: 0,
  lastPersonnelRefreshKey: "",
  lastPersonnelRefreshAt: 0,

  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("dashboard-theme", nextTheme);
      return { theme: nextTheme };
    }),

  setDepartmentFilter: (dept) => set({ selectedDepartment: dept }),
  setSearchTerm: (term) => set({ searchTerm: term }),
  setSelectedAnalyticsEventId: (id) => set({ selectedAnalyticsEventId: id }),

  // rescue search actions
  setRescueSearch: async (term) => {
    const normalized = (term || "").trim();
    set({ rescueSearch: normalized });
    await get().fetchRescuePersonnel({ search: normalized, dept: get().rescueDepartment });
  },

  setRescueDepartment: async (dept) => {
    set({ rescueDepartment: dept });
    await get().fetchRescuePersonnel({ search: get().rescueSearch, dept });
  },

  loadEmergencyStatus: async ({ forceRefreshPersonnel = false } = {}) => {
    if (get().statusLoading) return;

    set({ statusLoading: true });

    try {
      const res = await fetch("/api/emergency-status");
      const data = await parseJsonResponse(res);

      const isActive = !!data?.emergencyActive;
      const activeSession = data?.activeSession ?? null;

      const prevEmergencyActive = get().emergencyActive;
      const prevStartTime = get().emergencyStartTime;

      const nextStartTime =
        isActive && activeSession?.started_at
          ? new Date(activeSession.started_at).getTime()
          : null;

      const stateChanged =
        prevEmergencyActive !== isActive || prevStartTime !== nextStartTime;

      set({
        emergencyActive: isActive,
        emergencyStartTime: nextStartTime,
      });

      const now = Date.now();
      const lastSync = get().lastMusteringSyncAt ?? 0;
      const shouldSyncMustering = isActive && now - lastSync > 15000;

      if (shouldSyncMustering) {
        const syncRes = await fetch(
          "/api/emergency/sync-mustering",
          { method: "POST" }
        );
        await parseJsonResponse(syncRes);
        set({ lastMusteringSyncAt: now });
      }

      if (stateChanged || forceRefreshPersonnel || get().personnel.length === 0) {
        await get().refreshPersonnel({ force: true });
      }
    } catch (err) {
      console.error("❌ LOAD EMERGENCY STATUS ERROR:", err);
    } finally {
      set({ statusLoading: false });
    }
  },

  triggerEmergency: async () => {
  if (get().emergencyActionLoading) return;

  set({ emergencyActionLoading: true });

  try {
    const res = await fetch("/api/emergency/start", {
      method: "POST",
    });

    const data = await parseJsonResponse(res);

    set({
      emergencyActive: true,
      emergencyStartTime: data?.activeSession?.started_at
        ? new Date(data.activeSession.started_at).getTime()
        : Date.now(),
      lastPersonnelRefreshKey: "",
      lastPersonnelRefreshAt: 0,
    });

    await get().refreshPersonnel({ force: true });
    await get().refreshHistory();
    await get().fetchRescuePersonnel();
  } catch (err) {
    console.error("❌ TRIGGER EMERGENCY ERROR:", err);
  } finally {
    set({ emergencyActionLoading: false });
  }
},

clearEmergency: async () => {
  if (get().emergencyActionLoading) return;

  set({ emergencyActionLoading: true });

  try {
    const res = await fetch("/api/emergency/stop", {
      method: "POST",
    });

    await parseJsonResponse(res);

    set({
      emergencyActive: false,
      emergencyStartTime: null,
      lastPersonnelRefreshKey: "",
      lastPersonnelRefreshAt: 0,
    });

    await get().refreshPersonnel({ force: true });
    await get().refreshHistory();
    await get().fetchRescuePersonnel();
  } catch (err) {
    console.error("❌ CLEAR EMERGENCY ERROR:", err);
  } finally {
    set({ emergencyActionLoading: false });
  }
},


  refreshPersonnel: async ({ force = false } = {}) => {
    if (get().personnelLoading && !force) return;

    const isEmergency = get().emergencyActive;
    const personnelDate = get().personnelDate;
    const personnelSearch = get().personnelSearch;
    const personnelDepartment = get().personnelDepartment;
    const searchTerm = get().searchTerm;
    const selectedDepartment = get().selectedDepartment;

    const refreshKey = JSON.stringify({
      isEmergency,
      personnelDate,
      personnelSearch,
      personnelDepartment,
      searchTerm,
      selectedDepartment,
      page: 0,
    });

    const now = Date.now();
    const lastKey = get().lastPersonnelRefreshKey;
    const lastAt = get().lastPersonnelRefreshAt;

    // soft cooldown to avoid repeated identical refreshes
    if (!force && refreshKey === lastKey && now - lastAt < 2000) {
      return;
    }

    set({
      personnelLoading: true,
      personnelLoadingMore: false,
    });

    try {
      const endpoint = isEmergency
        ? buildPagingUrl(
            "/api/emergency-accountability",
            0,
            PAGE_SIZE,
            {
              search: personnelSearch,
              dept: personnelDepartment,
            }
          )
        : buildPagingUrl(
            "/api/hikvision-normal",
            0,
            PAGE_SIZE,
            {
              date: personnelDate,
              search: searchTerm,
              dept: selectedDepartment,
            }
          );

      const res = await fetch(endpoint);
      const data = await parseJsonResponse(res);

      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const mappedPersonnel = rows.map((row, index) =>
        normalizePerson(row, index, isEmergency)
      );

      set({
        personnel: mappedPersonnel,
        personnelOffset: mappedPersonnel.length,
        personnelHasMore: !!data?.hasMore,
        personnelLoading: false,
        personnelTotal: Number(data?.total) || mappedPersonnel.length,
        safeTotal: Number(data?.safeCount) || 0,
        notSafeTotal: Number(data?.notSafeCount) || 0,
        lastPersonnelRefreshKey: refreshKey,
        lastPersonnelRefreshAt: now,
      });
    } catch (error) {
      console.error("❌ REFRESH PERSONNEL ERROR:", error);
      set({
        personnelLoading: false,
        personnelHasMore: false,
      });
    }
  },

  loadMorePersonnel: async () => {
    const {
      emergencyActive,
      personnel,
      personnelOffset,
      personnelHasMore,
      personnelLoading,
      personnelLoadingMore,
      personnelDate,
    } = get();

    if (personnelLoading || personnelLoadingMore || !personnelHasMore) return;

    set({ personnelLoadingMore: true });

    try {
      const personnelSearch = get().personnelSearch;
      const personnelDepartment = get().personnelDepartment;
      const searchTerm = get().searchTerm;
      const selectedDepartment = get().selectedDepartment;

      const endpoint = emergencyActive
        ? buildPagingUrl(
            "/api/emergency-accountability",
            personnelOffset,
            PAGE_SIZE,
            {
              search: personnelSearch,
              dept: personnelDepartment,
            }
          )
        : buildPagingUrl(
            "/api/hikvision-normal",
            personnelOffset,
            PAGE_SIZE,
            {
              date: personnelDate,
              search: searchTerm,
              dept: selectedDepartment,
            }
          );

      const res = await fetch(endpoint);
      const data = await parseJsonResponse(res);

      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const mapped = rows.map((row, index) =>
        normalizePerson(row, personnel.length + index, emergencyActive)
      );

      set({
        personnel: [...personnel, ...mapped],
        personnelOffset: personnelOffset + mapped.length,
        personnelHasMore: !!data?.hasMore,
        personnelLoadingMore: false,
        personnelTotal: Number(data?.total) || personnel.length + mapped.length,
        safeTotal: Number(data?.safeCount) || 0,
        notSafeTotal: Number(data?.notSafeCount) || 0,
      });
    } catch (err) {
      console.error("❌ LOAD MORE PERSONNEL ERROR:", err);
      set({ personnelLoadingMore: false });
    }
  },

  fetchPersonnel: async () => {
    await get().refreshPersonnel({ force: true });
  },

  fetchPersonnelFromDb: async (dateStr) => {
    set({
      personnelDate: dateStr || null,
      lastPersonnelRefreshKey: "",
      lastPersonnelRefreshAt: 0,
    });
    await get().refreshPersonnel({ force: true });
  },

  setPersonnelSearch: async (term) => {
  const normalized = (term || "").trim();

  set({
    personnelSearch: normalized,
    personnelOffset: 0,
    personnelHasMore: true,
    lastPersonnelRefreshKey: "",
    lastPersonnelRefreshAt: 0,
  });

  if (normalized.length === 0 || normalized.length >= 3) {
    await get().refreshPersonnel({ force: true });
  }
},

  setPersonnelDepartment: async (dept) => {
    set({
      personnelDepartment: dept,
      personnelOffset: 0,
      personnelHasMore: true,
      lastPersonnelRefreshKey: "",
      lastPersonnelRefreshAt: 0,
    });
    await get().refreshPersonnel({ force: true });
  },

  togglePersonStatus: async (id) => {
    const state = get();

    if (!state.emergencyActive) return;

    const person = state.personnel.find((p) => p.id === id);

    if (!person) {
      console.error("❌ Person not found in local state:", id);
      return;
    }

    if (!person.personKey) {
      console.error("❌ Missing personKey, cannot update DB:", person);
      return;
    }

    const nextStatus = person.status === "SAFE" ? "NOT SAFE" : "SAFE";

    set((currentState) => ({
      personnel: currentState.personnel.map((p) =>
        p.id === id ? { ...p, status: nextStatus } : p
      ),
      safeTotal:
        nextStatus === "SAFE"
          ? (currentState.safeTotal ?? 0) + 1
          : Math.max((currentState.safeTotal ?? 0) - 1, 0),
      notSafeTotal:
        nextStatus === "SAFE"
          ? Math.max((currentState.notSafeTotal ?? 0) - 1, 0)
          : (currentState.notSafeTotal ?? 0) + 1,
    }));

    try {
      const res = await fetch("/api/emergency/update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personKey: person.personKey,
          status: nextStatus,
          markedBy: "operator",
        }),
      });

      const data = await parseJsonResponse(res);

      if (!data?.success || !data?.updated) {
        throw new Error("Failed to update status");
      }

      await get().refreshHistory();
    } catch (err) {
      console.error("❌ UPDATE STATUS ERROR:", err);

      set({
        personnel: state.personnel,
        safeTotal: state.safeTotal ?? 0,
        notSafeTotal: state.notSafeTotal ?? 0,
      });
    }
  },

  fetchSessionDetails: async (sessionId) => {
    try {
      const res = await fetch(
        `/api/emergency/history/${sessionId}`
      );
      const rows = await parseJsonResponse(res);

      return Array.isArray(rows)
        ? rows.map((row, index) => normalizePerson(row, index, true))
        : [];
    } catch (err) {
      console.error("❌ FETCH SESSION DETAILS ERROR:", err);
      return [];
    }
  },

  refreshHistory: async () => {
    set({
      history: [],
      historyOffset: 0,
      historyHasMore: true,
      historyLoading: true,
      historyLoadingMore: false,
    });

    try {
      const res = await fetch(
        buildPagingUrl("/api/emergency/history", 0)
      );
      const data = await parseJsonResponse(res);

      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const mappedHistory = rows.map((row) => ({
        id: row?.id,
        sessionKey: row?.session_key,
        timestamp: row?.started_at,
        endedAt: row?.ended_at,
        duration: formatDuration(
          row?.started_at,
          row?.ended_at,
          row?.is_active
        ),
        active: !!row?.is_active,
        safe: Number(row?.safe_count) || 0,
        notSafe: Number(row?.not_safe_count) || 0,
        total: Number(row?.total_people) || 0,
      }));

      set({
        history: mappedHistory,
        historyOffset: mappedHistory.length,
        historyHasMore: !!data?.hasMore,
        historyLoading: false,
        historyTotal: Number(data?.total) || mappedHistory.length,
      });
    } catch (err) {
      console.error("❌ REFRESH HISTORY ERROR:", err);
      set({
        history: [],
        historyLoading: false,
        historyHasMore: false,
        historyTotal: 0,
      });
    }
  },

  loadMoreHistory: async () => {
    const {
      history,
      historyOffset,
      historyHasMore,
      historyLoading,
      historyLoadingMore,
    } = get();

    if (historyLoading || historyLoadingMore || !historyHasMore) return;

    set({ historyLoadingMore: true });

    try {
      const res = await fetch(
        buildPagingUrl("/api/emergency/history", historyOffset)
      );
      const data = await parseJsonResponse(res);

      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const mapped = rows.map((row) => ({
        id: row?.id,
        sessionKey: row?.session_key,
        timestamp: row?.started_at,
        endedAt: row?.ended_at,
        duration: formatDuration(
          row?.started_at,
          row?.ended_at,
          row?.is_active
        ),
        active: !!row?.is_active,
        safe: Number(row?.safe_count) || 0,
        notSafe: Number(row?.not_safe_count) || 0,
        total: Number(row?.total_people) || 0,
      }));

      set({
        history: [...history, ...mapped],
        historyOffset: historyOffset + mapped.length,
        historyHasMore: !!data?.hasMore,
        historyLoadingMore: false,
        historyTotal: Number(data?.total) || history.length + mapped.length,
      });
    } catch (err) {
      console.error("❌ LOAD MORE HISTORY ERROR:", err);
      set({ historyLoadingMore: false });
    }
  },

  fetchHistory: async () => {
    await get().refreshHistory();
  },

  fetchAnalytics: async (sessionId) => {
    try {
      const res = await fetch(
        `/api/emergency/analytics/${sessionId}`
      );
      const rows = await parseJsonResponse(res);

      set({ analytics: Array.isArray(rows) ? rows : [] });
    } catch (err) {
      console.error("❌ FETCH ANALYTICS ERROR:", err);
      set({ analytics: [] });
    }
  },

 fetchRescuePersonnel: async ({ search = "", dept = "ALL" } = {}) => {
  try {
    const params = new URLSearchParams();

    if (search) params.append("search", search);
    if (dept && dept !== "ALL") params.append("dept", dept);

    // cache buster para sure hindi stale browser/Vite/proxy response
    params.append("_t", String(Date.now()));

    const url = `/api/rescue-team?${params.toString()}`;

    console.log("🔥 FETCHING RESCUE TEAM FROM:", url);

    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const rows = await parseJsonResponse(res);

    const todayManila = getTodayManilaClient();

    console.log("🔥 RESCUE RAW ROWS FROM BACKEND:", rows);
    console.log("🔥 FRONTEND TODAY MANILA:", todayManila);

    const safeRows = Array.isArray(rows)
  ? rows.filter((row) => {
      const rowDate = normalizeDateOnly(row.last_date);
      const backendToday = normalizeDateOnly(
        row.server_today_manila || row.filter_date
      );
      const compareToday = backendToday || todayManila;

      const rowTid = String(row.last_tid ?? "").trim();
      const rowMode = String(row.last_mode ?? "").trim().toLowerCase();

      const isToday = rowDate === compareToday;
      const isIn = rowTid === "1";
      const isAllowedLocation =
        rowMode === "flane 1 entrance" ||
        rowMode === "flane 2 entrance" ||
        rowMode.includes("mustering");

      const keep = isToday && isIn && isAllowedLocation;

      if (!keep) {
        console.warn("🚫 FRONTEND BLOCKED BAD RESCUE ROW:", {
          name: row.name,
          hikvisionName: row.hikvision_name,
          lastDate: row.last_date,
          rowDate,
          backendToday,
          frontendTodayManila: todayManila,
          compareToday,
          lastTid: row.last_tid,
          lastMode: row.last_mode,
          isToday,
          isIn,
          isAllowedLocation,
          routeVersion: row.route_version,
        });
      }

      return keep;
    })
  : [];

    const mapped = safeRows.map((row) => ({
      id: row.id,
      personKey: `rescue|${row.id}`,
      name: row.name ?? row.hikvision_name ?? "Unknown",
      dept: row.dept ?? row.hikvision_group ?? "Unknown Department",
      role: row.role ?? "Responder",
      status: row.inside ? "INSIDE" : "OUTSIDE",
      isRescue: true,
      phone: row.phone ?? "",
      email: row.email ?? "",
      inside: !!row.inside,
      lastMode: row.last_mode ?? "",
      lastTime: row.last_time ?? "",
      lastDate: row.last_date ?? "",
      lastTid: row.last_tid ?? "",
      lUid: row.l_uid ?? row.hikvision_l_uid ?? "",
      hikvisionName: row.hikvision_name ?? "",
    }));

    console.log("✅ RESCUE SAFE ROWS DISPLAYED:", mapped);

    set({ rescuePersonnel: mapped });
  } catch (err) {
    console.error("❌ FETCH RESCUE PERSONNEL ERROR:", err);
    set({ rescuePersonnel: [] });
  }
},

addRescuePersonnel: async (personData) => {
  try {
    const res = await fetch("/api/rescue-team", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(personData),
    });

    await parseJsonResponse(res);

    await get().fetchRescuePersonnel({
      search: get().rescueSearch,
      dept: get().rescueDepartment,
    });
  } catch (err) {
    console.error("❌ ADD RESCUE PERSONNEL ERROR:", err);
  }
},

updateRescuePersonnel: async (id, updates) => {
  try {
    const res = await fetch(`/api/rescue-team/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });

    await parseJsonResponse(res);

    await get().fetchRescuePersonnel({
      search: get().rescueSearch,
      dept: get().rescueDepartment,
    });
  } catch (err) {
    console.error("❌ UPDATE RESCUE PERSONNEL ERROR:", err);
  }
},

removeRescuePersonnel: async (id) => {
  try {
    const res = await fetch(`/api/rescue-team/${id}`, {
      method: "DELETE",
    });

    await parseJsonResponse(res);

    await get().fetchRescuePersonnel({
      search: get().rescueSearch,
      dept: get().rescueDepartment,
    });
  } catch (err) {
    console.error("❌ REMOVE RESCUE PERSONNEL ERROR:", err);
  }
},

  resetDashboard: () => {
    set({
      emergencyActive: false,
      emergencyActionLoading: false,
      emergencyStartTime: null,
      personnel: [],
      rescuePersonnel: [],
      history: [],
      analytics: [],
      selectedDepartment: "ALL",
      searchTerm: "",
      selectedAnalyticsEventId: "LIVE",
      personnelOffset: 0,
      personnelHasMore: true,
      personnelLoading: false,
      personnelLoadingMore: false,
      personnelTotal: 0,
      safeTotal: 0,
      notSafeTotal: 0,
      personnelDate: null,
      personnelSearch: "",
      personnelDepartment: "ALL",
      historyOffset: 0,
      historyHasMore: true,
      historyLoading: false,
      historyLoadingMore: false,
      historyTotal: 0,
      mapRecord: null,
      statusLoading: false,
      lastMusteringSyncAt: 0,
      lastPersonnelRefreshKey: "",
      lastPersonnelRefreshAt: 0,
    });
  },
}));