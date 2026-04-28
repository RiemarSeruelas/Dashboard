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

const EMPTY_FORM = {
  name: "",
  role: "Incident Commander",
  dept: "EMERGENCY",
  phone: "",
  email: "",
  time: "08:00A",
  timeIn: "08:00",
  timeOut: "17:00",
  img: "",
};

export default function RescuePage() {
  const rescuePersonnel = useDashboardStore((s) => s.rescuePersonnel) ?? [];
  const fetchRescuePersonnel = useDashboardStore((s) => s.fetchRescuePersonnel);
  const addRescuePersonnel = useDashboardStore((s) => s.addRescuePersonnel);
  const removeRescuePersonnel = useDashboardStore((s) => s.removeRescuePersonnel);
  const updateRescuePersonnel = useDashboardStore((s) => s.updateRescuePersonnel);
  const emergencyActive = useDashboardStore((s) => s.emergencyActive);
  const triggerEmergency = useDashboardStore((s) => s.triggerEmergency);
  const clearEmergency = useDashboardStore((s) => s.clearEmergency);
  const emergencyActionLoading = useDashboardStore((s) => s.emergencyActionLoading);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [rescueSearch, setRescueSearch] = useState("");
  const [rescueDept, setRescueDept] = useState("ALL");
  const [rescueRole, setRescueRole] = useState("ALL");
  
  
  useEffect(() => {
    fetchRescuePersonnel?.();
  }, [fetchRescuePersonnel]);

  const handleRescueSearch = (e) => {
  const term = e.target.value;
  setRescueSearch(term);

  clearTimeout(window.rescueSearchTimeout);
  window.rescueSearchTimeout = setTimeout(() => {
    fetchRescuePersonnel?.({ search: term, role: rescueRole });
  }, 300);
};

const handleRescueRoleChange = (e) => {
  const role = e.target.value;
  setRescueRole(role);
  fetchRescuePersonnel?.({ search: rescueSearch, role });
};

  const rescueTeam = useMemo(() => {
    return Array.isArray(rescuePersonnel) ? rescuePersonnel : [];
  }, [rescuePersonnel]);

  const hasMedicalSupport = rescueTeam.some((p) => {
    const role = String(p.role || "").toLowerCase();
    return (
      role.includes("medical") ||
      role.includes("medic") ||
      role.includes("first aid") ||
      role.includes("aid") ||
      role.includes("nurse") ||
      role.includes("doctor") ||
      role.includes("first aider")
    );
  });

  const hasEvacSupport = rescueTeam.some((p) => {
    const role = String(p.role || "").toLowerCase();
    return (
      role.includes("evac") ||
      role.includes("marshal") ||
      role.includes("warden") ||
      role.includes("rescue") ||
      role.includes("safety") ||
      role.includes("captain") ||
      role.includes("commander")
    );
  });

  const contactCount = rescueTeam.filter((p) => p.phone || p.email).length;

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const openAddForm = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  };

  const handleAddPerson = async (e) => {
    e.preventDefault();

    if (!formData.name?.trim() || !formData.role?.trim()) return;

    const payload = {
      ...formData,
      name: formData.name.trim(),
      role: formData.role.trim(),
      dept: formData.dept?.trim() || "EMERGENCY",
      phone: formData.phone?.trim() || "",
      email: formData.email?.trim() || "",
    };

    if (editingId) {
      await updateRescuePersonnel(editingId, payload);
    } else {
      await addRescuePersonnel(payload);
    }

    resetForm();
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onloadend = () => {
      setFormData((prev) => ({
        ...prev,
        img: reader.result,
      }));
    };

    reader.readAsDataURL(file);
  };

  const handleEditPerson = (person) => {
    setFormData({
      name: person?.name ?? "",
      role: person?.role ?? "Incident Commander",
      dept: person?.dept ?? "EMERGENCY",
      phone: person?.phone ?? "",
      email: person?.email ?? "",
      time: person?.time ?? "08:00A",
      timeIn: person?.timeIn ?? "08:00",
      timeOut: person?.timeOut ?? "17:00",
      img: person?.img ?? "",
    });

    setEditingId(person?.id ?? null);
    setShowForm(true);
  };

  const handleOpenDetails = (person) => {
    setSelectedPerson(person);
  };

  const handleCloseDetails = () => {
    setSelectedPerson(null);
  };

  return (
    <AppShell
      title="Emergency Response Team"
      subtitle="Authorized rescue and medical support personnel"
      summaryStats={[
        { value: rescueTeam.length, label: "TEAM SIZE" },
        { value: "DB", label: "STORAGE", variant: "amber" },
        { value: "24/7", label: "COVERAGE" },
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
        <div className="panel-title">Rescue Protocol</div>

        <div className="mini-info-text">
          Rescue personnel are manually maintained and stored separately from
          normal accountability.
        </div>

        <div className="mini-info-card">
          <div className="mini-info-title">Team Administration</div>

          <button className="primary-action-btn" onClick={openAddForm}>
            + Add Personnel
          </button>
        </div>
      </aside>

      <section className="panel center-panel">
        <div className="rescue-search-bar">
          <input
            type="text"
            className="styled-input rescue-search-input"
            placeholder="Search by name..."
            value={rescueSearch}
            onChange={handleRescueSearch}
          />

          <select
  className="styled-input rescue-dept-select"
  value={rescueRole}
  onChange={handleRescueRoleChange}
>
  <option value="ALL">All Departments</option>

  <option value="Incident Commander">
    Incident Commander
  </option>

  <option value="Safety Officer">
    Safety Officer
  </option>

  <option value="Emergency Captain">
    Emergency Captain
  </option>

  <option value="Area Marshal">
    Area Marshal
  </option>

  <option value="Fire Brigade Dressing">
    Fire Brigade Dressing
  </option>

  <option value="Fire Brigade Savoury">
    Fire Brigade Savoury
  </option>

  <option value="First Aider">
    First Aider
  </option>

  <option value="Search & Rescue">
    Search & Rescue
  </option>

  <option value="Environment">
    Environment
  </option>

  <option value="Security">
    Security
  </option>
</select>
        </div>

        <div className="rescue-grid">
          {rescueTeam.length > 0 ? (
            rescueTeam.map((person) => (
              <div
                className="rescue-card"
                key={person.id}
                onClick={() => handleOpenDetails(person)}
              >
                <div className="rescue-card-row">
                  <img
                    src={person.img || "/default-avatar.jpg"}
                    alt={person.name}
                    className="rescue-avatar"
                  />

                  <div>
                    <div className="rescue-name">{person.name}</div>

                    <div className="rescue-meta-row">
                      <span className="rescue-badge">{person.dept}</span>

                      <span className="rescue-time-chip">
                        {person.timeIn && person.timeOut
                          ? `${person.timeIn} - ${person.timeOut}`
                          : person.time}
                      </span>
                    </div>

                    <div className="rescue-role">{person.role}</div>

                    <div className="rescue-contact">
                      {person.email || person.phone || "No contact info"}
                    </div>
                  </div>
                </div>

                <div className="rescue-actions">
                  <button
                    className="circle-action-btn edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditPerson(person);
                    }}
                    title="Edit"
                  >
                    ✏️
                  </button>

                  <button
                    className="circle-action-btn"
                    onClick={async (e) => {
                      e.stopPropagation();

                      await removeRescuePersonnel(person.id);

                      if (selectedPerson?.id === person.id) {
                        setSelectedPerson(null);
                      }
                    }}
                    style={{ background: "#ef4444" }}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="metric-card">
              <div className="metric-label">No rescue members yet</div>
              <div className="metric-value">
                Add your response team from the left panel
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="panel right-panel">
        <div className="panel-title">Deployment Status</div>

        <div className="metric-stack">
          <div className="metric-card">
            <div className="metric-label">Active Responders</div>
            <div className="metric-value safe-text">{rescueTeam.length}</div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Medical Support</div>
            <div
              className={`metric-value ${
                hasMedicalSupport ? "safe-text" : "warn-text"
              }`}
            >
              {hasMedicalSupport ? "Ready" : "No Medic"}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Evac Support</div>
            <div
              className={`metric-value ${
                hasEvacSupport ? "safe-text" : "warn-text"
              }`}
            >
              {hasEvacSupport ? "Ready" : "Missing"}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">With Contact Details</div>
            <div
              className={`metric-value ${
                rescueTeam.length > 0 && contactCount === rescueTeam.length
                  ? "safe-text"
                  : "warn-text"
              }`}
            >
              {contactCount}/{rescueTeam.length}
            </div>
          </div>
        </div>
      </aside>

      {showForm && (
        <div className="detail-modal-overlay" onClick={resetForm}>
          <div
            className="rescue-form-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close-btn"
              onClick={resetForm}
              aria-label="Close form"
            >
              ×
            </button>

            <div className="detail-title">
              {editingId ? "Edit Personnel" : "Add Personnel"}
            </div>

            <div className="detail-subtitle">
              Maintain emergency response team details.
            </div>

            <form
              onSubmit={handleAddPerson}
              className="rescue-form rescue-form-grid"
            >
              <input
                type="text"
                name="name"
                placeholder="Full Name"
                className="styled-input"
                value={formData.name}
                onChange={handleInputChange}
                required
              />

              <select
                name="role"
                className="styled-input"
                value={formData.role}
                onChange={handleInputChange}
                required
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>

              <input
                type="text"
                name="dept"
                placeholder="Department"
                className="styled-input"
                value={formData.dept}
                onChange={handleInputChange}
              />

              <input
                type="tel"
                name="phone"
                placeholder="Phone"
                className="styled-input"
                value={formData.phone}
                onChange={handleInputChange}
              />

              <input
                type="email"
                name="email"
                placeholder="Email"
                className="styled-input"
                value={formData.email}
                onChange={handleInputChange}
              />

              <div className="time-inputs">
                <div className="time-field">
                  <label>From</label>
                  <input
                    type="time"
                    name="timeIn"
                    className="styled-input"
                    value={formData.timeIn}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="time-field">
                  <label>Until</label>
                  <input
                    type="time"
                    name="timeOut"
                    className="styled-input"
                    value={formData.timeOut}
                    onChange={handleInputChange}
                  />
                </div>
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="styled-input"
                style={{ height: "auto", cursor: "pointer" }}
              />

              {formData.img && (
                <img
                  src={formData.img}
                  alt="Preview"
                  className="image-preview"
                />
              )}

              <button type="submit" className="primary-action-btn">
                {editingId ? "Update Member" : "Add to Team"}
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

            <div className="detail-header">
              <img
                src={selectedPerson.img || "/default-avatar.jpg"}
                alt={selectedPerson.name}
                className="detail-avatar"
              />

              <div>
                <div className="detail-title">{selectedPerson.name}</div>
                <div className="detail-subtitle">{selectedPerson.role}</div>
              </div>
            </div>

            <div className="detail-meta-row">
              <span className="detail-badge">{selectedPerson.dept}</span>

              <span className="detail-time-chip">
                {selectedPerson.timeIn && selectedPerson.timeOut
                  ? `${selectedPerson.timeIn} - ${selectedPerson.timeOut}`
                  : selectedPerson.time}
              </span>
            </div>

            <div className="detail-list">
              <div>
                <div className="detail-label">Email</div>
                <div>{selectedPerson.email || "—"}</div>
              </div>

              <div>
                <div className="detail-label">Phone</div>
                <div>{selectedPerson.phone || "—"}</div>
              </div>

              <div>
                <div className="detail-label">Department</div>
                <div>{selectedPerson.dept || "—"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}