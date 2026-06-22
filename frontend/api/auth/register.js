// api/auth/register.js
import bcrypt from "bcrypt";
import { db } from "../_utils/db.js";
import { issueAccessToken, issueRefreshToken, setRefreshCookie } from "../_utils/auth-helpers.js"; // adjust path/names if needed

export default async function handler(req, res) {
  // Enforce POST method
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { email, password, display_name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const hash   = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3) RETURNING *`,
      [email, display_name || email.split("@")[0], hash]
    );
    const user         = result.rows[0];
    const accessToken  = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    res.json({ access_token: accessToken, status: user.account_status });
  } catch (err) {
    if (err.code === "23505") { // unique violation
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
}