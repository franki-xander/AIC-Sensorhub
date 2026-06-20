// api/auth/login.js
// Authenticates an email/password user and issues session tokens.

import bcrypt from "bcrypt";
import { db } from "../_utils/db.js";
import {
  issueAccessToken,
  issueRefreshToken,
  setRefreshCookie,
} from "../_utils/auth-helpers.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    const user   = result.rows[0];

    // Generic error — don't reveal whether the email exists
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const accessToken  = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);

    res.json({ access_token: accessToken, status: user.account_status });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
}
