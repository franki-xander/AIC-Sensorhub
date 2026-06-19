// api/_utils/session.js
// Verifies the JWT Bearer token and returns the user payload.
// Used by every protected API function.
//
// Usage in a Vercel function:
//   const user = requireAuth(req, res);
//   if (!user) return; // response already sent
//   // use user.id and user.email

const jwt = require("jsonwebtoken");

function requireAuth(req, res) {
  const header = req.headers["authorization"] || "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "No access token provided." });
    return null;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return { id: payload.sub, email: payload.email };
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({ error: "Access token expired.", code: "TOKEN_EXPIRED" });
    } else {
      res.status(401).json({ error: "Invalid access token." });
    }
    return null;
  }
}

module.exports = { requireAuth };
