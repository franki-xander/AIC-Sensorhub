// api/index.js
// Consolidated API Entry Point for Pages and Data
import { db } from "./_utils/db.js";
import { requireAuth } from "./_utils/session.js";

async function getScriptUrl(userId) {
  const result = await db.query(
    "SELECT script_url FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0]?.script_url || null;
}

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  // Inspect the URL path to see which feature the client is requesting
  // On Vercel, req.url includes the path (e.g., "/api?type=data" or we look at query params)
  const isDataRoute = req.query.route === 'data' || req.url && req.url.includes('/data');

  // ==========================================================================
  // ── DATA ROUTE LOGIC (Formerly data.js) ───────────────────────────────────
  // ==========================================================================
  if (isDataRoute) {
    const scriptUrl = await getScriptUrl(user.id);
    if (!scriptUrl) {
      return res.status(400).json({ error: "No Apps Script URL configured. Please complete setup." });
    }

    if (req.method === "GET") {
      // Clean up the routing param so it isn't forwarded to Apps Script
      const cleanQuery = { ...req.query };
      delete cleanQuery.route; 
      
      const params = new URLSearchParams(cleanQuery).toString();
      try {
        const upstream = await fetch(`${scriptUrl}?${params}`);
        const body     = await upstream.text();
        res.setHeader("Content-Type", "application/json");
        return res.send(body);
      } catch (err) {
        console.error("Proxy GET error:", err);
        return res.status(502).json({
          error: "Could not reach your Apps Script. Check it is still deployed.",
        });
      }
    }

    if (req.method === "POST") {
      try {
        const upstream = await fetch(scriptUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(req.body),
        });
        const body = await upstream.text();
        res.setHeader("Content-Type", "application/json");
        return res.send(body);
      } catch (err) {
        console.error("Proxy POST error:", err);
        return res.status(502).json({ error: "Could not reach your Apps Script." });
      }
    }

    return res.status(405).json({ error: "Method not allowed." });
  }

  // ==========================================================================
  // ── PAGES ROUTE LOGIC (Formerly pages.js) ─────────────────────────────────
  // ==========================================================================
  if (req.method === "GET") {
    const result = await db.query(
      "SELECT * FROM sensor_pages WHERE user_id = $1 ORDER BY sort_order, created_at",
      [user.id]
    );
    return res.json(result.rows);
  }

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
  // ── PATCH /api/pages/:id or /api?id=123 ──────────────────────────────────
if (req.method === "PATCH") {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "Page ID is required." });

  const { display_name, description, sensor_id, visible_fields, sort_order } = req.body;

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

// ── DELETE /api/pages/:id or /api?id=123 ─────────────────────────────────
if (req.method === "DELETE") {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "Page ID is required." });

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