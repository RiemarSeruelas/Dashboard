import { useEffect } from "react";
import AppShell from "../components/Appshell";
import { useDashboardStore } from "../store/useDashboardStore";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

function normalizePerson(person, index = 0) {
  return {
    id:
      person?.id ??
      person?.person_key ??
      person?.l_uid ??
      person?.L_UID ??
      `person-${index + 1}`,
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

export default function HistoryPage() {
  const history = useDashboardStore((s) => s.history) ?? [];
  const resetDashboard = useDashboardStore((s) => s.resetDashboard);
  const fetchHistory = useDashboardStore((s) => s.fetchHistory);
  const fetchSessionDetails = useDashboardStore((s) => s.fetchSessionDetails);
  const emergencyActive = useDashboardStore((s) => s.emergencyActive);
  const triggerEmergency = useDashboardStore((s) => s.triggerEmergency);
  const clearEmergency = useDashboardStore((s) => s.clearEmergency);
  const emergencyActionLoading = useDashboardStore((s) => s.emergencyActionLoading);

  useEffect(() => {
    fetchHistory?.();
  }, [fetchHistory]);

  async function downloadIncidentExcel(eventItem) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Emergency Report");

    worksheet.getColumn(1).width = 16;
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 40;
    worksheet.getColumn(5).width = 20;

    worksheet.mergeCells("A1:D1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "EMERGENCY REPORT";
    titleCell.font = {
      name: "Arial",
      bold: true,
      size: 18,
      color: { argb: "FFFFFFFF" },
    };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEF4444" },
    };
    worksheet.getRow(1).height = 28;

    worksheet.mergeCells("A2:D2");
    const dateCell = worksheet.getCell("A2");
    dateCell.value = `Date: ${eventItem?.timestamp ?? "Unknown"}`;
    dateCell.font = { italic: true, size: 11 };
    dateCell.alignment = { horizontal: "center", vertical: "middle" };

    worksheet.mergeCells("A3:D3");
    const durationCell = worksheet.getCell("A3");
    durationCell.value = `Duration: ${eventItem?.duration ?? "Unknown"}`;
    durationCell.font = { italic: true, size: 11 };
    durationCell.alignment = { horizontal: "center", vertical: "middle" };

    worksheet.mergeCells("A4:D4");
    const summaryCell = worksheet.getCell("A4");
    summaryCell.value = `Safe: ${eventItem?.safe ?? 0} | Not Safe: ${eventItem?.notSafe ?? 0}`;
    summaryCell.font = { italic: true, size: 11 };
    summaryCell.alignment = { horizontal: "center", vertical: "middle" };

    worksheet.addRow([]);

    const headerRow = worksheet.addRow([
      "ID",
      "Name",
      "Department",
      "Status",
    ]);

    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };

    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFBFC7D5" } },
        left: { style: "thin", color: { argb: "FFBFC7D5" } },
        bottom: { style: "thin", color: { argb: "FFBFC7D5" } },
        right: { style: "thin", color: { argb: "FFBFC7D5" } },
      };
    });

    let rawRows =
      eventItem?.personnelSnapshot ??
      eventItem?.snapshot ??
      eventItem?.personnel ??
      [];

    if ((!Array.isArray(rawRows) || rawRows.length === 0) && eventItem?.id != null) {
      try {
        rawRows = await fetchSessionDetails?.(eventItem.id);
      } catch (err) {
        console.error("❌ DOWNLOAD SESSION DETAILS ERROR:", err);
        rawRows = [];
      }
    }

    const rows = Array.isArray(rawRows)
      ? rawRows.map((person, index) => normalizePerson(person, index))
      : [];

    if (rows.length === 0) {
      const emptyRow = worksheet.addRow([
        "",
        "No personnel snapshot saved for this event",
        "",
        "",
      ]);

      emptyRow.getCell(2).font = {
        italic: true,
        color: { argb: "FF6B7280" },
      };
    } else {
      rows.forEach((person) => {
        const row = worksheet.addRow([
          person.id,
          person.name,
          person.dept,
          person.status === "SAFE" ? "SAFE" : "NOT SAFE",
        ]);

        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFD9E1F2" } },
            left: { style: "thin", color: { argb: "FFD9E1F2" } },
            bottom: { style: "thin", color: { argb: "FFD9E1F2" } },
            right: { style: "thin", color: { argb: "FFD9E1F2" } },
          };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });

        const statusCell = row.getCell(4);

        if (person.status === "SAFE") {
          statusCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF10B981" },
          };
          statusCell.font = {
            color: { argb: "FFFFFFFF" },
            bold: true,
          };
        } else {
          statusCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEF4444" },
          };
          statusCell.font = {
            color: { argb: "FFFFFFFF" },
            bold: true,
          };
        }
      });
    }

    worksheet.views = [{ state: "frozen", ySplit: 6 }];

    const safeTimestamp = String(eventItem?.timestamp ?? "unknown")
      .replace(/[/:,\s]/g, "-")
      .replace(/-+/g, "-");

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    saveAs(blob, `Emergency_Report_${safeTimestamp}.xlsx`);
  }

  const avgSafe =
    history.length > 0
      ? Math.round(
          history.reduce((a, b) => a + (Number(b?.safe) || 0), 0) / history.length
        )
      : 0;

  const avgNotSafe =
    history.length > 0
      ? Math.round(
          history.reduce((a, b) => a + (Number(b?.notSafe) || 0), 0) / history.length
        )
      : 0;

  return (
    <AppShell
      title="Emergency Event Logs"
      subtitle="Historical incident records, duration tracking, and export-ready summaries"
      summaryStats={[
        { value: history.length, label: "TOTAL EVENTS" },
        { value: avgSafe, label: "AVG SAFE", variant: "green" },
        { value: avgNotSafe, label: "AVG NOT SAFE", variant: "red" },
        { value: "DB", label: "STORAGE", variant: "amber" },
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
        <div className="panel-title">History Controls</div>

        <div className="mini-info-card">
          <div className="mini-info-title">How it works</div>
          <div className="mini-info-text">
            Click any incident row to download its Excel report.
          </div>
        </div>
      </aside>

      <section className="panel center-panel">
        <div className="table-card">
          <div className="table-title">Incident History</div>

          <div className="history-table history-table-single">
            {history.length > 0 ? (
              history.map((item) => (
                <div
                  className="history-row history-row-clickable history-card"
                  key={item?.id}
                  onClick={() => downloadIncidentExcel(item)}
                  title="Click to download Excel report"
                >
                  <div className="history-card-group">
                    <div className="history-card-label">Timestamp</div>
                    <div className="history-card-value">
                      {item?.timestamp
                        ? new Date(item.timestamp).toLocaleString("en-PH", {
                            timeZone: "Asia/Manila",
                            dateStyle: "medium",
                            timeStyle: "medium",
                          })
                        : "Unknown"}
                    </div>
                  </div>

                  <div className="history-card-group">
                    <div className="history-card-label">Duration</div>
                    <div className="history-card-value">
                      {item?.duration ?? "Unknown"}
                    </div>
                  </div>

                  <div className="history-card-group">
                    <div className="history-card-label">Safe</div>
                    <div className="history-card-value">{item?.safe ?? 0}</div>
                  </div>

                  <div className="history-card-group">
                    <div className="history-card-label">Not Safe</div>
                    <div className="history-card-value">
                      {item?.notSafe ?? 0}
                    </div>
                  </div>

                  <div className="history-card-export">
                    <span className="status-chip done">Excel</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="metric-card">
                <div className="metric-label">No incidents yet</div>
                <div className="metric-value">
                  Trigger and end an emergency first
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="panel right-panel">
        <div className="panel-title">Latest Snapshot</div>

        <div className="metric-stack">
          {history[0] ? (
            <>
              <div className="metric-card">
                <div className="metric-label">Timestamp</div>
                <div className="metric-value" style={{ fontSize: 18 }}>
                  {history[0]?.timestamp ?? "Unknown"}
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Duration</div>
                <div className="metric-value">
                  {history[0]?.duration ?? "Unknown"}
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Export</div>
                <button
                  className="primary-action-btn"
                  onClick={() => downloadIncidentExcel(history[0])}
                >
                  Download Latest
                </button>
              </div>
            </>
          ) : (
            <div className="metric-card">
              <div className="metric-label">Status</div>
              <div className="metric-value warn-text">No Saved Event</div>
            </div>
          )}
        </div>
      </aside>
    </AppShell>
  );
}