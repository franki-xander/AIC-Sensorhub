// api/archives/index.js
// GET /api/archives
// Lists all archive CSV files in the user's Google Drive folder.
// Drive URLs are stripped — downloads must go through /api/archives/download/[fileId]

import { db } from "../_utils/db.js";
import { requireAuth } from "../_utils/session.js";

async function getUserData(userId) {
  const result = await db.query(
    "SELECT script_url, drive_folder_id FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0] || {};
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const { script_url, drive_folder_id } = await getUserData(user.id);

  if (!script_url) {
    return res.status(400).json({ error: "No Apps Script URL configured." });
  }
  if (!drive_folder_id) {
    return res.status(400).json({
      error: "No archive folder configured. Go to Setup and add your Google Drive folder ID.",
    });
  }

  try {
    const upstream = await fetch(
      `${script_url}?action=getArchives&folder_id=${encodeURIComponent(drive_folder_id)}`
    );
    const data = await upstream.json();

    // Strip the raw Drive download URL — the browser must use our proxy endpoint
    const sanitized = data.map(f => ({
      id:         f.id,
      name:       f.name,
      size:       f.size,
      created_at: f.created_at,
      sensor_id:  f.sensor_id,
    }));

    res.json(sanitized);
  } catch (err) {
    console.error("Archive list error:", err);
    res.status(502).json({ error: "Could not retrieve archive list." });
  }
}
