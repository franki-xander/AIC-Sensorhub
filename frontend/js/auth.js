// js/auth.js — Login page and registration page logic

document.addEventListener("DOMContentLoaded", async () => {

  // ── Consume OAuth token from URL fragment if present ──────────────────────
  const fragmentToken = consumeTokenFromFragment();
  if (fragmentToken) {
    setAccessToken(fragmentToken);
    const res  = await API.get("/api/account");
    const data = await res.json();
    window.location.href = data.account_status === "pending_setup" ? "/setup" : "/dashboard";
    return;
  }

  // ── Show session expired notice if redirected here ─────────────────────────
  if (new URLSearchParams(window.location.search).get("session_expired")) {
    document.getElementById("session-notice")?.classList.remove("hidden");
  }

  // ── Google OAuth button — points to our Vercel function ───────────────────

  const googleBtn = document.getElementById("google-btn");
  if (googleBtn) {
    // /api/auth/google redirects to Google's consent screen
    googleBtn.href = "/api/auth/google";
  }


  // ── Email/password login ──────────────────────────────────────────────────
  const loginBtn   = document.getElementById("login-btn");
  const loginError = document.getElementById("login-error");

  loginBtn?.addEventListener("click", async () => {
    const email    = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    loginError.classList.add("hidden");

    if (!email || !password) {
      loginError.textContent = "Please enter your email and password.";
      loginError.classList.remove("hidden");
      return;
    }

    loginBtn.disabled    = true;
    loginBtn.textContent = "Signing in...";

    const res  = await fetch("/api/auth/login", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ email, password }),
    });
    const data = await res.json();

    loginBtn.disabled    = false;
    loginBtn.textContent = "Sign In";

    if (!res.ok) {
      loginError.textContent = data.error || "Login failed.";
      loginError.classList.remove("hidden");
      return;
    }

    setAccessToken(data.access_token);
    window.location.href = data.status === "pending_setup" ? "/setup" : "/dashboard";
  });

  // Allow Enter key to submit on password field
  document.getElementById("login-password")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn?.click();
  });

  // ── Registration page ─────────────────────────────────────────────────────
  const registerBtn   = document.getElementById("register-btn");
  const registerError = document.getElementById("register-error");

  registerBtn?.addEventListener("click", async () => {
    const email    = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const name     = document.getElementById("reg-name").value.trim();
    registerError.classList.add("hidden");

    if (!email || !password) {
      registerError.textContent = "Email and password are required.";
      registerError.classList.remove("hidden");
      return;
    }

    registerBtn.disabled    = true;
    registerBtn.textContent = "Creating account...";

    const res  = await fetch("/api/auth/register", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ email, password, display_name: name }),
    });
    const data = await res.json();

    registerBtn.disabled    = false;
    registerBtn.textContent = "Create Account";

    if (!res.ok) {
      registerError.textContent = data.error || "Registration failed.";
      registerError.classList.remove("hidden");
      return;
    }

    setAccessToken(data.access_token);
    window.location.href = "/setup";
  });
});
