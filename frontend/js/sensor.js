// js/sensor.js — Per-sensor analytics page
// Reads ?id=<pageId> from the URL, fetches the page config from the backend,
// then dynamically renders one chart per visible data field.

// Chart colour palette — cycles if there are more fields than colours
const CHART_COLORS = [
  "#38bdf8", // sky blue
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f87171", // coral
  "#a78bfa", // violet
  "#fb923c", // orange
  "#22d3ee", // cyan
  "#e879f9", // fuchsia
];

const chartInstances = {}; // field → Chart instance
let activeHours = 48;
let pageConfig  = null;   // the sensor page record from the backend

document.addEventListener("DOMContentLoaded", async () => {

  // ── Auth guard ────────────────────────────────────────────────────────────
  const ok = await API.refreshToken();
  if (!ok) { API.redirectToLogin(); return; }

  document.getElementById("logout-btn")
    ?.addEventListener("click", () => API.logout());

  // ── Read page ID from URL ─────────────────────────────────────────────────
  const pageId = new URLSearchParams(window.location.search).get("id");
  if (!pageId) { window.location.href = "/dashboard"; return; }

  // ── Load page config from backend ─────────────────────────────────────────
  const pageRes = await API.get(`/api/pages`);
  if (!pageRes) return;
  const allPages = await pageRes.json();
  pageConfig = allPages.find(p => String(p.id) === String(pageId));

  if (!pageConfig) {
    document.getElementById("page-title").textContent = "Page not found";
    return;
  }

  document.getElementById("page-title").textContent    = pageConfig.display_name;
  document.getElementById("page-subtitle").textContent =
    `Sensor: ${pageConfig.sensor_id}${pageConfig.description ? " · " + pageConfig.description : ""}`;
  document.title = `${pageConfig.display_name} — AIC Sensorhub`;

  // ── Load initial data ─────────────────────────────────────────────────────
  await fetchAndRender(activeHours);
  await fetchConfig();

  // ── Time window buttons ───────────────────────────────────────────────────
  document.querySelectorAll("[data-window]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-window]").forEach(b => b.classList.remove("btn-active"));
      btn.classList.add("btn-active");
      activeHours = parseInt(btn.dataset.window);
      fetchAndRender(activeHours);
    });
  });

  // ── Interval form ─────────────────────────────────────────────────────────
  document.getElementById("interval-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = document.getElementById("interval-input").value;
    const res   = await API.get(
      `/api/data?action=setInterval&sensor_id=${encodeURIComponent(pageConfig.sensor_id)}&value=${value}`
    );
    if (res?.ok) {
      document.getElementById("current-interval").textContent = value;
      showToast(`Interval set to ${value} min.`, "success");
    } else {
      showToast("Failed to update interval.", "error");
    }
  });

  // ── Auto-refresh every 30 seconds ─────────────────────────────────────────
  setInterval(() => {
    fetchAndRender(activeHours);
    fetchConfig();
  }, 30000);
});

// =============================================================================
// DATA FETCHING
// =============================================================================
async function fetchConfig() {
  if (!pageConfig) return;
  const res  = await API.get(`/api/data?action=getConfig&sensor_id=${encodeURIComponent(pageConfig.sensor_id)}`);
  if (!res) return;
  const data = await res.json();

  const intervalEl = document.getElementById("current-interval");
  if (intervalEl && data.command_interval) intervalEl.textContent = data.command_interval;
}

async function fetchAndRender(hours) {
  if (!pageConfig) return;

  // Build fields param if page has a field filter
  const fieldsParam = Array.isArray(pageConfig.visible_fields) && pageConfig.visible_fields.length > 0
    ? `&fields=${pageConfig.visible_fields.map(encodeURIComponent).join(",")}`
    : "";

  const res = await API.get(
    `/api/data?action=getData&sensor_id=${encodeURIComponent(pageConfig.sensor_id)}&hours=${hours}${fieldsParam}`
  );
  if (!res) return;
  const rows = await res.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    updateHeader(null);
    return;
  }

  // Sort chronologically
  rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const latest = rows[rows.length - 1];
  updateHeader(latest.timestamp);
  updateMetricCards(latest);

  // Determine which fields to chart (all numeric fields except timestamp)
  const allFields = Object.keys(latest).filter(k => k !== "timestamp" && typeof latest[k] === "number");
  const fields    = (Array.isArray(pageConfig.visible_fields) && pageConfig.visible_fields.length > 0)
    ? pageConfig.visible_fields.filter(f => allFields.includes(f))
    : allFields;

  ensureCharts(fields);

  const timestamps = rows.map(r => new Date(r.timestamp));
  fields.forEach(field => {
    const values = rows.map(r => r[field] ?? null);
    updateChart(field, timestamps, values);
  });

  // Update the dynamic metric cards for the latest reading
  renderMetricCards(latest, fields);
}

