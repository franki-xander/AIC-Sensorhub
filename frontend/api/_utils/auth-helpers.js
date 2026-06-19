// api/_utils/auth-helpers.js
// Shared helpers used by login, register, OAuth callback, and refresh endpoints.

const jwt    = require("jsonwebtoken");
const crypto = require("crypto");
const db     = require("./db");

const ACCESS_TOKEN_TTL  = "15m";
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

// Sign a short-lived JWT access token for a user row
function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

// Generate a random refresh token, store its hash in the DB, return the raw value
async function issueRefreshToken(userId) {
  const raw  = crypto.randomBytes(48).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const exp  = new Date(Date.now() + REFRESH_TOKEN_TTL);
  await db.query(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, hash, exp]
  );
  return raw;
}

// Set the refresh token as an HTTP-only cookie
// Path is /api/auth/refresh so the cookie is only sent to that endpoint
function setRefreshCookie(res, token) {
  const cookieOptions = [
    `refresh_token=${token}`,
    `Path=/api/auth/refresh`,
    `Max-Age=${REFRESH_TOKEN_TTL / 1000}`,
    `HttpOnly`,
    `SameSite=Strict`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ].filter(Boolean).join("; ");

  res.setHeader("Set-Cookie", cookieOptions);
}

// Clear the refresh cookie on logout
function clearRefreshCookie(res) {
  res.setHeader("Set-Cookie",
    "refresh_token=; Path=/api/auth/refresh; Max-Age=0; HttpOnly; SameSite=Strict"
  );
}

// Parse cookies from the raw Cookie header string
function parseCookies(req) {
  const raw = req.headers["cookie"] || "";
  return Object.fromEntries(
    raw.split(";").map(c => c.trim().split("=").map(decodeURIComponent))
  );
}

module.exports = {
  issueAccessToken,
  issueRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  parseCookies,
  REFRESH_TOKEN_TTL,
};
