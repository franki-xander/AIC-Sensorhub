// js/dashboard.js — Fleet dashboard logic

document.addEventListener("DOMContentLoaded", async () => {

  // ── Auth guard ────────────────────────────────────────────────────────────
  const ok = await API.refreshToken();
  if (!ok) { API.redirectToLogin(); return; }

  document.getElementById("logout-btn")
    ?.addEventListener("click", () => API.logout());

  // ── Load account info ─────────────────────────────────────────────────────
  const accountRes  = await API.get("/api/account");
  if (!accountRes) return;
  const account     = await accountRes.json();

  if (account.account_status === "pending_setup") {
    window.location.href = "/setup"; return;
  }

  const greetingEl = document.getElementById("user-greeting");
  if (greetingEl) greetingEl.textContent =
    `Welcome back${account.display_name ? ", " + account.display_name : ""}. Showing all your sensor pages.`;

  // ── Load sensor pages from the backend ───────────────────────────────────
  let sensorPages = [];

  async function loadPages() {
    const res   = await API.get("/api/pages");
    if (!res) return;
    sensorPages = await res.json();
    renderGrid();
  }

  // ── Render the fleet grid ─────────────────────────────────────────────────
  const grid       = document.getElementById("fleet-grid");
  const emptyState = document.getElementById("empty-state");

  function renderGrid() {
    grid.innerHTML = "";

    if (sensorPages.length === 0) {
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    sensorPages.forEach(page => grid.appendChild(buildCard(page)));
  }

  function buildCard(page) {
    const card = document.createElement("a");
    card.className = "card";
    card.href      = `/sensor?id=${page.id}`;
    card.setAttribute("data-page-id", page.id);

    const fieldSummary = Array.isArray(page.visible_fields) && page.visible_fields.length > 0
      ? page.visible_fields.join(", ")
      : "All fields";

    card.innerHTML = `
      <div class="card__title">${escHtml(page.display_name)}</div>
      <div class="card__subtitle">${escHtml(page.description || page.sensor_id)}</div>
      <div style="font-size:0.78rem; color:var(--text-dim); margin-bottom:0.75rem;">
        <span style="color:var(--text-muted);">Sensor:</span> ${escHtml(page.sensor_id)} &nbsp;·&nbsp;
        <span style="color:var(--text-muted);">Fields:</span> ${escHtml(fieldSummary)}
      </div>
      <div class="card__footer latest-sync-time">Synchronizing...</div>
    `;

    // ── 3-dot menu ──────────────────────────────────────────────────────────
    const menu     = document.createElement("div");
    menu.className = "card-menu";

    const trigger   = document.createElement("button");
    trigger.className = "card-menu__trigger";
    trigger.setAttribute("aria-label", "Page options");
    trigger.innerHTML = "&#8942;";
    trigger.addEventListener("click", (e) => { e.preventDefault(); toggleCardMenu(menu, e); });

    const dropdown = document.createElement("div");
    dropdown.className = "card-menu__dropdown";

    const editItem = document.createElement("button");
    editItem.className = "card-menu__item";
    editItem.innerHTML = "✎ &nbsp;Edit";
    editItem.addEventListener("click", (e) => { e.preventDefault(); openEditModal(page); });

    const deleteItem = document.createElement("button");
    deleteItem.className = "card-menu__item card-menu__item--danger";
    deleteItem.innerHTML = "✕ &nbsp;Delete";
    deleteItem.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!confirm(`Delete "${page.display_name}"? This only removes the dashboard page — your Sheet data is untouched.`)) return;
      const res = await API.del(`/api?id=${page.id}`);
      if (res?.ok) { showToast("Page deleted.", "info"); await loadPages(); }
      else showToast("Delete failed.", "error");
    });

    dropdown.appendChild(editItem);
    dropdown.appendChild(deleteItem);
    menu.appendChild(trigger);
    menu.appendChild(dropdown);
    card.appendChild(menu);

    return card;
  }

  // ── Poll last-updated timestamps for each card ────────────────────────────
  async function pollTimestamps() {
    for (const page of sensorPages) {
      const card  = grid.querySelector(`[data-page-id="${page.id}"]`);
      const label = card?.querySelector(".latest-sync-time");
      if (!label) continue;
      try {
        const res  = await API.get(`/api/data?action=getConfig&sensor_id=${encodeURIComponent(page.sensor_id)}`);
        const data = await res.json();
        label.textContent = data.latest_reading && data.latest_reading !== "No data available"
          ? `Last updated: ${new Date(data.latest_reading).toLocaleString()}`
          : "No data received yet";
      } catch { label.textContent = "Could not reach sheet"; }
    }
  }

  // ── MODAL: shared Add / Edit ──────────────────────────────────────────────
  const overlay       = document.getElementById("page-modal-overlay");
  const modalTitle    = document.getElementById("page-modal-title");
  const sensorSelect  = document.getElementById("modal-sensor-select");
  const nameInput     = document.getElementById("modal-name-input");
  const descInput     = document.getElementById("modal-desc-input");
  const fieldPicker   = document.getElementById("modal-field-picker");
  const modalError    = document.getElementById("modal-error");
  const saveBtn       = document.getElementById("modal-save-btn");

  let editingPage = null;  // null = Add mode, object = Edit mode
  let allSensorIds = [];
  let selectedFields = new Set();

  // Load sensor IDs from the sheet (called when modal opens)
  async function loadSensorIds() {
    sensorSelect.innerHTML = `<option value="" disabled selected>Loading...</option>`;
    try {
      const res  = await API.get("/api/data?action=getSensorIds");
      const ids  = await res.json();
      allSensorIds = Array.isArray(ids) ? ids : [];
      sensorSelect.innerHTML = `<option value="" disabled>Select a sensor…</option>`;
      allSensorIds.forEach(id => {
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = id;
        sensorSelect.appendChild(opt);
      });
    } catch {
      sensorSelect.innerHTML = `<option value="" disabled selected>Could not load sensors</option>`;
    }
  }

  // Load field names for the chosen sensor and render chips
  async function loadFields(sensorId, preselected = null) {
    fieldPicker.innerHTML = `<span class="text-muted text-sm">Loading fields...</span>`;
    selectedFields = new Set(preselected || []);
    try {
      const res    = await API.get(`/api/data?action=getFields&sensor_id=${encodeURIComponent(sensorId)}`);
      const fields = await res.json();
      if (!Array.isArray(fields) || fields.length === 0) {
        fieldPicker.innerHTML = `<span class="text-muted text-sm">No data fields found yet for this sensor.</span>`;
        return;
      }
      fieldPicker.innerHTML = "";
      fields.forEach(field => {
        const chip = document.createElement("span");
        chip.className  = "field-chip" + (selectedFields.has(field) ? " is-selected" : "");
        chip.textContent = field;
        chip.addEventListener("click", () => {
          if (selectedFields.has(field)) { selectedFields.delete(field); chip.classList.remove("is-selected"); }
          else                           { selectedFields.add(field);    chip.classList.add("is-selected"); }
        });
        fieldPicker.appendChild(chip);
      });
      // "All fields" chip
      const allChip = document.createElement("span");
      allChip.className   = "field-chip" + (selectedFields.size === 0 ? " is-selected" : "");
      allChip.textContent  = "All fields";
      allChip.style.order  = "-1";
      allChip.addEventListener("click", () => {
        selectedFields.clear();
        fieldPicker.querySelectorAll(".field-chip").forEach(c => c.classList.remove("is-selected"));
        allChip.classList.add("is-selected");
      });
      fieldPicker.prepend(allChip);
    } catch {
      fieldPicker.innerHTML = `<span class="text-muted text-sm">Could not load fields.</span>`;
    }
  }

  sensorSelect.addEventListener("change", () => {
    if (sensorSelect.value) loadFields(sensorSelect.value);
  });

  function openAddModal() {
    editingPage       = null;
    modalTitle.textContent = "Add Sensor Page";
    saveBtn.textContent    = "Save Page";
    nameInput.value        = "";
    descInput.value        = "";
    fieldPicker.innerHTML  = `<span class="text-muted text-sm">Select a Sensor ID first to load fields.</span>`;
    modalError.classList.add("hidden");
    loadSensorIds();
    openModal("page-modal-overlay");
    nameInput.focus();
  }

  function openEditModal(page) {
    editingPage            = page;
    modalTitle.textContent = "Edit Sensor Page";
    saveBtn.textContent    = "Save Changes";
    nameInput.value        = page.display_name;
    descInput.value        = page.description || "";
    modalError.classList.add("hidden");

    loadSensorIds().then(() => {
      sensorSelect.value = page.sensor_id;
      loadFields(page.sensor_id, page.visible_fields);
    });

    openModal("page-modal-overlay");
    nameInput.focus();
  }

  document.getElementById("add-page-btn")?.addEventListener("click", openAddModal);

  saveBtn.addEventListener("click", async () => {
    const sensorId   = sensorSelect.value;
    const name       = nameInput.value.trim();
    const desc       = descInput.value.trim();
    const fields     = selectedFields.size > 0 ? [...selectedFields] : null;

    modalError.classList.add("hidden");

    if (!sensorId) { modalError.textContent = "Please select a sensor.";    modalError.classList.remove("hidden"); return; }
    if (!name)     { modalError.textContent = "Display name is required.";  modalError.classList.remove("hidden"); return; }

    saveBtn.disabled    = true;
    saveBtn.textContent = "Saving...";

    let res;
    if (!editingPage) {
      res = await API.post("/api/pages", { sensor_id: sensorId, display_name: name, description: desc, visible_fields: fields });
    } else {
      res = await API.patch(`/api?id=${editingPage.id}`, { sensor_id: sensorId, display_name: name, description: desc, visible_fields: fields });
    }

    saveBtn.disabled    = false;
    saveBtn.textContent = editingPage ? "Save Changes" : "Save Page";

    if (!res?.ok) {
      const err = await res?.json();
      modalError.textContent = err?.error || "Save failed. Please try again.";
      modalError.classList.remove("hidden");
      return;
    }

    closeModal("page-modal-overlay");
    showToast(editingPage ? "Page updated." : "Sensor page added.", "success");
    await loadPages();
    pollTimestamps();
  });

  // ── Initial load + polling ────────────────────────────────────────────────
  await loadPages();
  await pollTimestamps();

  setInterval(pollTimestamps, 30000);
});

// Escape HTML to prevent XSS from user-supplied names/descriptions
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
