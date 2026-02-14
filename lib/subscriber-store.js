const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const waitlistFile = path.join(process.cwd(), 'waitlist.json');
let pool;
let initPromise;

function dbUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

function hasDb() {
  return Boolean(dbUrl());
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: dbUrl(),
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureTable() {
  if (!hasDb()) return;
  if (!initPromise) {
    initPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS arcstarz_subscribers (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS arcstarz_subscribers_created_at_idx
      ON arcstarz_subscribers (created_at DESC);
    `);
  }
  await initPromise;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeName(name) {
  const cleaned = String(name || '').trim();
  return cleaned || 'Subscriber';
}

function normalizeFileRows(rows) {
  const map = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const email = normalizeEmail(raw.email);
    if (!email || !email.includes('@')) continue;
    const next = {
      id: raw.id || Date.now(),
      name: normalizeName(raw.name),
      email,
      timestamp: raw.timestamp || new Date().toISOString(),
      unsubscribed: Boolean(raw.unsubscribed),
    };
    const prev = map.get(email);
    if (!prev || prev.timestamp < next.timestamp) map.set(email, next);
  }
  return Array.from(map.values()).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

function readFileList() {
  if (!fs.existsSync(waitlistFile)) return [];
  try {
    const raw = fs.readFileSync(waitlistFile, 'utf8');
    return normalizeFileRows(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeFileList(rows) {
  fs.writeFileSync(waitlistFile, JSON.stringify(rows, null, 2));
}

async function getAllSubscribers() {
  if (!hasDb()) return readFileList();
  await ensureTable();
  const { rows } = await getPool().query(
    `SELECT id, name, email, unsubscribed, created_at
     FROM arcstarz_subscribers
     ORDER BY created_at DESC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    email: r.email,
    timestamp: new Date(r.created_at).toISOString(),
    unsubscribed: Boolean(r.unsubscribed),
  }));
}

async function findByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (!hasDb()) return readFileList().find((x) => x.email === normalized) || null;
  await ensureTable();
  const { rows } = await getPool().query(
    `SELECT id, name, email, unsubscribed, created_at
     FROM arcstarz_subscribers
     WHERE email = $1
     LIMIT 1`,
    [normalized]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    name: r.name,
    email: r.email,
    timestamp: new Date(r.created_at).toISOString(),
    unsubscribed: Boolean(r.unsubscribed),
  };
}

async function addOrResubscribe(name, email) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { status: 'invalid' };
  }

  const existing = await findByEmail(normalizedEmail);
  if (existing && !existing.unsubscribed) return { status: 'duplicate' };

  if (!hasDb()) {
    const list = readFileList();
    const idx = list.findIndex((x) => x.email === normalizedEmail);
    if (idx >= 0) {
      list[idx].name = normalizedName;
      list[idx].timestamp = new Date().toISOString();
      list[idx].unsubscribed = false;
      writeFileList(list);
      return { status: 'resubscribed' };
    }
    list.push({
      id: Date.now(),
      name: normalizedName,
      email: normalizedEmail,
      timestamp: new Date().toISOString(),
      unsubscribed: false,
    });
    writeFileList(normalizeFileRows(list));
    return { status: 'created' };
  }

  await ensureTable();
  if (existing && existing.unsubscribed) {
    await getPool().query(
      `UPDATE arcstarz_subscribers
       SET name = $2, unsubscribed = FALSE, updated_at = NOW()
       WHERE email = $1`,
      [normalizedEmail, normalizedName]
    );
    return { status: 'resubscribed' };
  }

  await getPool().query(
    `INSERT INTO arcstarz_subscribers (name, email, unsubscribed)
     VALUES ($1, $2, FALSE)`,
    [normalizedName, normalizedEmail]
  );
  return { status: 'created' };
}

async function mergeSubscribers(rows) {
  const normalized = normalizeFileRows(
    rows.map((x) => ({
      id: Date.now() + Math.floor(Math.random() * 100000),
      name: normalizeName(x.name),
      email: normalizeEmail(x.email),
      timestamp: new Date().toISOString(),
      unsubscribed: false,
    }))
  );

  if (!hasDb()) {
    const current = readFileList();
    const merged = normalizeFileRows([...current, ...normalized]);
    writeFileList(merged);
    return { count: merged.length };
  }

  await ensureTable();
  for (const row of normalized) {
    await getPool().query(
      `INSERT INTO arcstarz_subscribers (name, email, unsubscribed)
       VALUES ($1, $2, FALSE)
       ON CONFLICT (email)
       DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()`,
      [row.name, row.email]
    );
  }

  const list = await getAllSubscribers();
  return { count: list.length };
}

async function unsubscribeEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { ok: false, message: 'Invalid email' };

  if (!hasDb()) {
    const list = readFileList();
    const idx = list.findIndex((x) => x.email === normalizedEmail);
    if (idx < 0) return { ok: false, message: 'Subscriber not found' };
    list[idx].unsubscribed = true;
    writeFileList(list);
    return { ok: true };
  }

  await ensureTable();
  const result = await getPool().query(
    `UPDATE arcstarz_subscribers
     SET unsubscribed = TRUE, updated_at = NOW()
     WHERE email = $1`,
    [normalizedEmail]
  );
  if (!result.rowCount) return { ok: false, message: 'Subscriber not found' };
  return { ok: true };
}

module.exports = {
  hasDb,
  getAllSubscribers,
  findByEmail,
  addOrResubscribe,
  mergeSubscribers,
  unsubscribeEmail,
};
