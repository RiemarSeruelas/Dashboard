import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const normalPersonnelCache = new Map();
const CACHE_TTL_MS = 10000;

const { Pool } = pg;
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "dist")));

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

let emergencyActiveState = false;
let musteringSyncInFlight = false;
let lastMusteringSyncAt = 0;
const MUSTERING_SYNC_COOLDOWN_MS = 15000;

function buildNormalCacheKey({ date, search, dept, offset, limit }) {
  return JSON.stringify({
    date: date || "",
    search: search || "",
    dept: dept || "",
    offset: Number(offset) || 0,
    limit: Number(limit) || 20,
  });
}

function getCachedNormalPayload(key, latestDbSignature) {
  const cached = normalPersonnelCache.get(key);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;

  if (age > CACHE_TTL_MS) {
    normalPersonnelCache.delete(key);
    return null;
  }

  if (cached.latestDbSignature !== latestDbSignature) {
    normalPersonnelCache.delete(key);
    return null;
  }

  return cached.payload;
}

function setCachedNormalPayload(key, payload, latestDbSignature) {
  normalPersonnelCache.set(key, {
    timestamp: Date.now(),
    latestDbSignature,
    payload,
  });
}

function clearNormalPersonnelCache() {
  normalPersonnelCache.clear();
}

// --------------------------------------------
// DB INIT
// --------------------------------------------
async function initDb() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS app;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.rescue_team (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      dept TEXT NOT NULL DEFAULT 'EMERGENCY',
      phone TEXT,
      email TEXT,
      time_in TEXT,
      time_out TEXT,
      img TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila'),
      updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila')
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.emergency_sessions (
      id BIGSERIAL PRIMARY KEY,
      session_key TEXT NOT NULL UNIQUE,
      started_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila'),
      ended_at TIMESTAMP NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      source TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila'),
      updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila')
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.emergency_accountability (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES app.emergency_sessions(id) ON DELETE CASCADE,
      person_key TEXT NOT NULL,
      l_uid TEXT,
      person TEXT NOT NULL,
      persongroup TEXT,
      initial_mode TEXT,
      initial_tid TEXT,
      current_status TEXT NOT NULL DEFAULT 'NOT SAFE',
      marked_safe_at TIMESTAMP NULL,
      marked_safe_by TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila'),
      updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila'),
      CONSTRAINT uq_emergency_accountability_session_person UNIQUE (session_id, person_key)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.evacuation_maps (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      image_data TEXT NOT NULL,
      mime_type TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      uploaded_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila'),
      updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Manila')
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_emergency_sessions_active
    ON app.emergency_sessions (is_active, started_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_emergency_sessions_started_at
    ON app.emergency_sessions (started_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_emergency_accountability_session
    ON app.emergency_accountability (session_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_emergency_accountability_status
    ON app.emergency_accountability (session_id, current_status);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_evacuation_maps_active_created
    ON app.evacuation_maps (is_active, created_at DESC);
  `);
}

// --------------------------------------------
// HELPERS
// --------------------------------------------
function getTodayManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getManilaNowSqlString() {
  const now = new Date();
  const manila = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Manila" })
  );

  const yyyy = manila.getFullYear();
  const mm = String(manila.getMonth() + 1).padStart(2, "0");
  const dd = String(manila.getDate()).padStart(2, "0");
  const hh = String(manila.getHours()).padStart(2, "0");
  const mi = String(manila.getMinutes()).padStart(2, "0");
  const ss = String(manila.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parsePaging(req) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  return { limit, offset };
}

function normalizeNameTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function buildPersonKey(name) {
  return normalizeNameTokens(name).sort().join(" ");
}

function searchMatchesName(name, search) {
  const rawName = String(name || "");
  const rawSearch = String(search || "").trim().toLowerCase();

  if (!rawSearch) return true;

  if (rawName.toLowerCase().includes(rawSearch)) {
    return true;
  }

  const personTokens = normalizeNameTokens(rawName);
  const searchTokens = normalizeNameTokens(rawSearch);

  if (!searchTokens.length) return true;

  const personSet = new Set(personTokens);

  return searchTokens.every((token) => personSet.has(token));
}

function dedupeRowsByCanonicalName(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const personKey = buildPersonKey(row?.Person);
    if (!personKey) continue;

    if (!map.has(personKey)) {
      map.set(personKey, {
        ...row,
        person_key: personKey,
      });
    }
  }

  return Array.from(map.values());
}

async function createNewEmergencySession() {
  const nowManila = getManilaNowSqlString();

  await pool.query(
    `
    UPDATE app.emergency_sessions
    SET
      is_active = FALSE,
      ended_at = COALESCE(ended_at, $1::timestamp),
      updated_at = $1::timestamp
    WHERE is_active = TRUE
  `,
    [nowManila]
  );

  const createResult = await pool.query(
    `
    INSERT INTO app.emergency_sessions (
      session_key,
      started_at,
      is_active,
      source,
      created_at,
      updated_at
    )
    VALUES (
      'EMG-' || to_char($1::timestamp, 'YYYYMMDD-HH24MISS'),
      $1::timestamp,
      TRUE,
      'system',
      $1::timestamp,
      $1::timestamp
    )
    RETURNING id, session_key, started_at, is_active
  `,
    [nowManila]
  );

  return createResult.rows[0];
}

async function getActiveSession() {
  const result = await pool.query(`
    SELECT id, session_key, started_at, ended_at, is_active
    FROM app.emergency_sessions
    WHERE is_active = TRUE
    ORDER BY started_at DESC
    LIMIT 1
  `);

  return result.rows[0] || null;
}

// --------------------------------------------
// RESCUE TEAM ROUTES
// --------------------------------------------
app.get("/api/rescue-team", async (req, res) => {
  try {
    const { search, role } = req.query;

    let whereClause = "WHERE is_active = TRUE";
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      whereClause += ` AND (
        name ILIKE $${params.length}
        OR role ILIKE $${params.length}
        OR dept ILIKE $${params.length}
      )`;
    }

    if (role && role.trim() && role !== "ALL") {
      params.push(role.trim());
      whereClause += ` AND role = $${params.length}`;
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        role,
        dept,
        phone,
        email,
        time_in,
        time_out,
        img,
        is_active,
        created_at,
        updated_at
      FROM app.rescue_team
      ${whereClause}
      ORDER BY name ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ RESCUE TEAM GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/rescue-team", async (req, res) => {
  try {
    const { name, role, dept, phone, email, timeIn, timeOut, img } = req.body;

    if (!name || !role) {
      return res.status(400).json({ error: "name and role are required" });
    }

    const result = await pool.query(
      `
      INSERT INTO app.rescue_team (
        name,
        role,
        dept,
        phone,
        email,
        time_in,
        time_out,
        img,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, (NOW() AT TIME ZONE 'Asia/Manila'), (NOW() AT TIME ZONE 'Asia/Manila'))
      RETURNING
        id,
        name,
        role,
        dept,
        phone,
        email,
        time_in,
        time_out,
        img,
        is_active,
        created_at,
        updated_at
    `,
      [
        String(name).trim(),
        String(role).trim(),
        dept ? String(dept).trim() : "EMERGENCY",
        phone ? String(phone).trim() : null,
        email ? String(email).trim() : null,
        timeIn ? String(timeIn).trim() : null,
        timeOut ? String(timeOut).trim() : null,
        img || null,
      ]
    );

    res.json({
      success: true,
      member: result.rows[0],
    });
  } catch (err) {
    console.error("❌ RESCUE TEAM CREATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/rescue-team/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      role,
      dept,
      phone,
      email,
      timeIn,
      timeOut,
      img,
      isActive,
    } = req.body;

    const result = await pool.query(
      `
      UPDATE app.rescue_team
      SET
        name = COALESCE($2, name),
        role = COALESCE($3, role),
        dept = COALESCE($4, dept),
        phone = $5,
        email = $6,
        time_in = $7,
        time_out = $8,
        img = $9,
        is_active = COALESCE($10, is_active),
        updated_at = (NOW() AT TIME ZONE 'Asia/Manila')
      WHERE id = $1
      RETURNING
        id,
        name,
        role,
        dept,
        phone,
        email,
        time_in,
        time_out,
        img,
        is_active,
        created_at,
        updated_at
    `,
      [
        id,
        name ? String(name).trim() : null,
        role ? String(role).trim() : null,
        dept ? String(dept).trim() : null,
        phone ? String(phone).trim() : null,
        email ? String(email).trim() : null,
        timeIn ? String(timeIn).trim() : null,
        timeOut ? String(timeOut).trim() : null,
        img || null,
        typeof isActive === "boolean" ? isActive : null,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rescue member not found" });
    }

    res.json({
      success: true,
      member: result.rows[0],
    });
  } catch (err) {
    console.error("❌ RESCUE TEAM UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/rescue-team/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE app.rescue_team
      SET
        is_active = FALSE,
        updated_at = (NOW() AT TIME ZONE 'Asia/Manila')
      WHERE id = $1
      RETURNING id
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rescue member not found" });
    }

    res.json({
      success: true,
      removedId: result.rows[0].id,
    });
  } catch (err) {
    console.error("❌ RESCUE TEAM DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// MAP ROUTES
// --------------------------------------------
async function getLatestNormalDbSignature(targetDate) {
  const result = await pool.query(
    `
    SELECT
      COALESCE(MAX(("C_Date"::text || ' ' || "C_Time"::text)), '') AS latest_signature
    FROM "hkvision"."tbhikvision"
    WHERE "C_Date" = $1
      AND "L_TID" = '1'
      AND LOWER(TRIM("L_Mode")) IN (
        'flane 1 entrance',
        'flane 2 entrance'
      )
      AND COALESCE(TRIM("Person"), '') <> ''
    `,
    [targetDate]
  );

  return result.rows[0]?.latest_signature || "";
}


// --------------------------------------------
// NORMAL MODE: paginated live entrance population
// --------------------------------------------
app.get("/api/hikvision-normal", async (req, res) => {
  try {
    const dateParam = req.query.date;
    const targetDate = dateParam || getTodayManila();
    const { limit, offset } = parsePaging(req);
    const search = (req.query.search || "").trim();
    const dept = (req.query.dept || "").trim();

    const cacheKey = buildNormalCacheKey({
      date: targetDate,
      search,
      dept,
      offset,
      limit,
    });

    const latestDbSignature = await getLatestNormalDbSignature(targetDate);

const cachedPayload = getCachedNormalPayload(cacheKey, latestDbSignature);

if (cachedPayload) {
  return res.json({
    ...cachedPayload,
    source: "cache",
    latestDbSignature,
  });
}

    const rawResult = await pool.query(
      `
      SELECT
        "CardNo",
        "L_UID",
        "Person",
        "PersonGroup",
        "L_Mode",
        "L_TID",
        "C_Date",
        "C_Time"
      FROM "hkvision"."tbhikvision"
      WHERE "C_Date" = $1
        AND "L_TID" = '1'
        AND LOWER(TRIM("L_Mode")) IN (
          'flane 1 entrance',
          'flane 2 entrance'
        )
        AND COALESCE(TRIM("Person"), '') <> ''
      ORDER BY "C_Time" DESC
      `,
      [targetDate]
    );

    let rows = dedupeRowsByCanonicalName(rawResult.rows);

    if (search) {
      rows = rows.filter((row) => searchMatchesName(row?.Person, search));
    }

    if (dept && dept !== "ALL") {
      rows = rows.filter((row) => String(row?.PersonGroup || "") === dept);
    }

    rows.sort((a, b) =>
      String(a?.Person || "").localeCompare(String(b?.Person || ""))
    );

    const total = rows.length;
    const pagedRows = rows.slice(offset, offset + limit);

    const payload = {
      rows: pagedRows,
      total,
      limit,
      offset,
      hasMore: offset + pagedRows.length < total,
    };

    setCachedNormalPayload(cacheKey, payload, latestDbSignature);

res.json({
  ...payload,
  source: "database",
  latestDbSignature,
});
  } catch (err) {
    console.error("❌ NORMAL GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// SNAPSHOT CURRENT PERSONNEL INTO SESSION
// --------------------------------------------
async function snapshotCurrentPersonnelToSession(sessionId) {
  const todayManila = getTodayManila();

  const rawResult = await pool.query(
    `
    SELECT
      "L_UID",
      "Person",
      "PersonGroup",
      "L_Mode",
      "L_TID",
      "C_Date",
      "C_Time"
    FROM "hkvision"."tbhikvision"
    WHERE "C_Date" = $1
      AND "L_TID" = '1'
      AND LOWER(TRIM("L_Mode")) IN (
        'flane 1 entrance',
        'flane 2 entrance'
      )
      AND COALESCE(TRIM("Person"), '') <> ''
    ORDER BY "C_Time" DESC
    `,
    [todayManila]
  );

  const dedupedRows = dedupeRowsByCanonicalName(rawResult.rows);
  let insertedCount = 0;

  for (const row of dedupedRows) {
    const insertResult = await pool.query(
      `
      INSERT INTO app.emergency_accountability (
        session_id,
        person_key,
        l_uid,
        person,
        persongroup,
        initial_mode,
        initial_tid,
        current_status,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'NOT SAFE',
        (NOW() AT TIME ZONE 'Asia/Manila'),
        (NOW() AT TIME ZONE 'Asia/Manila')
      )
      ON CONFLICT (session_id, person_key) DO NOTHING
      `,
      [
        sessionId,
        row.person_key,
        row.L_UID || null,
        row.Person || "Unknown",
        row.PersonGroup || null,
        row.L_Mode || null,
        row.L_TID || null,
      ]
    );

    insertedCount += insertResult.rowCount;
  }

  return insertedCount;
}

// --------------------------------------------
// TEMP emergency controls
// --------------------------------------------
app.post("/api/emergency/start", async (req, res) => {
  try {
    emergencyActiveState = true;

    const session = await createNewEmergencySession();
    const insertedCount = await snapshotCurrentPersonnelToSession(session.id);

    clearNormalPersonnelCache();

    res.json({
      emergencyActive: true,
      activeSession: session,
      snapshotInserted: insertedCount,
    });
  } catch (err) {
    console.error("❌ START EMERGENCY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/emergency/stop", async (req, res) => {
  try {
    emergencyActiveState = false;
    const nowManila = getManilaNowSqlString();

    const result = await pool.query(
      `
      UPDATE app.emergency_sessions
      SET
        is_active = FALSE,
        ended_at = $1::timestamp,
        updated_at = $1::timestamp
      WHERE id = (
        SELECT id
        FROM app.emergency_sessions
        WHERE is_active = TRUE
        ORDER BY started_at DESC
        LIMIT 1
      )
      RETURNING *
    `,
      [nowManila]
    );

    clearNormalPersonnelCache();

    res.json({
      emergencyActive: false,
      endedSession: result.rows[0] || null,
    });
  } catch (err) {
    console.error("❌ STOP EMERGENCY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// EMERGENCY STATUS
// --------------------------------------------
app.get("/api/emergency-status", async (req, res) => {
  try {
    const session = await getActiveSession();

    if (!session) {
      emergencyActiveState = false;
      return res.json({
        emergencyActive: false,
        activeSession: null,
      });
    }

    emergencyActiveState = true;

    res.json({
      emergencyActive: true,
      activeSession: session,
    });
  } catch (err) {
    console.error("❌ EMERGENCY STATUS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// ACTIVE EMERGENCY ACCOUNTABILITY (paginated)
// --------------------------------------------
app.get("/api/emergency-accountability", async (req, res) => {
  try {
    const session = await getActiveSession();

    if (!session) {
      return res.json({
        rows: [],
        total: 0,
        safeCount: 0,
        notSafeCount: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      });
    }

    const { limit, offset } = parsePaging(req);
    const search = (req.query.search || "").trim();
    const dept = (req.query.dept || "").trim();

    const result = await pool.query(
      `
      SELECT
        id,
        session_id,
        person_key,
        l_uid,
        person,
        persongroup,
        initial_mode,
        initial_tid,
        current_status,
        marked_safe_at,
        marked_safe_by,
        created_at,
        updated_at
      FROM app.emergency_accountability
      WHERE session_id = $1
      ORDER BY person ASC
      `,
      [session.id]
    );

    let rows = result.rows;

    if (search) {
      rows = rows.filter((row) => searchMatchesName(row?.person, search));
    }

    if (dept && dept !== "ALL") {
      rows = rows.filter((row) => String(row?.persongroup || "") === dept);
    }

    rows.sort((a, b) =>
      String(a?.person || "").localeCompare(String(b?.person || ""))
    );

    const total = rows.length;
    const safeCount = rows.filter((row) => row.current_status === "SAFE").length;
    const notSafeCount = rows.filter((row) => row.current_status !== "SAFE").length;
    const pagedRows = rows.slice(offset, offset + limit);

    res.json({
      rows: pagedRows,
      total,
      safeCount,
      notSafeCount,
      limit,
      offset,
      hasMore: offset + pagedRows.length < total,
    });
  } catch (err) {
    console.error("❌ EMERGENCY ACCOUNTABILITY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// MARK SAFE
// --------------------------------------------
app.post("/api/emergency/mark-safe", async (req, res) => {
  try {
    const { personKey, markedBy } = req.body;

    if (!personKey) {
      return res.status(400).json({ error: "personKey is required" });
    }

    const session = await getActiveSession();

    if (!session) {
      return res.status(400).json({ error: "No active emergency session" });
    }

    const updateResult = await pool.query(
      `
      UPDATE app.emergency_accountability
      SET
        current_status = 'SAFE',
        marked_safe_at = (NOW() AT TIME ZONE 'Asia/Manila'),
        marked_safe_by = $2,
        updated_at = (NOW() AT TIME ZONE 'Asia/Manila')
      WHERE session_id = $1
        AND person_key = $3
      RETURNING *
    `,
      [session.id, markedBy || "system", personKey]
    );

    res.json({
      success: true,
      updated: updateResult.rows[0] || null,
    });
  } catch (err) {
    console.error("❌ MARK SAFE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/emergency/update-status", async (req, res) => {
  try {
    const { personKey, status, markedBy } = req.body;

    if (!personKey) {
      return res.status(400).json({ error: "personKey is required" });
    }

    const normalizedStatus = status === "SAFE" ? "SAFE" : "NOT SAFE";

    const session = await getActiveSession();

    if (!session) {
      return res.status(400).json({ error: "No active emergency session" });
    }

    const updateResult = await pool.query(
      `
      UPDATE app.emergency_accountability
      SET
        current_status = $4,
        marked_safe_at = CASE
          WHEN $4 = 'SAFE' THEN (NOW() AT TIME ZONE 'Asia/Manila')
          ELSE NULL
        END,
        marked_safe_by = CASE
          WHEN $4 = 'SAFE' THEN $2
          ELSE NULL
        END,
        updated_at = (NOW() AT TIME ZONE 'Asia/Manila')
      WHERE session_id = $1
        AND person_key = $3
      RETURNING *
      `,
      [session.id, markedBy || "operator", personKey, normalizedStatus]
    );

    res.json({
      success: true,
      updated: updateResult.rows[0] || null,
    });
  } catch (err) {
    console.error("❌ UPDATE STATUS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// HISTORY: paginated sessions only
// --------------------------------------------
app.get("/api/emergency/history", async (req, res) => {
  try {
    const { limit, offset } = parsePaging(req);

    const result = await pool.query(
      `
      WITH base AS (
        SELECT
          es.id,
          es.session_key,
          es.started_at,
          es.ended_at,
          es.is_active,
          COALESCE(COUNT(ea.id), 0) AS total_people,
          COALESCE(SUM(CASE WHEN ea.current_status = 'SAFE' THEN 1 ELSE 0 END), 0) AS safe_count,
          COALESCE(SUM(CASE WHEN ea.current_status <> 'SAFE' THEN 1 ELSE 0 END), 0) AS not_safe_count
        FROM app.emergency_sessions es
        LEFT JOIN app.emergency_accountability ea
          ON es.id = ea.session_id
        GROUP BY es.id, es.session_key, es.started_at, es.ended_at, es.is_active
      ),
      counted AS (
        SELECT
          *,
          COUNT(*) OVER() AS total_count
        FROM base
      )
      SELECT *
      FROM counted
      ORDER BY started_at DESC
      LIMIT $1 OFFSET $2
    `,
      [limit, offset]
    );

    const rows = result.rows;
    const total = rows.length > 0 ? Number(rows[0].total_count) || 0 : 0;

    res.json({
      rows: rows.map(({ total_count, ...rest }) => rest),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    });
  } catch (err) {
    console.error("❌ HISTORY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// HISTORY DETAILS: one session's saved people
// --------------------------------------------
app.get("/api/emergency/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        session_id,
        person_key,
        l_uid,
        person,
        persongroup,
        initial_mode,
        initial_tid,
        current_status,
        marked_safe_at,
        marked_safe_by,
        created_at,
        updated_at
      FROM app.emergency_accountability
      WHERE session_id = $1
      ORDER BY person ASC
    `,
      [sessionId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ HISTORY DETAILS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------
// ANALYTICS: one session grouped by department
// --------------------------------------------
app.get("/api/emergency/analytics/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await pool.query(
      `
      SELECT
        persongroup,
        COUNT(*) AS total_people,
        COALESCE(SUM(CASE WHEN current_status = 'SAFE' THEN 1 ELSE 0 END), 0) AS safe_count,
        COALESCE(SUM(CASE WHEN current_status <> 'SAFE' THEN 1 ELSE 0 END), 0) AS not_safe_count,
        ROUND(
          100.0 * COALESCE(SUM(CASE WHEN current_status = 'SAFE' THEN 1 ELSE 0 END), 0) / NULLIF(COUNT(*), 0),
          2
        ) AS safe_percent
      FROM app.emergency_accountability
      WHERE session_id = $1
      GROUP BY persongroup
      ORDER BY safe_percent ASC, persongroup ASC
    `,
      [sessionId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ ANALYTICS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function syncMusteringScansToActiveSession() {
  const session = await getActiveSession();

  if (!session) {
    return {
      success: true,
      updatedCount: 0,
      updatedRows: [],
      message: "No active emergency session",
    };
  }

  const todayManila = getTodayManila();

 const musterResult = await pool.query(
  `
  SELECT
    h."L_UID",
    h."Person",
    h."PersonGroup",
    h."L_Mode",
    h."L_TID",
    h."C_Date",
    h."C_Time"
  FROM "hkvision"."tbhikvision" h
  JOIN app.emergency_sessions es
    ON es.id = $1
  WHERE (h."C_Date"::date + h."C_Time"::time) >= (es.started_at - INTERVAL '15 minutes')
    AND h."L_TID" = '1'
    AND LOWER(TRIM(h."L_Mode")) IN (
      'engineering mustering area',
      'savory mustering area',
      'savoury mustering area'
    )
    AND COALESCE(TRIM(h."Person"), '') <> ''
  ORDER BY h."C_Date" DESC, h."C_Time" DESC
  `,
  [session.id]
);

  const dedupedMap = new Map();

  for (const row of musterResult.rows) {
    const uidKey = String(row?.L_UID || "").trim();
    const nameKey = buildPersonKey(row?.Person);
    const key = uidKey || nameKey;

    if (!key) continue;

    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, {
        ...row,
        person_key: nameKey,
        l_uid_clean: uidKey || null,
      });
    }
  }

  const updatedRows = [];

  for (const row of dedupedMap.values()) {
    const result = await pool.query(
      `
      UPDATE app.emergency_accountability
      SET
        current_status = 'SAFE',
        marked_safe_at = (NOW() AT TIME ZONE 'Asia/Manila'),
        marked_safe_by = 'scanner',
        updated_at = (NOW() AT TIME ZONE 'Asia/Manila')
      WHERE session_id = $1
        AND current_status <> 'SAFE'
        AND (
          ($2::text IS NOT NULL AND TRIM(COALESCE(l_uid, '')) = TRIM($2::text))
          OR
          (COALESCE($3::text, '') <> '' AND person_key = $3::text)
        )
      RETURNING
        id,
        session_id,
        person,
        l_uid,
        person_key,
        current_status,
        marked_safe_at,
        marked_safe_by
      `,
      [session.id, row.l_uid_clean, row.person_key]
    );

    updatedRows.push(...result.rows);
  }

  return {
    success: true,
    updatedCount: updatedRows.length,
    updatedRows,
    sessionId: session.id,
  };
}

app.post("/api/emergency/sync-mustering", async (req, res) => {
  try {
    const now = Date.now();

    if (musteringSyncInFlight) {
      return res.json({
        success: true,
        skipped: true,
        reason: "sync already in progress",
      });
    }

    if (now - lastMusteringSyncAt < MUSTERING_SYNC_COOLDOWN_MS) {
      return res.json({
        success: true,
        skipped: true,
        reason: "sync cooldown active",
      });
    }

    musteringSyncInFlight = true;

    const result = await syncMusteringScansToActiveSession();

    lastMusteringSyncAt = Date.now();

    res.json({
      ...result,
      skipped: false,
    });
  } catch (err) {
    console.error("❌ MUSTERING SYNC ERROR:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    musteringSyncInFlight = false;
  }
});

app.post("/api/auth/passcode", (req, res) => {
  const { passcode } = req.body;

  if (!process.env.APP_PASSCODE) {
    return res.status(500).json({ error: "APP_PASSCODE is not configured" });
  }

  if (passcode !== process.env.APP_PASSCODE) {
    return res.status(401).json({ error: "Invalid passcode" });
  }

  res.json({
    success: true,
    token: "passcode-ok",
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();

  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// --------------------------------------------
// START SERVER
// --------------------------------------------
initDb()
  .then(() => {
    app.listen(5000, () => {
      console.log("🚀 Backend running on http://localhost:5000");
    });
  })
  .catch((err) => {
    console.error("❌ DB INIT ERROR:", err.message);
    process.exit(1);
  });
