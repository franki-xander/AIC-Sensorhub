// api/archives/generate.js
// POST /api/archives/generate
// Triggers archive CSV generation via the Apps Script.
//
// Body:
//   mode:              "incremental" | "from_date" | "all"
//   from_date?:        "2024-01-01"   (required when mode = "from_date")
//   exclude_sensors?:  ["sensor_1"]   (optional array of sensor IDs to skip)

import db from "../_utils/db.js";
import { requireAuth } from "../_utils/session.js";

async function getUserData(userId) {
  const result = await db.query(
    "SELECT script_url, drive_folder_id FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0] || {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
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

  const { mode = "incremental", from_date, exclude_sensors } = req.body;

  if (mode === "from_date" && !from_date) {
    return res.status(400).json({ error: "from_date is required when mode is 'from_date'." });
  }

  const params = new URLSearchParams({
    action:    "generateArchives",
    mode,
    folder_id: drive_folder_id,
  });

  if (mode === "from_date" && from_date) {
    params.set("from_date", from_date);
  }
  if (Array.isArray(exclude_sensors) && exclude_sensors.length > 0) {
    params.set("exclude_sensors", exclude_sensors.join(","));
  }

  try {
    const upstream = await fetch(`${script_url}?${params.toString()}`);
    const result   = await upstream.json();
    res.json(result);
  } catch (err) {
    console.error("Archive generate error:", err);
    res.status(502).json({ error: "Archive generation failed." });
  }
}
