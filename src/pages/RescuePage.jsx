import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/Appshell";
import { useDashboardStore } from "../store/useDashboardStore";

const ROLE_OPTIONS = [
  "Incident Commander",
  "Safety Officer",
  "Emergency Captain",
  "Area Marshal",
  "Fire Brigade Dressing",
  "Fire Brigade Savoury",
  "First Aider",
  "Search & Rescue",
  "Environment",
  "Security",
];

const DEFAULT_ROLE = "Incident Commander";

const ROLE_TONES = {
  "Incident Commander": "violet",
  "Safety Officer": "blue",
  "Emergency Captain": "amber",
  "Area Marshal": "cyan",
  "Fire Brigade Dressing": "red",
  "Fire Brigade Savoury": "rose",
  "First Aider": "green",
  "Search & Rescue": "indigo",
  Environment: "emerald",
  Security: "slate",
};

function getRoleTone(role) {
  return ROLE_TONES[role] || "slate";
}

export default function RescuePage() {
  const rescuePersonnel = useDashboardStore((s) => s.rescuePersonnel) ?? [];
  const fetchRescuePersonnel = useDashboardStore((s) => s.fetchRescuePersonnel);
  const addRescuePersonnel = useDashboardStore((s) => s.addRescuePersonnel);
  const removeRescuePersonnel = useDashboardStore(
    (s) => s.removeRescuePersonnel,
  );
  const updateRescuePersonnel = useDashboardStore(
    (s) => s.updateRescuePersonnel,
  );

  const emergencyActive = useDashboardStore((s) => s.emergencyActive);
  const triggerEmergency = useDashboardStore((s) => s.triggerEmergency);
  const clearEmergency = useDashboardStore((s) => s.clearEmergency);
  const emergencyActionLoading = useDashboardStore(
    (s) => s.emergencyActionLoading,
  );

  const [showAddModal, setShowAddModal] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [selectedRole, setSelectedRole] = useState(DEFAULT_ROLE);
  const [selectedName, setSelectedName] = useState("");
  const [selectedDept, setSelectedDept] = useState("");
  const [selectedLUid, setSelectedLUid] = useState("");

  const [dbResults, setDbResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const [roleFilter, setRoleFilter] = useState("ALL");
  const [listSearch, setListSearch] = useState("");

  const [selectedPerson, setSelectedPerson] = useState(null);
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState(DEFAULT_ROLE);

  useEffect(() => {
    fetchRescuePersonnel?.();
  }, [fetchRescuePersonnel]);

  useEffect(() => {
    const trimmed = searchInput.trim();

    if (selectedName || trimmed.length < 3) {
      setDbResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setLoadingSearch(true);

        const res = await fetch(
          `/api/personnel-search?search=${encodeURIComponent(trimmed)}`,
        );

        const text = await res.text();

        let data = [];
        try {
          data = text ? JSON.parse(text) : [];
        } catch {
          console.error("[dashboard] Personnel search returned invalid data.");
          setDbResults([]);
          return;
        }

        if (!res.ok) {
          console.error("[dashboard] Personnel search is unavailable.");
          setDbResults([]);
          return;
        }

        setDbResults(Array.isArray(data) ? data : []);
      } catch {
        console.error("[dashboard] Personnel search is unavailable.");
        setDbResults([]);
      } finally {
        setLoadingSearch(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchInput, selectedName]);

  const rescueTeam = useMemo(() => {
    const rows = Array.isArray(rescuePersonnel) ? rescuePersonnel : [];
    const search = listSearch.trim().toLowerCase();

    return rows.filter((p) => {
      const nameOk =
        !search ||
        String(p.name || "")
          .toLowerCase()
          .includes(search);

      const roleOk =
        roleFilter === "ALL" || String(p.role || "") === roleFilter;

      return nameOk && roleOk;
    });
  }, [rescuePersonnel, listSearch, roleFilter]);

  const clearAddForm = () => {
    setSearchInput("");
    setPhoneInput("");
    setSelectedRole(DEFAULT_ROLE);
    setSelectedName("");
    setSelectedDept("");
    setSelectedLUid("");
    setDbResults([]);
    setLoadingSearch(false);
  };

  const closeAddModal = () => {
    clearAddForm();
    setShowAddModal(false);
  };

  const handleSelectDbPerson = (person) => {
    const name = person?.Person || "";
    const dept = person?.PersonGroup || "";
    const lUid = person?.L_UID || "";

    setSelectedName(name);
    setSelectedDept(dept);
    setSelectedLUid(lUid);
    setSearchInput(name);
    setDbResults([]);
  };

  const handleAddRescue = async (e) => {
    e.preventDefault();

    if (!selectedName.trim()) return;

    await addRescuePersonnel?.({
      lUid: selectedLUid,
      name: selectedName.trim(),
      dept: selectedDept || "EMERGENCY",
      role: selectedRole,
      phone: phoneInput.trim(),
    });

    closeAddModal();
    await fetchRescuePersonnel?.();
  };

  const handleOpenDetails = (person) => {
    setSelectedPerson(person);
    setEditPhone(person?.phone || "");
    setEditRole(person?.role || DEFAULT_ROLE);
  };

  const handleCloseDetails = () => {
    setSelectedPerson(null);
    setEditPhone("");
    setEditRole(DEFAULT_ROLE);
  };

  const handleUpdatePerson = async () => {
    if (!selectedPerson?.id) return;

    await updateRescuePersonnel?.(selectedPerson.id, {
      phone: editPhone.trim(),
      role: editRole,
    });

    handleCloseDetails();
    await fetchRescuePersonnel?.();
  };

  const handleRemove = async () => {
    if (!selectedPerson?.id) return;

    await removeRescuePersonnel?.(selectedPerson.id);
    handleCloseDetails();
    await fetchRescuePersonnel?.();
  };

  return (
    <AppShell
      title="Rescue Team"
      summaryStats={[
        { value: rescueTeam.length, label: "INSIDE RESPONDERS" },
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
            opacity: emergencyActionLoading ? 0.65 : 1,
            cursor: emergencyActionLoading ? "wait" : "pointer",
          }}
          onClick={() => {
            if (emergencyActionLoading) return;
            emergencyActive ? clearEmergency?.() : triggerEmergency?.();
          }}
        >
          {emergencyActionLoading
            ? "Loading..."
            : emergencyActive
              ? "Stop"
              : "Start"}
        </button>
      }
      workspaceClassName="two-column-workspace rescue-workspace"
    >
      <aside className="panel left-panel">
        <div className="panel-title">Add Rescue Personnel</div>

        <button
          className="primary-action-btn"
          onClick={() => setShowAddModal(true)}
        >
          + Add Rescue Personnel
        </button>

        <div className="rescue-stats-section">
          <div className="panel-title">Rescue Stats</div>

          <div className="metric-stack">
            <div className="metric-card">
              <div className="metric-label">Visible Responders</div>
              <div className="metric-value safe-text">{rescueTeam.length}</div>
            </div>

            <div className="mini-info-card">
              <div className="mini-info-title">Inside Building</div>

              <div className="rescue-name-list">
                {rescueTeam.length > 0 ? (
                  rescueTeam.map((person) => (
                    <div className="rescue-name-row" key={`side-${person.id}`}>
                      <span
                        className={`watchlist-dot rescue-role-dot rescue-tone-${getRoleTone(person.role)}`}
                      />
                      <span>{person.name}</span>
                    </div>
                  ))
                ) : (
                  <div className="mini-info-text">
                    No rescue personnel inside.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <section className="panel center-panel">
        <div className="table-card">
          <div className="table-title">Inside Rescue Personnel</div>

          <div className="rescue-list-toolbar">
            <input
              className="styled-input"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Search rescue names..."
            />

            <select
              className="styled-input"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="ALL">All Roles</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          <div className="rescue-grid">
            {rescueTeam.length > 0 ? (
              rescueTeam.map((person) => {
                const roleTone = getRoleTone(person.role);

                return (
                  <div
                    className={`rescue-card rescue-tone-${roleTone}`}
                    data-category={person.role || "Responder"}
                    key={person.id}
                    onClick={() => handleOpenDetails(person)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenDetails(person);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="rescue-card-row">
                      <div className="rescue-inside-dot" title="Inside" />

                      <div>
                        <div className="rescue-name">{person.name}</div>

                        <div className="rescue-category">
                          <span>Category</span>
                          <strong>{person.role}</strong>
                        </div>

                        <div className="rescue-contact">
                          {person.phone || "No phone number"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="metric-card">
                <div className="metric-label">No rescue personnel inside</div>
              </div>
            )}
          </div>
        </div>
      </section>

      {showAddModal && (
        <div className="detail-modal-overlay" onClick={closeAddModal}>
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close-btn"
              onClick={closeAddModal}
              aria-label="Close add form"
            >
              ×
            </button>

            <div className="detail-title">Add Rescue Personnel</div>
            <div className="detail-subtitle">
              Search from personnel database, assign a rescue role, and add
              phone number.
            </div>

            <form className="rescue-form" onSubmit={handleAddRescue}>
              <div className="rescue-picker-wrap">
                <div style={{ position: "relative" }}>
                  <input
                    className="styled-input"
                    value={searchInput}
                    onChange={(e) => {
                      const value = e.target.value;

                      setSearchInput(value);
                      setSelectedName("");
                      setSelectedDept("");
                      setSelectedLUid("");

                      if (value.trim().length < 3) {
                        setDbResults([]);
                      }
                    }}
                    placeholder="Search name from DB..."
                    style={{ paddingRight: selectedName ? "44px" : undefined }}
                  />

                  {selectedName && (
                    <button
                      type="button"
                      className="rescue-clear-btn"
                      onClick={() => {
                        setSearchInput("");
                        setSelectedName("");
                        setSelectedDept("");
                        setSelectedLUid("");
                        setDbResults([]);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>

                {!selectedName && loadingSearch && (
                  <div className="mini-info-text">Searching personnel...</div>
                )}

                {!selectedName && dbResults.length > 0 && (
                  <div className="rescue-search-results">
                    {dbResults.map((person, index) => (
                      <button
                        type="button"
                        className="rescue-search-result"
                        key={`${person.L_UID || person.Person}-${index}`}
                        onClick={() => handleSelectDbPerson(person)}
                      >
                        <span>{person.Person}</span>
                        <small>
                          {person.PersonGroup || "No department"} ·{" "}
                          {person.L_UID || "No L_UID"}
                        </small>
                      </button>
                    ))}
                  </div>
                )}

                {!selectedName &&
                  !loadingSearch &&
                  searchInput.trim().length >= 3 &&
                  dbResults.length === 0 && (
                    <div className="mini-info-text">
                      No personnel found for this search.
                    </div>
                  )}
              </div>

              <select
                className="styled-input"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>

              <input
                className="styled-input"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Phone number..."
              />

              {selectedName && (
                <div className="mini-info-card">
                  <div className="mini-info-title">{selectedName}</div>
                  <div className="mini-info-text">
                    {selectedDept || "No department"}
                  </div>
                  <div className="mini-info-text">
                    L_UID: {selectedLUid || "No L_UID"}
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="primary-action-btn"
                disabled={!selectedName.trim()}
                style={{
                  opacity: selectedName.trim() ? 1 : 0.55,
                  cursor: selectedName.trim() ? "pointer" : "not-allowed",
                }}
              >
                Add to Rescue List
              </button>
            </form>
          </div>
        </div>
      )}

      {selectedPerson && (
        <div className="detail-modal-overlay" onClick={handleCloseDetails}>
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close-btn"
              onClick={handleCloseDetails}
              aria-label="Close details"
            >
              ×
            </button>

            <div className="detail-title">{selectedPerson.name}</div>
            <div className="detail-subtitle">
              {selectedPerson.dept || "Unknown Department"}
            </div>

            <div className="detail-list rescue-detail-list">
              <div>
                <div className="detail-label">Rescue Role</div>
                <select
                  className="styled-input"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="detail-label">Phone Number</div>
                <input
                  className="styled-input"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Phone number..."
                />
              </div>
            </div>

            <div className="rescue-actions" style={{ marginTop: 16 }}>
              <button
                className="primary-action-btn"
                onClick={handleUpdatePerson}
              >
                Save
              </button>

              <button
                className="primary-action-btn"
                onClick={handleRemove}
                style={{ background: "#ef4444" }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