// =============================================================================
// UI: HEADER
// =============================================================================
function updateHeader(timestamp) {
  const latestEl = document.getElementById("latest-time");
  const dateEl   = document.getElementById("sync-date");
  const timeEl   = document.getElementById("sync-time");

  if (!timestamp) {
    if (latestEl) latestEl.textContent = "Last Sync: No data received yet";
    if (dateEl)   dateEl.textContent   = "--/--/----";
    if (timeEl)   timeEl.textContent   = "--:--:--";
    return;
  }

  const d = new Date(timestamp);
  if (latestEl) latestEl.textContent = `Last Sync: ${d.toLocaleString()}`;
  if (dateEl)   dateEl.textContent   = d.toLocaleDateString();
  if (timeEl)   timeEl.textContent   = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// =============================================================================
// UI: DYNAMIC METRIC CARDS (one per field, latest value)
// =============================================================================
function renderMetricCards(latest, fields) {
  const grid = document.getElementById("metrics-grid");
  // Remove previous field cards, keep only date/time cards
  grid.querySelectorAll("[data-field-card]").forEach(el => el.remove());

  fields.forEach((field, idx) => {
    const val   = latest[field];
    const color = CHART_COLORS[idx % CHART_COLORS.length];
    const card  = document.createElement("div");
    card.className = "metric-card";
    card.setAttribute("data-field-card", field);
    card.innerHTML = `
      <div class="metric-card__label">${escHtml(field)}</div>
      <div class="metric-card__value" style="color:${color};">${
        typeof val === "number" ? val.toFixed(2) : escHtml(String(val))
      }</div>
    `;
    grid.appendChild(card);
  });
}

function updateMetricCards(latest) {
  // Called each refresh cycle; if cards exist, update the values in-place
  document.querySelectorAll("[data-field-card]").forEach(card => {
    const field   = card.getAttribute("data-field-card");
    const valEl   = card.querySelector(".metric-card__value");
    const val     = latest[field];
    if (valEl && val !== undefined) {
      valEl.textContent = typeof val === "number" ? val.toFixed(2) : String(val);
    }
  });
}

// =============================================================================
// CHARTS
// =============================================================================
function ensureCharts(fields) {
  const container = document.getElementById("charts-container");

  // Remove charts for fields that are no longer in the list
  Object.keys(chartInstances).forEach(field => {
    if (!fields.includes(field)) {
      chartInstances[field].destroy();
      delete chartInstances[field];
      document.getElementById(`chart-wrap-${CSS.escape(field)}`)?.remove();
    }
  });

  // Add chart cards for new fields
  fields.forEach((field, idx) => {
    if (chartInstances[field]) return; // already exists

    const color = CHART_COLORS[idx % CHART_COLORS.length];
    const card  = document.createElement("div");
    card.className = "chart-card";
    card.id        = `chart-wrap-${field}`;
    card.innerHTML = `
      <div class="chart-card__title" style="color:${color};">${escHtml(field)}</div>
      <div class="chart-wrap">
        <canvas id="chart-${field}"></canvas>
      </div>
    `;
    container.appendChild(card);

    const ctx = document.getElementById(`chart-${field}`).getContext("2d");
    chartInstances[field] = new Chart(ctx, {
      type: "line",
      data: {
        labels:   [],
        datasets: [{
          data:        [],
          borderColor: color,
          tension:     0.3,
          pointRadius: 1,
          borderWidth: 2,
          fill:        false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: { type: "time", grid: { color: "#1c2a42" }, ticks: { color: "#7b90b2" } },
          y: { grid: { color: "#1c2a42" }, ticks: { color: "#7b90b2" } },
        },
        plugins: { legend: { display: false } },
      },
    });
  });
}

function updateChart(field, labels, values) {
  const chart = chartInstances[field];
  if (!chart) return;
  chart.data.labels                = labels;
  chart.data.datasets[0].data     = values;
  chart.update("none"); // suppress animation on live refresh
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
