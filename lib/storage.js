const {AsyncLocalStorage} = require('node:async_hooks');

const transactions = new AsyncLocalStorage();
let pool, initialized;
const enabled = () => Boolean(process.env.DATABASE_URL);

function connection() {
  if (!pool) {
    const {Pool} = require('pg');
    pool = new Pool({connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 15000});
    pool.on('error', () => console.error('Database connection unavailable'));
  }
  return pool;
}

async function initialize() {
  if (!enabled()) return;
  initialized ||= connection().query(`CREATE TABLE IF NOT EXISTS kinava_records (
    namespace text NOT NULL CHECK (namespace IN ('report', 'pass')),
    token text NOT NULL CHECK (token ~ '^[a-f0-9]{48}$'),
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (namespace, token)
  )`).catch(error => { initialized = null; throw error; });
  await initialized;
}

async function query(sql, parameters) {
  await initialize();
  return (transactions.getStore() || connection()).query(sql, parameters);
}

async function read(namespace, token) {
  return (await query('SELECT payload FROM kinava_records WHERE namespace=$1 AND token=$2', [namespace, token])).rows[0]?.payload || null;
}

async function write(namespace, token, value) {
  await query(`INSERT INTO kinava_records (namespace, token, payload) VALUES ($1,$2,$3)
    ON CONFLICT (namespace, token) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()`, [namespace, token, JSON.stringify(value)]);
}

async function lock(namespace, token, operation) {
  await initialize();
  const existing = transactions.getStore();
  const client = existing || await connection().connect();
  try {
    if (!existing) await client.query('BEGIN');
    // The same database transaction covers package quota and the corresponding paid report.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [namespace + ':' + token]);
    const result = await transactions.run(client, operation);
    if (!existing) await client.query('COMMIT');
    return result;
  } catch (error) {
    if (!existing) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { if (!existing) client.release(); }
}

async function health() {
  if (enabled()) await query('SELECT 1');
}

async function close() { if (pool) await pool.end(); pool = initialized = undefined; }

module.exports = {enabled, read, write, lock, health, close, initialize, query};
