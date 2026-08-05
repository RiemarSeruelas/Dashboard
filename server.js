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
const APP_PASSWORD = process.env.APP_PASSWORD?.trim() ?? "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

let musteringSyncInFlight = false;
let lastMusteringSyncAt = 0;
const MUSTERING_SYNC_COOLDOWN_MS = 15000;
const EMERGENCY_SCHEDULE_FALLBACK_POLL_MS = Math.max(
  Number(process.env.EMERGENCY_SCHEDULE_POLL_MS) || 15000,
  1000,
);
let scheduleProcessing = false;
let scheduleTimer = null;
let emergencyStartInFlight = null;

function getSchedulerNowIso() {
  return new Date().toISOString();
}

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

function logServerError(context, error) {
  const code = String(error?.code || "UNKNOWN")
    .replace(/[^A-Z0-9_-]/gi, "")
    .slice(0, 40);

  console.error(`[server] ${context} failed (${code || "UNKNOWN"}).`);
}

function sendInternalError(res, context, error, extra = {}) {
  logServerError(context, error);
  return res.status(500).json({
    ...extra,
    error: "Internal server error",
  });
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
  ALTER TABLE app.rescue_team
  ADD COLUMN IF NOT EXISTS l_uid TEXT;
`);

  await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_rescue_team_l_uid
  ON app.rescue_team (l_uid);
`);

  // Create the database-level duplicate protection only after legacy
  // duplicates have been cleaned up. This never deletes data on startup.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM app.rescue_team
        WHERE NULLIF(TRIM(l_uid), '') IS NOT NULL
        GROUP BY TRIM(l_uid)
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rescue_team_l_uid_normalized
        ON app.rescue_team ((TRIM(l_uid)))
        WHERE NULLIF(TRIM(l_uid), '') IS NOT NULL;
      END IF;
    END
    $$;
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
    CREATE TABLE IF NOT EXISTS app.emergency_schedules (
      id BIGSERIAL PRIMARY KEY,
      scheduled_for TIMESTAMPTZ NOT NULL,
      scheduled_until TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'SCHEDULED'
        CHECK (
          status IN (
            'SCHEDULED',
            'STARTING',
            'STARTED',
            'STOPPING',
            'COMPLETED',
            'CANCELLED',
            'SKIPPED',
            'FAILED'
          )
        ),
      created_by TEXT NOT NULL DEFAULT 'operator',
      started_session_id BIGINT NULL
        REFERENCES app.emergency_sessions(id) ON DELETE SET NULL,
      result_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE app.emergency_schedules
    ADD COLUMN IF NOT EXISTS scheduled_until TIMESTAMPTZ;

    UPDATE app.emergency_schedules
    SET scheduled_until = scheduled_for + INTERVAL '1 hour'
    WHERE scheduled_until IS NULL;

    ALTER TABLE app.emergency_schedules
    ALTER COLUMN scheduled_until SET NOT NULL;

    ALTER TABLE app.emergency_schedules
    DROP CONSTRAINT IF EXISTS emergency_schedules_status_check;

    ALTER TABLE app.emergency_schedules
    ADD CONSTRAINT emergency_schedules_status_check
    CHECK (
      status IN (
        'SCHEDULED',
        'STARTING',
        'STARTED',
        'STOPPING',
        'COMPLETED',
        'CANCELLED',
        'SKIPPED',
        'FAILED'
      )
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app."Emergency-logs" (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      browser TEXT,
      operating_system TEXT,
      device_type TEXT,
      first_path TEXT,
      user_agent TEXT,
      opened_at TIMESTAMP NOT NULL
        DEFAULT (NOW() AT TIME ZONE 'Asia/Manila')
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_emergency_schedules_due
    ON app.emergency_schedules (status, scheduled_for);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_emergency_schedules_finish_due
    ON app.emergency_schedules (status, scheduled_until);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_emergency_logs_opened_at
    ON app."Emergency-logs" (opened_at DESC);
  `);
}

async function recoverInterruptedEmergencySchedules() {
  const schedulerNow = getSchedulerNowIso();

  await pool.query(
    `
      UPDATE app.emergency_schedules AS schedule
      SET
        status = 'STARTED',
        started_session_id = session.id,
        result_message = 'Recovered scheduled emergency after backend restart',
        updated_at = $1::timestamptz
      FROM app.emergency_sessions AS session
      WHERE schedule.status = 'STARTING'
        AND session.is_active = TRUE
        AND session.source = 'scheduled'
        AND session.notes = 'Started from schedule ' || schedule.id::text
    `,
    [schedulerNow],
  );

  await pool.query(
    `
      UPDATE app.emergency_schedules
      SET
        status = CASE
          WHEN scheduled_until <= $1::timestamptz THEN 'SKIPPED'
          ELSE 'SCHEDULED'
        END,
        result_message = CASE
          WHEN scheduled_until <= $1::timestamptz
            THEN 'Scheduled window ended while the backend was unavailable'
          ELSE 'Recovered and waiting to start'
        END,
        updated_at = $1::timestamptz
      WHERE status = 'STARTING'
    `,
    [schedulerNow],
  );

  await pool.query(
    `
      UPDATE app.emergency_schedules
      SET
        status = 'STARTED',
        result_message = 'Recovered automatic finish after backend restart',
        updated_at = $1::timestamptz
      WHERE status = 'STOPPING'
    `,
    [schedulerNow],
  );
}

// --------------------------------------------
// HELPERS
// --------------------------------------------
function getTodayManila() {
  const parts = new Intl.DateTimeFormat("en-US", {
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

function getManilaNowSqlString(value = new Date()) {
  const now = value instanceof Date ? value : new Date(value);
  const manila = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Manila" }),
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
  const rawSearch = String(search || "")
    .trim()
    .toLowerCase();

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

async function createNewEmergencySession({
  source = "manual",
  notes = null,
} = {}) {
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
    [nowManila],
  );

  const createResult = await pool.query(
    `
    INSERT INTO app.emergency_sessions (
      session_key,
      started_at,
      is_active,
      source,
      notes,
      created_at,
      updated_at
    )
    VALUES (
      'EMG-' || to_char($1::timestamp, 'YYYYMMDD-HH24MISS'),
      $1::timestamp,
      TRUE,
      $2,
      $3,
      $1::timestamp,
      $1::timestamp
    )
    RETURNING id, session_key, started_at, is_active
  `,
    [nowManila, source, notes],
  );

  return createResult.rows[0];
}

function getRequestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  return (forwarded || req.socket?.remoteAddress || req.ip || "").replace(
    /^::ffff:/,
    "",
  );
}

function detectBrowser(userAgent) {
  const ua = String(userAgent || "");

  if (/Edg\//i.test(ua)) return "Microsoft Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/Chrome\//i.test(ua)) return "Google Chrome";
  if (/Firefox\//i.test(ua)) return "Mozilla Firefox";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";

  return "Unknown";
}

function detectOperatingSystem(userAgent) {
  const ua = String(userAgent || "");

  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";

  return "Unknown";
}

function detectDeviceType(userAgent) {
  const ua = String(userAgent || "");

  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "Mobile";

  return "Desktop";
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
    const search = String(req.query.search || "").trim();
    const targetDate = String(req.query.date || "").trim();
    const dept = String(req.query.dept || "ALL").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({
        error: "Valid date is required. Format: YYYY-MM-DD",
      });
    }

    const result = await pool.query(
      `
      WITH ranked_rescue AS (
        SELECT
          id,
          l_uid,
          name,
          role,
          dept,
          phone,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(
              NULLIF(TRIM(l_uid), ''),
              'NAME:' || LOWER(TRIM(name))
            )
            ORDER BY updated_at DESC, id DESC
          ) AS rescue_rn
        FROM app.rescue_team
        WHERE is_active = TRUE
      ),

      rescue AS (
        SELECT
          id,
          l_uid,
          name,
          role,
          dept,
          phone
        FROM ranked_rescue
        WHERE rescue_rn = 1
      ),

      today_scans_only AS (
        SELECT
          h."L_UID",
          h."Person",
          h."L_Mode",
          h."L_TID",
          h."C_Date",
          h."C_Time"
        FROM "hkvision"."tbhikvision" h
        WHERE h."C_Date"::date = $1::date
          AND COALESCE(TRIM(h."Person"), '') <> ''
      ),

      matched_today_scans AS (
        SELECT
          rt.id,
          rt.l_uid,
          rt.name,
          rt.role,
          rt.dept,
          rt.phone,
          h."L_Mode" AS last_mode,
          h."L_TID" AS last_tid,
          h."C_Date" AS last_c_date,
          h."C_Time" AS last_c_time,
          ROW_NUMBER() OVER (
            PARTITION BY rt.id
            ORDER BY h."C_Date" DESC, h."C_Time" DESC
          ) AS scan_rn
        FROM rescue rt
        INNER JOIN today_scans_only h
          ON (
            NULLIF(TRIM(COALESCE(rt.l_uid::text, '')), '') IS NOT NULL
            AND TRIM(h."L_UID"::text) = TRIM(rt.l_uid::text)
          )
          OR (
            NULLIF(TRIM(COALESCE(rt.l_uid::text, '')), '') IS NULL
            AND LOWER(TRIM(h."Person")) = LOWER(TRIM(rt.name))
          )
      )

      SELECT
        id,
        l_uid,
        name,
        role,
        dept,
        phone,
        TRUE AS inside
      FROM matched_today_scans
      WHERE scan_rn = 1
        AND last_c_date::date = $1::date
        AND TRIM(COALESCE(last_tid::text, '')) = '1'
        AND (
          LOWER(TRIM(last_mode)) IN (
            'flane 1 entrance',
            'flane 2 entrance'
          )
          OR LOWER(TRIM(last_mode)) LIKE '%mustering%'
        )
        AND (
          $2::text = ''
          OR LOWER(name) LIKE LOWER('%' || $2::text || '%')
          OR LOWER(role) LIKE LOWER('%' || $2::text || '%')
          OR LOWER(dept) LIKE LOWER('%' || $2::text || '%')
        )
        AND (
          $3::text = 'ALL'
          OR dept = $3::text
        )
      ORDER BY name ASC
      `,
      [targetDate, search, dept],
    );

    res.set("Cache-Control", "no-store");
    res.json(result.rows);
  } catch (err) {
    sendInternalError(res, "Rescue team load", err);
  }
});

app.post("/api/rescue-team", async (req, res) => {
  let client = null;

  try {
    const { name, role, dept, phone, email, timeIn, timeOut, img, lUid } =
      req.body || {};

    const normalizedName = String(name || "").trim();
    const normalizedRole = String(role || "").trim();
    const normalizedLUid = String(lUid || "").trim() || null;

    if (!normalizedName || !normalizedRole) {
      return res.status(400).json({ error: "name and role are required" });
    }

    if (!normalizedLUid) {
      return res.status(400).json({
        error: "A valid personnel L_UID is required",
        code: "RESCUE_MEMBER_UID_REQUIRED",
      });
    }

    const normalizedDept = String(dept || "EMERGENCY").trim() || "EMERGENCY";
    const normalizedPhone = String(phone || "").trim() || null;
    const normalizedEmail = String(email || "").trim() || null;
    const normalizedTimeIn = String(timeIn || "").trim() || null;
    const normalizedTimeOut = String(timeOut || "").trim() || null;
    const normalizedImage = img || null;
    const nowManila = getManilaNowSqlString();

    client = await pool.connect();
    await client.query("BEGIN");

    // Serializes additions of the same personnel UID, including requests
    // arriving at nearly the same time.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `rescue-team:${normalizedLUid}`,
    ]);

    const existingResult = await client.query(
      `
      SELECT
        id,
        l_uid,
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
      WHERE TRIM(l_uid) = $1
      ORDER BY is_active DESC, updated_at DESC NULLS LAST, id DESC
      FOR UPDATE
      `,
      [normalizedLUid],
    );

    const existingRows = existingResult.rows;
    const activeMember = existingRows.find((row) => row.is_active === true);

    if (activeMember) {
      // Remove old duplicate rows for this same UID while retaining the
      // canonical active member.
      if (existingRows.length > 1) {
        await client.query(
          `
          DELETE FROM app.rescue_team
          WHERE TRIM(l_uid) = $1
            AND id <> $2
          `,
          [normalizedLUid, activeMember.id],
        );
      }

      await client.query("COMMIT");

      return res.status(409).json({
        success: false,
        created: false,
        reactivated: false,
        alreadyMember: true,
        code: "RESCUE_MEMBER_EXISTS",
        error: "User already in the Rescue team",
        message: "User already in the Rescue team",
        member: activeMember,
      });
    }

    if (existingRows.length > 0) {
      const memberToReactivate = existingRows[0];

      const reactivatedResult = await client.query(
        `
        UPDATE app.rescue_team
        SET
          l_uid = $2,
          name = $3,
          role = $4,
          dept = $5,
          phone = $6,
          email = $7,
          time_in = $8,
          time_out = $9,
          img = $10,
          is_active = TRUE,
          updated_at = $11::timestamp
        WHERE id = $1
        RETURNING
          id,
          l_uid,
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
          memberToReactivate.id,
          normalizedLUid,
          normalizedName,
          normalizedRole,
          normalizedDept,
          normalizedPhone,
          normalizedEmail,
          normalizedTimeIn,
          normalizedTimeOut,
          normalizedImage,
          nowManila,
        ],
      );

      // Remove any additional inactive duplicates after reusing one row.
      await client.query(
        `
        DELETE FROM app.rescue_team
        WHERE TRIM(l_uid) = $1
          AND id <> $2
        `,
        [normalizedLUid, memberToReactivate.id],
      );

      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        created: false,
        reactivated: true,
        alreadyMember: false,
        message: "User added back to the Rescue team",
        member: reactivatedResult.rows[0],
      });
    }

    const insertResult = await client.query(
      `
      INSERT INTO app.rescue_team (
        l_uid,
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        TRUE,
        $10::timestamp,
        $10::timestamp
      )
      RETURNING
        id,
        l_uid,
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
        normalizedLUid,
        normalizedName,
        normalizedRole,
        normalizedDept,
        normalizedPhone,
        normalizedEmail,
        normalizedTimeIn,
        normalizedTimeOut,
        normalizedImage,
        nowManila,
      ],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      created: true,
      reactivated: false,
      alreadyMember: false,
      message: "User added to the Rescue team",
      member: insertResult.rows[0],
    });
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    if (err?.code === "23505") {
      return res.status(409).json({
        success: false,
        created: false,
        alreadyMember: true,
        code: "RESCUE_MEMBER_EXISTS",
        error: "User already in the Rescue team",
        message: "User already in the Rescue team",
      });
    }

    sendInternalError(res, "Rescue team creation", err);
  } finally {
    client?.release();
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
      lUid,
    } = req.body;

    const nowManila = getManilaNowSqlString();
    const result = await pool.query(
      `
      UPDATE app.rescue_team
      SET
        l_uid = COALESCE($2, l_uid),
        name = COALESCE($3, name),
        role = COALESCE($4, role),
        dept = COALESCE($5, dept),
        phone = $6,
        email = $7,
        time_in = $8,
        time_out = $9,
        img = $10,
        is_active = COALESCE($11, is_active),
        updated_at = $12::timestamp
      WHERE id = $1
      RETURNING
        id,
        l_uid,
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
        lUid ? String(lUid).trim() : null,
        name ? String(name).trim() : null,
        role ? String(role).trim() : null,
        dept ? String(dept).trim() : null,
        phone ? String(phone).trim() : null,
        email ? String(email).trim() : null,
        timeIn ? String(timeIn).trim() : null,
        timeOut ? String(timeOut).trim() : null,
        img || null,
        typeof isActive === "boolean" ? isActive : null,
        nowManila,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rescue member not found" });
    }

    res.json({
      success: true,
      member: result.rows[0],
    });
  } catch (err) {
    sendInternalError(res, "Rescue team update", err);
  }
});

