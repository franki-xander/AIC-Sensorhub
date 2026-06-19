
// POST /auth/refresh
// Reads the HTTP-only cookie and issues a new access token + rotated refresh token
router.post("/refresh", async (req, res) => {
  const raw = req.cookies?.refresh_token;
  if (!raw) return res.status(401).json({ error: "No refresh token." });

  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  try {
    const result = await db.query(
      `DELETE FROM refresh_tokens
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [hash]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Refresh token invalid or expired." });
    }

    const userId    = result.rows[0].user_id;
    const userRes   = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user      = userRes.rows[0];
    const newAccess = issueAccessToken(user);
    const newRefresh = await issueRefreshToken(user.id);
    setRefreshCookie(res, newRefresh);
    res.json({ access_token: newAccess });
  } catch (err) {
    console.error("Refresh error:", err);
    res.status(500).json({ error: "Token refresh failed." });
  }
});
