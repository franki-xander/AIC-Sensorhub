// api/_utils/db.js
// Single shared PostgreSQL connection pool.
// Vercel reuses function instances between invocations so the pool
// is created once and reused, preventing connection exhaustion.

const { Pool } = require("pg");

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Supabase / hosted Postgres
});

module.exports = db;
