// api/data.js
// Proxies all data requests to the user's Apps Script.
// The Script URL is looked up server-side and never sent to the browser.
//
// GET  /api/data?action=getData&sensor_id=...&hours=...
// GET  /api/data?action=getConfig&sensor_id=...
// GET  /api/data?action=getSensorIds
// GET  /api/data?action=getFields&sensor_id=...
// GET  /api/data?action=setInterval&sensor_id=...&value=...
// POST /api/data  { ...payload }  (used for testing; ESP32 posts directly)

import db from "./_utils/db.js";
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

  const scriptUrl = await getScriptUrl(user.id);
  if (!scriptUrl) {
    return res.status(400).json({ error: "No Apps Script URL configured. Please complete setup." });
  }

  // ── GET — forward query string to the Apps Script ─────────────────────────
  if (req.method === "GET") {
    // Remove the leading /api/data path — pass only the query params
    const params = new URLSearchParams(req.query).toString();
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

  // ── POST — forward body to the Apps Script ────────────────────────────────
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

  res.status(405).json({ error: "Method not allowed." });
}
