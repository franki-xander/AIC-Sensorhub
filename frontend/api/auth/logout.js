// api/auth/logout.js
// Invalidates the refresh token and clears the cookie.

import crypto from "crypto";
import { db } from "../_utils/db.js";
import { clearRefreshCookie, parseCookies } from "../_utils/auth-helpers.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const cookies = parseCookies(req);
  const raw     = cookies["refresh_token"];

  if (raw) {
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    // Best-effort deletion — don't fail the logout if this errors
    await db.query("DELETE FROM refresh_tokens WHERE token_hash = $1", [hash]).catch(() => {});
  }

  clearRefreshCookie(res);
  res.json({ ok: true });
}
