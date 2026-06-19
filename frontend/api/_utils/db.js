// api/_utils/db.js
// Single shared PostgreSQL connection pool.
import pg from "pg";
const { Pool } = pg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Supabase / hosted Postgres
});

// Use a named export so it perfectly matches your callback.js import { db } syntax
export { db };