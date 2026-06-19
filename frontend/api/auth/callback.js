// api/auth/callback.js
// Google redirects here after the user authorises.
// Exchanges the authorisation code for user info, upserts the user
// in the database, and redirects to the frontend with an access token
// in the URL fragment.

import db from "../_utils/db.js";
import {
  issueAccessToken,
  issueRefreshToken,
  setRefreshCookie,
} from "../_utils/auth-helpers.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect("/?error=oauth_failed");
  }

  try {
    // ── Step 1: Exchange authorisation code for tokens ──────────────────────
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  process.env.GOOGLE_CALLBACK_URL,
        grant_type:    "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.access_token) {
      console.error("Token exchange failed:", tokens);
      return res.redirect("/?error=token_exchange_failed");
    }

    // ── Step 2: Fetch user profile from Google ──────────────────────────────
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const profile = await profileRes.json();
    if (!profile.id || !profile.email) {
      return res.redirect("/?error=profile_fetch_failed");
    }

    // ── Step 3: Upsert user in database ────────────────────────────────────
    const result = await db.query(
      `INSERT INTO users (email, display_name, google_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (google_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             email        = EXCLUDED.email
       RETURNING *`,
      [profile.email, profile.name, profile.id]
    );

    const user = result.rows[0];

    // ── Step 4: Issue session tokens ────────────────────────────────────────
    const accessToken  = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);

    // ── Step 5: Redirect to the correct frontend page ───────────────────────
    const dest = user.account_status === "pending_setup" ? "/setup" : "/dashboard";
    res.redirect(`${dest}#token=${accessToken}`);

  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect("/?error=server_error");
  }
}