app.delete("/api/rescue-team/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const nowManila = getManilaNowSqlString();

    const result = await pool.query(
      `
  UPDATE app.rescue_team
  SET
    is_active = FALSE,
    updated_at = $2::timestamp
  WHERE id = $1
  RETURNING id
  `,
      [id, nowManila],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rescue member not found" });
    }

    res.json({
      success: true,
      removedId: result.rows[0].id,
    });
  } catch (err) {
    sendInternalError(res, "Rescue team removal", err);
  }
});

// IMPORTANT FIX:
// This signature checks all latest events today, not only IN records.
// So when a person exits, the cache is invalidated.
async function getLatestNormalDbSignature(targetDate) {
  const result = await pool.query(
    `
    SELECT
      COALESCE(MAX(("C_Date"::text || ' ' || "C_Time"::text)), '') AS latest_signature
    FROM "hkvision"."tbhikvision"
    WHERE "C_Date"::date = $1::date
      AND COALESCE(TRIM("Person"), '') <> ''
    `,
    [targetDate],
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

    // IMPORTANT FIX:
    // Get the latest record per person first.
    // Then only show people whose latest status is IN.
    // This prevents people from staying visible after they exit.
    const rawResult = await pool.query(
      `
      WITH latest AS (
        SELECT
          "CardNo",
          "L_UID",
          "Person",
          "PersonGroup",
          "L_Mode",
          "L_TID",
          "C_Date",
          "C_Time",
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM("L_UID"), ''), TRIM("Person"))
            ORDER BY "C_Date" DESC, "C_Time" DESC
          ) AS rn
        FROM "hkvision"."tbhikvision"
        WHERE "C_Date"::date = $1::date
          AND COALESCE(TRIM("Person"), '') <> ''
      )
      SELECT
        "CardNo",
        "L_UID",
        "Person",
        "PersonGroup",
        "L_Mode",
        "L_TID",
        "C_Date",
        "C_Time"
      FROM latest
      WHERE rn = 1
        AND TRIM(COALESCE("L_TID"::text, '')) = '1'
        AND (
          LOWER(TRIM("L_Mode")) IN (
            'flane 1 entrance',
            'flane 2 entrance'
          )
          OR LOWER(TRIM("L_Mode")) LIKE '%mustering%'
        )
      ORDER BY "C_Time" DESC
      `,
      [targetDate],
    );

    const allRows = dedupeRowsByCanonicalName(rawResult.rows);
    const summary = { total: allRows.length };
    const departments = [
      ...new Set(
        allRows
          .map((row) => String(row?.PersonGroup || "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    let rows = allRows;

    if (search) {
      rows = rows.filter((row) => {
        return (
          searchMatchesName(row?.Person, search) ||
          String(row?.PersonGroup || "")
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          String(row?.L_Mode || "")
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      });
    }

    if (dept && dept !== "ALL") {
      rows = rows.filter((row) => String(row?.PersonGroup || "") === dept);
    }

    rows.sort((a, b) =>
      String(a?.Person || "").localeCompare(String(b?.Person || "")),
    );

    const total = rows.length;
    const pagedRows = rows.slice(offset, offset + limit);
    const payload = {
      rows: pagedRows,
      total,
      summary,
      departments,
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
    sendInternalError(res, "Normal personnel load", err);
  }
});

// --------------------------------------------
// SNAPSHOT CURRENT PERSONNEL INTO SESSION
// --------------------------------------------
async function snapshotCurrentPersonnelToSession(sessionId) {
  const todayManila = getTodayManila();
  const snapshotNow = getManilaNowSqlString();

  const rawResult = await pool.query(
    `
    WITH latest AS (
      SELECT
        "L_UID",
        "Person",
        "PersonGroup",
        "L_Mode",
        "L_TID",
        "C_Date",
        "C_Time",
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(TRIM("L_UID"), ''), TRIM("Person"))
          ORDER BY "C_Date" DESC, "C_Time" DESC
        ) AS rn
      FROM "hkvision"."tbhikvision"
      WHERE "C_Date"::date = $1::date
        AND COALESCE(TRIM("Person"), '') <> ''
    )
    SELECT
      "L_UID",
      "Person",
      "PersonGroup",
      "L_Mode",
      "L_TID",
      "C_Date",
      "C_Time"
    FROM latest
    WHERE rn = 1
      AND TRIM(COALESCE("L_TID"::text, '')) = '1'
      AND (
        LOWER(TRIM("L_Mode")) IN (
          'flane 1 entrance',
          'flane 2 entrance'
        )
        OR LOWER(TRIM("L_Mode")) LIKE '%mustering%'
      )
    ORDER BY "C_Time" DESC
    `,
    [todayManila],
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
        marked_safe_at,
        marked_safe_by,
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
        NULL,
        NULL,
        $8::timestamp,
        $8::timestamp
      )
      ON CONFLICT (session_id, person_key) DO UPDATE
      SET
        l_uid = EXCLUDED.l_uid,
        persongroup = EXCLUDED.persongroup,
        initial_mode = EXCLUDED.initial_mode,
        initial_tid = EXCLUDED.initial_tid,
        updated_at = $8::timestamp
      `,
      [
        sessionId,
        row.person_key,
        row.L_UID || null,
        row.Person || "Unknown",
        row.PersonGroup || null,
        row.L_Mode || null,
        row.L_TID || null,
        snapshotNow,
      ],
    );

    insertedCount += insertResult.rowCount;
  }

  return insertedCount;
}

// --------------------------------------------
// EMERGENCY CONTROLS
// --------------------------------------------
async function startEmergencySession({ source = "manual", notes = null } = {}) {
  if (emergencyStartInFlight) {
    return emergencyStartInFlight;
  }

  emergencyStartInFlight = (async () => {
    const existingSession = await getActiveSession();

    if (existingSession) {
      return {
        session: existingSession,
        insertedCount: 0,
        alreadyActive: true,
      };
    }

    const session = await createNewEmergencySession({ source, notes });
    let insertedCount;

    try {
      insertedCount = await snapshotCurrentPersonnelToSession(session.id);
    } catch (error) {
      await stopEmergencySession({ sessionId: session.id }).catch(() => null);
      throw error;
    }

    clearNormalPersonnelCache();

    return {
      session,
      insertedCount,
      alreadyActive: false,
    };
  })();

  try {
    return await emergencyStartInFlight;
  } finally {
    emergencyStartInFlight = null;
  }
}

async function stopEmergencySession({ sessionId = null } = {}) {
  const nowManila = getManilaNowSqlString();
  const params = [nowManila];
  let targetClause = `
    id = (
      SELECT id
      FROM app.emergency_sessions
      WHERE is_active = TRUE
      ORDER BY started_at DESC
      LIMIT 1
    )
  `;

  if (sessionId != null) {
    params.push(sessionId);
    targetClause = "id = $2::bigint AND is_active = TRUE";
  }

  const result = await pool.query(
    `
    UPDATE app.emergency_sessions
    SET
      is_active = FALSE,
      ended_at = $1::timestamp,
      updated_at = $1::timestamp
    WHERE ${targetClause}
    RETURNING *
  `,
    params,
  );

  clearNormalPersonnelCache();

  return result.rows[0] || null;
}

async function processDueEmergencySchedules() {
  if (scheduleProcessing) return;
  scheduleProcessing = true;

  try {
    const expirationCheckTime = getSchedulerNowIso();

    await pool.query(
      `
        UPDATE app.emergency_schedules
        SET
          status = 'SKIPPED',
          result_message = 'Scheduled window ended before the emergency could start',
          updated_at = $1::timestamptz
        WHERE status = 'SCHEDULED'
          AND scheduled_until <= $1::timestamptz
      `,
      [expirationCheckTime],
    );

    while (true) {
      const finishCheckTime = getSchedulerNowIso();
      const finishClaim = await pool.query(
        `
          UPDATE app.emergency_schedules
          SET
            status = 'STOPPING',
            updated_at = $1::timestamptz
          WHERE id = (
            SELECT id
            FROM app.emergency_schedules
            WHERE status = 'STARTED'
              AND scheduled_until <= $1::timestamptz
            ORDER BY scheduled_until ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          RETURNING id, scheduled_until, started_session_id
        `,
        [finishCheckTime],
      );

      const schedule = finishClaim.rows[0];
      if (!schedule) break;

      try {
        const endedSession = await stopEmergencySession({
          sessionId: schedule.started_session_id,
        });

        await pool.query(
          `
          UPDATE app.emergency_schedules
          SET
            status = 'COMPLETED',
            result_message = $2,
            updated_at = $3::timestamptz
          WHERE id = $1
        `,
          [
            schedule.id,
            endedSession
              ? "Emergency finished automatically"
              : "Scheduled window completed; emergency was already stopped",
            getSchedulerNowIso(),
          ],
        );
      } catch (error) {
        await pool.query(
          `
          UPDATE app.emergency_schedules
          SET
            status = 'FAILED',
            result_message = $2,
            updated_at = $3::timestamptz
          WHERE id = $1
        `,
          [
            schedule.id,
            "Emergency could not be finished automatically",
            getSchedulerNowIso(),
          ],
        );

        logServerError("Scheduled emergency finish", error);
      }
    }

    while (true) {
      const startCheckTime = getSchedulerNowIso();
      const claimResult = await pool.query(
        `
          UPDATE app.emergency_schedules
          SET
            status = 'STARTING',
            updated_at = $1::timestamptz
          WHERE id = (
            SELECT id
            FROM app.emergency_schedules
            WHERE status = 'SCHEDULED'
              AND scheduled_for <= $1::timestamptz
              AND scheduled_until > $1::timestamptz
            ORDER BY scheduled_for ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          RETURNING id, scheduled_for, scheduled_until
        `,
        [startCheckTime],
      );

      const schedule = claimResult.rows[0];
      if (!schedule) break;

      try {
        const activeSession = await getActiveSession();

        if (activeSession) {
          await pool.query(
            `
            UPDATE app.emergency_schedules
            SET
              status = 'SKIPPED',
              result_message = 'Emergency was already active',
              updated_at = $2::timestamptz
            WHERE id = $1
          `,
            [schedule.id, getSchedulerNowIso()],
          );
          continue;
        }

        const result = await startEmergencySession({
          source: "scheduled",
          notes: `Started from schedule ${schedule.id}`,
        });

        await pool.query(
          `
          UPDATE app.emergency_schedules
          SET
            status = 'STARTED',
            started_session_id = $2,
            result_message = 'Emergency started automatically',
            updated_at = $3::timestamptz
          WHERE id = $1
        `,
          [schedule.id, result.session.id, getSchedulerNowIso()],
        );
      } catch (error) {
        await pool.query(
          `
          UPDATE app.emergency_schedules
          SET
            status = 'FAILED',
            result_message = $2,
            updated_at = $3::timestamptz
          WHERE id = $1
        `,
          [
            schedule.id,
            "Emergency could not be started automatically",
            getSchedulerNowIso(),
          ],
        );

        logServerError("Scheduled emergency start", error);
      }
    }
  } finally {
    scheduleProcessing = false;
  }
}

async function getNextEmergencyScheduleDelay() {
  const result = await pool.query(`
    SELECT MIN(due_at) AS due_at
    FROM (
      SELECT scheduled_for AS due_at
      FROM app.emergency_schedules
      WHERE status = 'SCHEDULED'

      UNION ALL

      SELECT scheduled_until AS due_at
      FROM app.emergency_schedules
      WHERE status = 'STARTED'
    ) AS due_schedules
  `);

  const dueAt = result.rows[0]?.due_at;
  if (!dueAt) return EMERGENCY_SCHEDULE_FALLBACK_POLL_MS;

  const dueTime = new Date(dueAt).getTime();
  if (!Number.isFinite(dueTime)) return EMERGENCY_SCHEDULE_FALLBACK_POLL_MS;

  return Math.min(
    Math.max(dueTime - Date.now(), 0),
    EMERGENCY_SCHEDULE_FALLBACK_POLL_MS,
  );
}

function queueEmergencyScheduleCheck(delayMs = 0) {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
  }

  scheduleTimer = setTimeout(
    async () => {
      scheduleTimer = null;

      try {
        await processDueEmergencySchedules();
      } catch (error) {
        logServerError("Schedule check", error);
      }

      let nextDelay = EMERGENCY_SCHEDULE_FALLBACK_POLL_MS;

      try {
        nextDelay = await getNextEmergencyScheduleDelay();
      } catch (error) {
        logServerError("Schedule timer", error);
      }

      queueEmergencyScheduleCheck(nextDelay);
    },
    Math.max(Number(delayMs) || 0, 0),
  );
}

function wakeEmergencyScheduleWorker() {
  queueEmergencyScheduleCheck(0);
}

app.post("/api/emergency/start", async (req, res) => {
  try {
    const result = await startEmergencySession({
      source: "manual",
      notes: "Started from dashboard",
    });

    res.json({
      emergencyActive: true,
      activeSession: result.session,
      snapshotInserted: result.insertedCount,
      alreadyActive: result.alreadyActive,
    });
  } catch (err) {
    sendInternalError(res, "Emergency start", err);
  }
});

app.post("/api/emergency/stop", async (req, res) => {
  try {
    const endedSession = await stopEmergencySession();

    res.json({
      emergencyActive: false,
      endedSession,
    });
  } catch (err) {
    sendInternalError(res, "Emergency stop", err);
  }
});

app.get("/api/emergency/schedules", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        scheduled_for,
        scheduled_until,
        status,
        created_by,
        created_at
      FROM app.emergency_schedules
      WHERE status IN ('SCHEDULED', 'STARTING', 'STARTED', 'STOPPING')
      ORDER BY scheduled_for ASC
      LIMIT 20
    `);

    res.json({ rows: result.rows });
  } catch (err) {
    sendInternalError(res, "Emergency schedule load", err);
  }
});

app.post("/api/emergency/schedules", async (req, res) => {
  let client = null;

  try {
    const {
      scheduledFor,
      scheduledUntil,
      createdBy = "operator",
    } = req.body || {};
    const scheduledDate = new Date(scheduledFor);
    const scheduledUntilDate = new Date(scheduledUntil);

    if (
      !scheduledFor ||
      !scheduledUntil ||
      Number.isNaN(scheduledDate.getTime()) ||
      Number.isNaN(scheduledUntilDate.getTime())
    ) {
      return res.status(400).json({
        error: "Valid start and finish dates are required",
      });
    }

    if (scheduledDate.getTime() <= Date.now() + 5000) {
      return res.status(400).json({
        error: "Schedule must be at least a few seconds in the future",
      });
    }

    if (scheduledUntilDate.getTime() <= scheduledDate.getTime()) {
      return res.status(400).json({
        error: "Finish must be later than start",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // Serialize schedule creation so simultaneous requests cannot both pass
    // the overlap check and create conflicting emergency windows.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [20260803]);

    const conflictResult = await client.query(
      `
      SELECT
        id,
        scheduled_for,
        scheduled_until,
        status
      FROM app.emergency_schedules
      WHERE status IN ('SCHEDULED', 'STARTING', 'STARTED', 'STOPPING')
        AND scheduled_for < $2::timestamptz
        AND scheduled_until > $1::timestamptz
      ORDER BY scheduled_for ASC
      LIMIT 1
      FOR UPDATE
      `,
      [scheduledDate.toISOString(), scheduledUntilDate.toISOString()],
    );

    if (conflictResult.rows[0]) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "This time overlaps an existing emergency schedule",
        conflict: conflictResult.rows[0],
      });
    }

    const result = await client.query(
      `
      INSERT INTO app.emergency_schedules (
        scheduled_for,
        scheduled_until,
        status,
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        $1::timestamptz,
        $2::timestamptz,
        'SCHEDULED',
        $3,
        $4::timestamptz,
        $4::timestamptz
      )
      RETURNING
        id,
        scheduled_for,
        scheduled_until,
        status,
        created_by,
        created_at
    `,
      [
        scheduledDate.toISOString(),
        scheduledUntilDate.toISOString(),
        String(createdBy || "operator").slice(0, 100),
        getSchedulerNowIso(),
      ],
    );

    await client.query("COMMIT");

    wakeEmergencyScheduleWorker();
    res.status(201).json({ schedule: result.rows[0] });
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    sendInternalError(res, "Emergency schedule creation", err);
  } finally {
    client?.release();
  }
});

app.delete("/api/emergency/schedules/:id", async (req, res) => {
  try {
    const scheduleId = Number(req.params.id);

    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ error: "Invalid schedule id" });
    }

    const result = await pool.query(
      `
      UPDATE app.emergency_schedules
      SET
        status = 'CANCELLED',
        result_message = 'Cancelled from dashboard',
        updated_at = $2::timestamptz
      WHERE id = $1
        AND status = 'SCHEDULED'
      RETURNING id, scheduled_for, status
    `,
      [scheduleId, getSchedulerNowIso()],
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        error: "Schedule was not found or can no longer be cancelled",
      });
    }

    wakeEmergencyScheduleWorker();
    res.json({ success: true, schedule: result.rows[0] });
  } catch (err) {
    sendInternalError(res, "Emergency schedule cancellation", err);
  }
});

