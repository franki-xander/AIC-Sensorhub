// api/archives/download/[fileId].js
// GET /api/archives/download/:fileId
// Fetches the CSV from Google Drive via the Apps Script and streams it
// to the browser. The raw Drive URL is never exposed to the client.
//
// The [fileId] filename tells Vercel this is a dynamic route.
// The file ID comes from req.query.fileId

import db from "../../_utils/db.js";
import { requireAuth } from "../../_utils/session.js";

async function getScriptUrl(userId) {
  const result = await db.query(
    "SELECT script_url FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0]?.script_url || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const { fileId } = req.query;

  // Sanitize the fileId — Google Drive IDs are alphanumeric with hyphens and underscores
  if (!fileId || !/^[\w-]+$/.test(fileId)) {
    return res.status(400).json({ error: "Invalid file ID." });
  }

  const scriptUrl = await getScriptUrl(user.id);
  if (!scriptUrl) {
    return res.status(400).json({ error: "No Apps Script URL configured." });
  }

  try {
    const upstream = await fetch(
      `${scriptUrl}?action=downloadArchive&file_id=${encodeURIComponent(fileId)}`
    );

    if (!upstream.ok) {
      return res.status(404).json({ error: "File not found or access denied." });
    }

    // Use the filename hint from the Apps Script response if available,
    // otherwise fall back to a generic name using the file ID
    const filename = upstream.headers.get("x-filename") || `archive_${fileId}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Read the full body and send it — Vercel functions don't support
    // Node.js stream piping the same way Express does
    const body = await upstream.text();
    res.send(body);

  } catch (err) {
    console.error("Archive download error:", err);
    res.status(502).json({ error: "Download failed." });
  }
}
