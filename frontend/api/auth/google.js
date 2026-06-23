// api/auth/google.js
export default async function handler(req, res) {
  // Enforce GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
    
    const isFallback = req.query.fallback === "true";

    const options = {
      redirect_uri: process.env.GOOGLE_CALLBACK_URL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      access_type: "offline",
      response_type: "code",
      prompt: isFallback ? "consent" : "none",
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/drive.readonly",      // Allows viewing Drive metadata/files
        "https://www.googleapis.com/auth/spreadsheets"          // Allows viewing and managing Sheets
      ].join(" "),
    };

  const qs = new URLSearchParams(options).toString();
    
    // Redirect the user directly to Google's OAuth screen
    return res.redirect(`${rootUrl}?${qs}`);
    
  } catch (error) {
    console.error("Google Auth Error:", error);
    return res.status(500).json({ error: error.message });
  }
}