// --------------------------------------------
// EMERGENCY STATUS
// --------------------------------------------
app.get("/api/emergency-status", async (req, res) => {
  try {
    const session = await getActiveSession();

    if (!session) {
      return res.json({
        emergencyActive: false,
        activeSession: null,
      });
    }

    res.json({
      emergencyActive: true,
      activeSession: session,
    });
  } catch (err) {
    sendInternalError(res, "Emergency status load", err);
  }
});

// --------------------------------------------
// ACTIVE EMERGENCY ACCOUNTABILITY
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
        summary: { total: 0, safeCount: 0, notSafeCount: 0 },
        departments: [],
        limit: 20,
        offset: 0,
        hasMore: false,
      });
    }

    const { limit, offset } = parsePaging(req);
    const search = (req.query.search || "").trim();
    const dept = (req.query.dept || "").trim();
    const status = String(req.query.status || "")
      .trim()
      .toUpperCase();

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
      [session.id],
    );

    const allRows = result.rows;
    const summary = {
      total: allRows.length,
      safeCount: allRows.filter((row) => row.current_status === "SAFE").length,
      notSafeCount: allRows.filter((row) => row.current_status !== "SAFE")
        .length,
    };
    const departments = [
      ...new Set(
        allRows
          .map((row) => String(row?.persongroup || "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    let rows = allRows;

    if (search) {
      rows = rows.filter((row) => {
        return (
          searchMatchesName(row?.person, search) ||
          String(row?.persongroup || "")
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          String(row?.initial_mode || "")
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      });
    }

    if (dept && dept !== "ALL") {
      rows = rows.filter((row) => String(row?.persongroup || "") === dept);
    }

    if (status === "SAFE") {
      rows = rows.filter((row) => row.current_status === "SAFE");
    }

    if (status === "NOT_SAFE" || status === "NOT SAFE") {
      rows = rows.filter((row) => row.current_status !== "SAFE");
    }

    rows.sort((a, b) =>
      String(a?.person || "").localeCompare(String(b?.person || "")),
    );

    const total = rows.length;
    const safeCount = rows.filter(
      (row) => row.current_status === "SAFE",
    ).length;
    const notSafeCount = rows.filter(
      (row) => row.current_status !== "SAFE",
    ).length;
    const pagedRows = rows.slice(offset, offset + limit);

    res.json({
      rows: pagedRows,
      total,
      safeCount,
      notSafeCount,
      summary,
      departments,
      limit,
      offset,
      hasMore: offset + pagedRows.length < total,
    });
  } catch (err) {
    sendInternalError(res, "Emergency accountability load", err);
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
      [session.id, markedBy || "system", personKey],
    );

    res.json({
      success: true,
      updated: updateResult.rows[0] || null,
    });
  } catch (err) {
    sendInternalError(res, "Safe status update", err);
  }
});

// --------------------------------------------
// UPDATE EMERGENCY STATUS
// Used by frontend when clicking a person card
// --------------------------------------------
app.post("/api/emergency/update-status", async (req, res) => {
  try {
    const { personKey, status, markedBy } = req.body;

    if (!personKey) {
      return res.status(400).json({ error: "personKey is required" });
    }

    if (!["SAFE", "NOT SAFE"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const session = await getActiveSession();

    if (!session) {
      return res.status(400).json({ error: "No active emergency session" });
    }

    const updateResult = await pool.query(
      `
      UPDATE app.emergency_accountability
      SET
        current_status = $2,
        marked_safe_at = CASE
          WHEN $2 = 'SAFE' THEN (NOW() AT TIME ZONE 'Asia/Manila')
          ELSE NULL
        END,
        marked_safe_by = CASE
          WHEN $2 = 'SAFE' THEN $3
          ELSE NULL
        END,
        updated_at = (NOW() AT TIME ZONE 'Asia/Manila')
      WHERE session_id = $1
        AND person_key = $4
      RETURNING
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
      `,
      [session.id, status, markedBy || "operator", personKey],
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        error: "Person not found in active emergency session",
      });
    }

    clearNormalPersonnelCache();

    res.json({
      success: true,
      updated: updateResult.rows[0],
    });
  } catch (err) {
    sendInternalError(res, "Emergency status update", err);
  }
});

// --------------------------------------------
// HISTORY
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
      [limit, offset],
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
    sendInternalError(res, "Emergency history load", err);
  }
});

