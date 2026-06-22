// js/setup.js — Drives the 5-step onboarding wizard on setup.html

// The actual Apps Script code displayed in Step 2 is fetched from the server
// so it always matches the deployed Code.gs exactly.
// At the top of setup.js — remove the entire APPS_SCRIPT_CODE = `...` block
// and replace with this:

async function loadAppsScriptCode() {
  const codeBlock = document.getElementById("apps-script-code");
  if (!codeBlock) return;

  try {
    const res  = await fetch(
      "https://raw.githubusercontent.com/franki-xander/AIC-Sensorhub/main/apps-script/Code.gs"
    );
    const code = await res.text();

    codeBlock.insertBefore(
      document.createTextNode(code),
      codeBlock.querySelector(".code-block__copy")
    );
  } catch {
    codeBlock.insertBefore(
      document.createTextNode("Could not load script. Download Code.gs directly from the GitHub repository."),
      codeBlock.querySelector(".code-block__copy")
    );
  }
}
document.addEventListener("DOMContentLoaded", async () => {

  // ── Guard: must be authenticated ─────────────────────────────────────────
  const ok = await API.refreshToken();
  if (!ok) { API.redirectToLogin(); return; }

  document.getElementById("logout-btn")
    ?.addEventListener("click", () => API.logout());

  loadAppsScriptCode();

  // ── Step 3: Verify connection ─────────────────────────────────────────────
  const verifyBtn     = document.getElementById("verify-btn");
  const setupError    = document.getElementById("setup-error");
  const setupSuccess  = document.getElementById("setup-success");
  const scriptInput   = document.getElementById("script-url-input");
  const driveInput    = document.getElementById("drive-folder-input");
  const fwScriptIdEl  = document.getElementById("fw-script-id");

  function showError(msg)   { setupError.textContent = msg; setupError.classList.remove("hidden"); setupSuccess.classList.add("hidden"); }
  function showSuccess(msg) { setupSuccess.textContent = msg; setupSuccess.classList.remove("hidden"); setupError.classList.add("hidden"); }

  // Live-extract Script ID from URL input to show in Step 4 firmware config
  scriptInput?.addEventListener("input", () => {
    const url   = scriptInput.value.trim();
    const match = url.match(/\/macros\/s\/([^/]+)\/exec/);
    if (fwScriptIdEl) {
      fwScriptIdEl.textContent = match ? `"${match[1]}"` : "— paste your Script URL first —";
    }
  });

  verifyBtn?.addEventListener("click", async () => {
    const scriptUrl    = scriptInput.value.trim();
    const driveFolderId = driveInput.value.trim();

    setupError.classList.add("hidden");
    setupSuccess.classList.add("hidden");

    if (!scriptUrl) { showError("Please paste your Web App URL."); return; }
    if (!scriptUrl.includes("script.google.com/macros/s/")) {
      showError("That doesn't look like a Google Apps Script URL. It should contain /macros/s/"); return;
    }

    verifyBtn.disabled    = true;
    verifyBtn.textContent = "Verifying...";

    const res  = await API.post("/api/account.js", { script_url: scriptUrl, drive_folder_id: driveFolderId || null });
    const data = await res.json();

    verifyBtn.disabled    = false;
    verifyBtn.textContent = "Verify Connection";

    if (!res.ok) {
      showError(data.error || "Verification failed. Check the URL and try again.");
      return;
    }

    showSuccess("Connection verified! Your Google Sheet is linked.");
    document.getElementById("step-3").classList.add("is-complete");

    // Unlock step 4
    document.getElementById("step-4").classList.remove("is-locked");

    // Begin polling for first data (Step 5)
    startFirstDataPolling();
  });

  // ── Step 5: Poll for first sensor reading ─────────────────────────────────
  function startFirstDataPolling() {
    const indicator   = document.getElementById("waiting-indicator");
    const successEl   = document.getElementById("first-data-success");
    let pollCount     = 0;

    const interval = setInterval(async () => {
      pollCount++;
      if (indicator) indicator.textContent = `Checking for data... (attempt ${pollCount})`;

      const res  = await API.get("/api/data?action=getSensorIds");
      if (!res) return;
      const ids = await res.json();

      if (Array.isArray(ids) && ids.length > 0) {
        clearInterval(interval);
        if (indicator)  indicator.classList.add("hidden");
        if (successEl)  successEl.classList.remove("hidden");
        document.getElementById("step-5").classList.add("is-complete");
      }
    }, 10000);
  }

  // ── Check if account is already set up (re-setup flow) ───────────────────
  const accountRes  = await API.get("/api/account");
  const accountData = await accountRes.json();

  if (accountData.account_status === "active") {
    // Pre-fill a note that they're changing an existing connection
    if (setupSuccess) {
      setupSuccess.textContent = "You have an existing connection. Submitting a new URL will replace it.";
      setupSuccess.classList.remove("hidden");
    }
  }
});
