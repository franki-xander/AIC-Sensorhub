// api/auth/refresh.js
// Rotates the refresh token and issues a new access token.
// Called silently by the frontend whenever the access token expires.

import crypto from "crypto";
import db from "../_utils/db.js";
import {
  issueAccessToken,
  issueRefreshToken,
  setRefreshCookie,
  parseCookies,
} from "../_utils/auth-helpers.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const cookies = parseCookies(req);
  const raw     = cookies["refresh_token"];

  if (!raw) {
    return res.status(401).json({ error: "No refresh token." });
  }

  const hash = crypto.createHash("sha256").update(raw).digest("hex");

  try {
    // Delete the used token and return the user_id in one atomic operation.
    // If the token doesn't exist or is expired, rows will be empty.
    const result = await db.query(
      `DELETE FROM refresh_tokens
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [hash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Refresh token invalid or expired." });
    }

    const userId  = result.rows[0].user_id;
    const userRes = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user    = userRes.rows[0];

    if (!user) {
      return res.status(401).json({ error: "User not found." });
    }

    const newAccessToken  = issueAccessToken(user);
    const newRefreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, newRefreshToken);

    res.json({ access_token: newAccessToken });

  } catch (err) {
    console.error("Refresh error:", err);
    res.status(500).json({ error: "Token refresh failed." });
  }
}
