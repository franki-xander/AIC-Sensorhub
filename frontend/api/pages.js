// api/pages.js
// Handles all /api/pages routes.
// GET    — list all sensor pages for the authenticated user
// POST   — create a new sensor page
//
// Individual page operations (PATCH, DELETE) are in api/pages/[id].js

import db from "./_utils/db.js";
import { requireAuth } from "./_utils/session.js";

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  // ── GET /api/pages ─────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const result = await db.query(
      "SELECT * FROM sensor_pages WHERE user_id = $1 ORDER BY sort_order, created_at",
      [user.id]
    );
    return res.json(result.rows);
  }

  // ── POST /api/pages ────────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { display_name, description, sensor_id, visible_fields } = req.body;

    if (!display_name || !sensor_id) {
      return res.status(400).json({ error: "display_name and sensor_id are required." });
    }

    const result = await db.query(
      `INSERT INTO sensor_pages (user_id, display_name, description, sensor_id, visible_fields)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        user.id,
        display_name,
        description || null,
        sensor_id,
        JSON.stringify(visible_fields || null),
      ]
    );
    return res.status(201).json(result.rows[0]);
  }

  res.status(405).json({ error: "Method not allowed." });
}
