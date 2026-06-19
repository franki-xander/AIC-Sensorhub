// js/app.js — Global config and authenticated API client
// BACKEND_URL is empty because API functions are now on the same
// Vercel domain as the frontend (/api/...).

const CONFIG = {
  BACKEND_URL: "", // leave empty — API is served from the same domain
};

// =============================================================================
// TOKEN MANAGEMENT
// Access tokens live in memory only (never localStorage/sessionStorage).
// They are re-issued from the HTTP-only refresh token cookie automatically.
// =============================================================================
let _accessToken = null;

function setAccessToken(token) { _accessToken = token; }
function clearAccessToken()    { _accessToken = null; }

// Parse token from URL fragment after OAuth redirect (#token=...)
function consumeTokenFromFragment() {
  const hash = window.location.hash;
  if (!hash.startsWith("#token=")) return null;
  const token = hash.slice(7);
  // Remove the fragment from the URL immediately so it isn't bookmarked
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return token;
}

// =============================================================================
// API CLIENT
// All paths are relative (e.g. "/api/data") — same domain, no CORS needed.
// =============================================================================
const API = {
  async _fetch(path, options = {}, isRetry = false) {
    const url     = CONFIG.BACKEND_URL + path;
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };

    if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

    const res = await fetch(url, { ...options, headers, credentials: "include" });

    // Token expired — attempt a silent refresh then retry once
    if (res.status === 401 && !isRetry) {
      const refreshed = await API.refreshToken();
      if (refreshed) return API._fetch(path, options, true);
      API.redirectToLogin();
      return null;
    }

    return res;
  },

  async get(path)         { return API._fetch(path, { method: "GET" }); },
  async post(path, body)  { return API._fetch(path, { method: "POST",   body: JSON.stringify(body) }); },
  async patch(path, body) { return API._fetch(path, { method: "PATCH",  body: JSON.stringify(body) }); },
  async del(path)         { return API._fetch(path, { method: "DELETE" }); },

  async refreshToken() {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST", credentials: "include",
      });
      if (!res.ok) return false;
      const data = await res.json();
      setAccessToken(data.access_token);
      return true;
    } catch { return false; }
  },

  async logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    clearAccessToken();
    window.location.href = "/";
  },

  redirectToLogin() {
    clearAccessToken();
    window.location.href = "/?session_expired=1";
  },
};

// =============================================================================
// SHARED UI UTILITIES
// =============================================================================

// Close all open card menus when clicking elsewhere on the page
let _openMenu = null;
document.addEventListener("click", () => {
  if (_openMenu) { _openMenu.classList.remove("is-open"); _openMenu = null; }
});

function toggleCardMenu(menuEl, e) {
  e.preventDefault(); e.stopPropagation();
  const isOpen = menuEl.classList.contains("is-open");
  if (_openMenu) { _openMenu.classList.remove("is-open"); }
  if (!isOpen)   { menuEl.classList.add("is-open"); _openMenu = menuEl; }
  else           { _openMenu = null; }
}

// Modal open/close helpers
function openModal(overlayId) {
  document.getElementById(overlayId)?.classList.remove("hidden");
}
function closeModal(overlayId) {
  document.getElementById(overlayId)?.classList.add("hidden");
}

// Wire close buttons and backdrop clicks globally
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-close-modal]");
  if (btn) closeModal(btn.dataset.closeModal);
  if (e.target.classList.contains("modal-overlay")) e.target.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay:not(.hidden)")
      .forEach(m => m.classList.add("hidden"));
  }
});

// Copy-to-clipboard for code blocks
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".code-block__copy");
  if (!btn) return;
  const code = btn.closest(".code-block").textContent.replace("Copy", "").trim();
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
});

// Toast notifications
function showToast(message, type = "info") {
  const existing = document.getElementById("sh-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "sh-toast";
  toast.textContent = message;

  const colors = { error: "var(--danger)", success: "var(--success)", info: "var(--accent)" };
  Object.assign(toast.style, {
    position:     "fixed",
    bottom:       "1.5rem",
    right:        "1.5rem",
    background:   colors[type] || colors.info,
    color:        "#0b1120",
    padding:      "0.65rem 1.1rem",
    borderRadius: "8px",
    fontWeight:   "600",
    fontSize:     "0.875rem",
    zIndex:       "200",
    boxShadow:    "0 4px 20px rgba(0,0,0,0.4)",
  });

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
