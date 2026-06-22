// api/account.js
// Handles all /api/account routes.
// GET    — return account info (never the script_url)
// POST   — save script_url + drive_folder_id and verify connection
// PATCH  — update display name
// DELETE — delete account

import { db } from "./_utils/db.js";
import { requireAuth } from "./_utils/session.js";

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  // ── GET /api/account ──────────────────────────────────────────────────────
  if (req.method === "GET") {
    const result = await db.query(
      "SELECT id, email, display_name, account_status, drive_folder_id FROM users WHERE id = $1",
      [user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "User not found." });
    return res.json(result.rows[0]);
  }

  // ── POST /api/account (setup — save Script URL and verify) ────────────────
  if (req.method === "POST") {
    const { script_url, drive_folder_id } = req.body;
    if (!script_url) return res.status(400).json({ error: "script_url is required." });

    if (!script_url.includes("script.google.com/macros/s/")) {
      return res.status(400).json({
        error: "URL does not look like a Google Apps Script Web App URL.",
      });
    }

    // Probe the script to confirm it is deployed and returns PONG
    try {
      const probe = await fetch(`${script_url}?action=ping`);
      const text  = await probe.text();
      if (!text.includes("PONG")) {
        return res.status(422).json({
          error: "Script did not respond with PONG. Make sure you deployed the correct code and set access to 'Anyone'.",
        });
      }
    } catch {
      return res.status(422).json({
        error: "Could not reach the Apps Script URL. Check it is deployed and publicly accessible.",
      });
    }

    await db.query(
      `UPDATE users
       SET script_url = $1, drive_folder_id = $2, account_status = 'active'
       WHERE id = $3`,
      [script_url, drive_folder_id || null, user.id]
    );
    return res.json({ ok: true });
  }

  // ── PATCH /api/account (update display name) ──────────────────────────────
  if (req.method === "PATCH") {
    const { display_name } = req.body;
    await db.query(
      "UPDATE users SET display_name = $1 WHERE id = $2",
      [display_name, user.id]
    );
    return res.json({ ok: true });
  }

  // ── DELETE /api/account ───────────────────────────────────────────────────
  if (req.method === "DELETE") {
    await db.query("DELETE FROM users WHERE id = $1", [user.id]);
    // Clear the refresh cookie
    res.setHeader("Set-Cookie",
      "refresh_token=; Path=/api/auth/refresh; Max-Age=0; HttpOnly; SameSite=Strict"
    );
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed." });
}
