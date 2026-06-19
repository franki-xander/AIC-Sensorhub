// api/pages/[id].js
// Handles operations on a single sensor page.
// PATCH  — edit name, description, sensor_id, visible_fields, sort_order
// DELETE — remove the page
//
// The [id] filename tells Vercel this is a dynamic route.
// The page ID comes from req.query.id

import db from "../_utils/db.js";
import { requireAuth } from "../_utils/session.js";

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Page ID is required." });
  }

  // ── PATCH /api/pages/:id ───────────────────────────────────────────────────
  if (req.method === "PATCH") {
    const { display_name, description, sensor_id, visible_fields, sort_order } = req.body;

    // COALESCE means only the fields that are provided get updated.
    // The WHERE user_id = $7 ensures users can only edit their own pages.
    const result = await db.query(
      `UPDATE sensor_pages
       SET display_name   = COALESCE($1, display_name),
           description    = COALESCE($2, description),
           sensor_id      = COALESCE($3, sensor_id),
           visible_fields = COALESCE($4, visible_fields),
           sort_order     = COALESCE($5, sort_order)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [
        display_name  ?? null,
        description   ?? null,
        sensor_id     ?? null,
        visible_fields !== undefined ? JSON.stringify(visible_fields) : null,
        sort_order    ?? null,
        id,
        user.id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Sensor page not found." });
    }
    return res.json(result.rows[0]);
  }

  // ── DELETE /api/pages/:id ──────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const result = await db.query(
      "DELETE FROM sensor_pages WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Sensor page not found." });
    }
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed." });
}