// --------------------------------------------
// HISTORY DETAILS
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
      [sessionId],
    );

    res.json(result.rows);
  } catch (err) {
    sendInternalError(res, "Emergency history details load", err);
  }
});

// --------------------------------------------
// ANALYTICS
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
      [sessionId],
    );

    res.json(result.rows);
  } catch (err) {
    sendInternalError(res, "Emergency analytics load", err);
  }
});

// --------------------------------------------
// MUSTERING SYNC
// --------------------------------------------
async function syncMusteringScansToActiveSession() {
  const session = await getActiveSession();

  if (!session) {
    return {
      success: true,
      updatedCount: 0,
      insertedCount: 0,
      message: "No active emergency session",
    };
  }

  const scanWindowEnd = getManilaNowSqlString();
  const scanWindowStart = getManilaNowSqlString(
    new Date(Date.now() - 5 * 60 * 1000),
  );

  const musterResult = await pool.query(
    `
    WITH active_window AS (
      SELECT
        GREATEST(started_at, $1::timestamp) AS window_start,
        $2::timestamp AS window_end
      FROM app.emergency_sessions
      WHERE id = $3
        AND is_active = TRUE
    ),
    latest_window_scan AS (
      SELECT
        "L_UID",
        "Person",
        "PersonGroup",
        "L_Mode",
        "L_TID",
        "C_Date",
        "C_Time",
        ("C_Date"::date + "C_Time"::time) AS scanned_at,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(TRIM("L_UID"), ''), TRIM("Person"))
          ORDER BY "C_Date" DESC, "C_Time" DESC
        ) AS rn
      FROM "hkvision"."tbhikvision"
      CROSS JOIN active_window
      WHERE "C_Date"::date BETWEEN $1::timestamp::date AND $2::timestamp::date
        AND COALESCE(TRIM("Person"), '') <> ''
        AND ("C_Date"::date + "C_Time"::time) BETWEEN
          active_window.window_start AND active_window.window_end
        AND TRIM(COALESCE("L_TID"::text, '')) = '1'
        AND LOWER(TRIM("L_Mode")) LIKE '%mustering%'
    )
    SELECT
      "L_UID",
      "Person",
      "PersonGroup",
      "L_Mode",
      "L_TID",
      "C_Date",
      "C_Time",
      to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') AS scanned_at
    FROM latest_window_scan
    WHERE rn = 1
    ORDER BY scanned_at DESC
    `,
    [scanWindowStart, scanWindowEnd, session.id],
  );

  const dedupedRows = dedupeRowsByCanonicalName(musterResult.rows);

  let insertedCount = 0;
  let updatedCount = 0;

  for (const row of dedupedRows) {
    const result = await pool.query(
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
        marked_safe_at,
        marked_safe_by,
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
        'SAFE',
        $8::timestamp,
        'mustering-scanner',
        $9::timestamp,
        $9::timestamp
      )
      ON CONFLICT (session_id, person_key) DO UPDATE
      SET
        l_uid = EXCLUDED.l_uid,
        persongroup = EXCLUDED.persongroup,
        initial_mode = EXCLUDED.initial_mode,
        initial_tid = EXCLUDED.initial_tid,
        current_status = 'SAFE',
        marked_safe_at = COALESCE(
          app.emergency_accountability.marked_safe_at,
          EXCLUDED.marked_safe_at
        ),
        marked_safe_by = COALESCE(
          app.emergency_accountability.marked_safe_by,
          EXCLUDED.marked_safe_by
        ),
        updated_at = $9::timestamp
      RETURNING
        xmax = 0 AS inserted
      `,
      [
        session.id,
        row.person_key,
        row.L_UID || null,
        row.Person || "Unknown",
        row.PersonGroup || null,
        row.L_Mode || null,
        row.L_TID || null,
        row.scanned_at || scanWindowEnd,
        scanWindowEnd,
      ],
    );

    if (result.rows[0]?.inserted) insertedCount += 1;
    else updatedCount += 1;
  }

  return {
    success: true,
    insertedCount,
    updatedCount,
  };
}

app.post("/api/visit-session", async (req, res) => {
  try {
    const {
      sessionId,
      firstPath = "/",
      userAgent: clientUserAgent = "",
    } = req.body || {};

    const normalizedSessionId = String(sessionId || "").trim();

    if (
      !normalizedSessionId ||
      normalizedSessionId.length < 8 ||
      normalizedSessionId.length > 120
    ) {
      return res.status(400).json({ error: "Invalid visit session id" });
    }

    const userAgent = String(
      clientUserAgent || req.headers["user-agent"] || "",
    ).slice(0, 1000);

    const result = await pool.query(
      `
      INSERT INTO app."Emergency-logs" (
        session_id,
        ip_address,
        browser,
        operating_system,
        device_type,
        first_path,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (session_id) DO NOTHING
      RETURNING id, opened_at
    `,
      [
        normalizedSessionId,
        getRequestIp(req),
        detectBrowser(userAgent),
        detectOperatingSystem(userAgent),
        detectDeviceType(userAgent),
        String(firstPath || "/").slice(0, 500),
        userAgent,
      ],
    );

    res.status(result.rowCount > 0 ? 201 : 200).json({
      success: true,
      created: result.rowCount > 0,
    });
  } catch (err) {
    sendInternalError(res, "Visit session recording", err);
  }
});

app.post("/api/auth/passcode", (req, res) => {
  const { passcode } = req.body;

  if (!APP_PASSWORD) {
    return res.status(500).json({ error: "APP_PASSWORD is not configured" });
  }

  if (String(passcode ?? "").trim() !== APP_PASSWORD) {
    return res.status(401).json({ error: "Invalid passcode" });
  }

  res.json({
    success: true,
    token: "passcode-ok",
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

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
    sendInternalError(res, "Mustering synchronization", err, {
      success: false,
    });
  } finally {
    musteringSyncInFlight = false;
  }
});

app.get("/api/personnel-search", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();

    if (search.length < 3) {
      return res.json([]);
    }

    const result = await pool.query(
      `
      WITH matched AS (
        SELECT
          "L_UID",
          "Person",
          "PersonGroup",
          "C_Date",
          "C_Time",
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM("L_UID"), ''), LOWER(TRIM("Person")))
            ORDER BY "C_Date" DESC, "C_Time" DESC
          ) AS rn
        FROM "hkvision"."tbhikvision"
        WHERE COALESCE(TRIM("Person"), '') <> ''
          AND (
            LOWER("Person") LIKE LOWER('%' || $1::text || '%')
            OR LOWER("PersonGroup") LIKE LOWER('%' || $1::text || '%')
          )
      )
      SELECT
        "L_UID",
        "Person",
        "PersonGroup"
      FROM matched
      WHERE rn = 1
      ORDER BY "Person" ASC
      LIMIT 30
      `,
      [search],
    );

    res.json(result.rows);
  } catch (err) {
    sendInternalError(res, "Personnel search", err);
  }
});
// --------------------------------------------
// SERVE REACT BUILD
// --------------------------------------------
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

app.use(express.static(path.join(__dirname, "dist")));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();

  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// --------------------------------------------
// START SERVER
// --------------------------------------------
async function startServer() {
  try {
    await initDb();
    await recoverInterruptedEmergencySchedules();
    console.log("✅ DB INIT COMPLETE");
  } catch (err) {
    logServerError("Database initialization", err);
    process.exitCode = 1;
    return;
  }

  const PORT = Number(process.env.PORT) || 5053;

  app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
    wakeEmergencyScheduleWorker();
  });
}

startServer();
