// js/archive.js — Archive page logic

document.addEventListener("DOMContentLoaded", async () => {

  // ── Auth guard ────────────────────────────────────────────────────────────
  const ok = await API.refreshToken();
  if (!ok) { API.redirectToLogin(); return; }

  document.getElementById("logout-btn")
    ?.addEventListener("click", () => API.logout());

  // ── Elements ──────────────────────────────────────────────────────────────
  const generateBtn       = document.getElementById("generate-btn");
  const generatePanel     = document.getElementById("generate-panel");
  const cancelBtn         = document.getElementById("cancel-generate-btn");
  const runBtn            = document.getElementById("run-generate-btn");
  const tableBody         = document.getElementById("archive-table-body");
  const excludeList       = document.getElementById("sensor-exclude-list");
  const fromDateInput     = document.getElementById("from-date-input");
  const generateError     = document.getElementById("generate-error");
  const generateSuccess   = document.getElementById("generate-success");

  // Set default date to today for the from-date input
  fromDateInput.value = new Date().toISOString().split("T")[0];

  // ── Toggle generate panel ─────────────────────────────────────────────────
  generateBtn.addEventListener("click", () => {
    generatePanel.style.display = "block";
    generateBtn.style.display   = "none";
    loadSensorExcludeList();
    generateError.classList.add("hidden");
    generateSuccess.classList.add("hidden");
  });

  cancelBtn.addEventListener("click", () => {
    generatePanel.style.display = "none";
    generateBtn.style.display   = "";
  });

  // ── Radio group: mode selection ───────────────────────────────────────────
  document.querySelectorAll("input[name='archive-mode']").forEach(radio => {
    radio.addEventListener("change", () => {
      // Update selected styling
      document.querySelectorAll(".radio-option").forEach(el => el.classList.remove("is-selected"));
      radio.closest(".radio-option").classList.add("is-selected");
      // Enable/disable date input
      fromDateInput.disabled = radio.value !== "from_date";
    });
  });

  // ── Load sensor list for exclusion checkboxes ─────────────────────────────
  let allSensorIds = [];

  async function loadSensorExcludeList() {
    excludeList.innerHTML = `<span class="text-muted text-sm">Loading...</span>`;
    try {
      const res = await API.get("/api?action=getSensorIds");
      allSensorIds = await res.json();

      if (!Array.isArray(allSensorIds) || allSensorIds.length === 0) {
        excludeList.innerHTML = `<span class="text-muted text-sm">No sensors found in your sheet yet.</span>`;
        return;
      }

      excludeList.innerHTML = "";
      allSensorIds.forEach(id => {
        const label = document.createElement("label");
        label.style.cssText = "display:flex; align-items:center; gap:0.4rem; cursor:pointer; font-size:0.875rem;";
        label.innerHTML = `
          <input type="checkbox" value="${escHtml(id)}" checked
                 style="accent-color:var(--accent); width:15px; height:15px;">
          ${escHtml(id)}
        `;
        excludeList.appendChild(label);
      });
    } catch {
      excludeList.innerHTML = `<span class="text-muted text-sm">Could not load sensor list.</span>`;
    }
  }

  // ── Run archive generation ─────────────────────────────────────────────────
  runBtn.addEventListener("click", async () => {
    generateError.classList.add("hidden");
    generateSuccess.classList.add("hidden");

    const mode = document.querySelector("input[name='archive-mode']:checked")?.value || "incremental";
    const fromDate = mode === "from_date" ? fromDateInput.value : undefined;

    if (mode === "from_date" && !fromDate) {
      generateError.textContent = "Please select a start date.";
      generateError.classList.remove("hidden");
      return;
    }

    // Collect unchecked sensors as the exclusion list
    const excludeSensors = [...excludeList.querySelectorAll("input[type=checkbox]")]
      .filter(cb => !cb.checked)
      .map(cb => cb.value);

    runBtn.disabled    = true;
    runBtn.textContent = "Generating...";

    const res  = await API.post("/api/archives/generate", { mode, from_date: fromDate, exclude_sensors: excludeSensors });
    const data = await res.json();

    runBtn.disabled    = false;
    runBtn.textContent = "Run Archive";

    if (!res.ok) {
      generateError.textContent = data.error || "Archive generation failed.";
      generateError.classList.remove("hidden");
      return;
    }

    generateSuccess.textContent = data.summary || "Archive generation complete.";
    generateSuccess.classList.remove("hidden");

    // Reload the table to show the new files
    await loadArchiveTable();
  });

  // ── Load and render archive table ─────────────────────────────────────────
  async function loadArchiveTable() {
    tableBody.innerHTML = `
      <tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:2rem 0;">
        Loading...
      </td></tr>`;

    try {
      const res   = await API.get("/api/archives");
      const files = await res.json();

      if (!Array.isArray(files) || files.length === 0) {
        tableBody.innerHTML = `
          <tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:3rem 0;">
            No archive files yet. Click "Generate New Archive" to create your first one.
          </td></tr>`;
        return;
      }

      tableBody.innerHTML = "";
      files.forEach(file => {
        const row = document.createElement("tr");
        const created = file.created_at ? new Date(file.created_at).toLocaleString() : "—";
        row.innerHTML = `
          <td style="font-family:var(--font-mono); font-size:0.8rem;">${escHtml(file.name)}</td>
          <td><span class="badge badge--online" style="font-size:0.7rem;">${escHtml(file.sensor_id || "—")}</span></td>
          <td style="color:var(--text-muted);">${escHtml(file.size)}</td>
          <td style="color:var(--text-muted); font-size:0.85rem;">${escHtml(created)}</td>
          <td style="text-align:right;">
            <button class="btn" data-file-id="${escHtml(file.id)}" data-file-name="${escHtml(file.name)}">
              Download
            </button>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Wire download buttons — streams through the backend proxy
      tableBody.querySelectorAll("button[data-file-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const fileId   = btn.dataset.fileId;
          const fileName = btn.dataset.fileName;

          btn.disabled    = true;
          btn.textContent = "Downloading...";

          try {
            // Use raw fetch with credentials so the auth cookie is sent
            const res = await fetch(
              `${CONFIG.BACKEND_URL}/api/archives/download/${encodeURIComponent(fileId)}`,
              { credentials: "include", headers: _accessToken ? { Authorization: `Bearer ${_accessToken}` } : {} }
            );

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href     = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } catch (err) {
            showToast("Download failed: " + err.message, "error");
          } finally {
            btn.disabled    = false;
            btn.textContent = "Download";
          }
        });
      });

    } catch (err) {
      tableBody.innerHTML = `
        <tr><td colspan="5" style="text-align:center; color:var(--danger); padding:2rem 0;">
          Could not load archives. Check your connection.
        </td></tr>`;
    }
  }

  // ── Initial load ──────────────────────────────────────────────────────────
  await loadArchiveTable();
});

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
