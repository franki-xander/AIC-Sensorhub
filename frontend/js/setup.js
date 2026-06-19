// js/setup.js — Drives the 5-step onboarding wizard on setup.html

// The actual Apps Script code displayed in Step 2 is fetched from the server
// so it always matches the deployed Code.gs exactly.
const APPS_SCRIPT_CODE = `// AIC Sensorhub v3 — Google Apps Script
// Paste this entire file into your Apps Script editor, then deploy as a Web App.
// Extensions → Apps Script → Paste → Deploy → New Deployment
// Execute as: Me | Who has access: Anyone

const TELEMETRY_SHEET = "Telemetry";
const INTERVALS_SHEET = "Intervals";
const COL_TIMESTAMP = 1;
const COL_SENSOR_ID = 2;

function doGet(e) {
  const action = e.parameter.action;
  if (action === "ping") return text("PONG");
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === "getSensorIds") {
    const sheet = ss.getSheetByName(TELEMETRY_SHEET);
    const lastRow = sheet.getLastRow();
    const ids = new Set();
    if (lastRow > 1) {
      sheet.getRange(2, COL_SENSOR_ID, lastRow - 1, 1)
           .getValues().forEach(r => { if (r[0]) ids.add(r[0].toString().trim()); });
    }
    return json([...ids]);
  }

  if (action === "getFields") {
    const sheet = ss.getSheetByName(TELEMETRY_SHEET);
    const headers = getHeaders(sheet);
    return json(headers.slice(2).map(h => h.name));
  }

  if (action === "getData") {
    const sensorId = param(e, "sensor_id");
    const hours = parseInt(e.parameter.hours) || 48;
    const fields = e.parameter.fields ? e.parameter.fields.split(",") : null;
    const sheet = ss.getSheetByName(TELEMETRY_SHEET);
    const headers = getHeaders(sheet);
    const lastRow = sheet.getLastRow();
    const output = [];
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    if (lastRow > 1) {
      const startRow = Math.max(2, lastRow - 3000);
      const rows = sheet.getRange(startRow, 1, lastRow - startRow + 1, headers.length).getValues();
      rows.forEach(row => {
        const ts = row[COL_TIMESTAMP - 1];
        if (!ts || row[COL_SENSOR_ID - 1] !== sensorId) return;
        const rowDate = new Date(ts);
        if (rowDate < cutoff) return;
        const entry = { timestamp: rowDate.toISOString() };
        headers.slice(2).forEach((h, i) => {
          if (!fields || fields.includes(h.name)) entry[h.name] = row[i + 2];
        });
        output.push(entry);
      });
    }
    return json(output);
  }

  if (action === "getConfig") {
    const sensorId = param(e, "sensor_id") || param(e, "sensor");
    const iSheet = ss.getSheetByName(INTERVALS_SHEET);
    const tSheet = ss.getSheetByName(TELEMETRY_SHEET);
    let interval = 5, latestTs = null;
    if (iSheet) {
      const rows = iSheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === sensorId) { interval = parseInt(rows[i][1]) || 5; break; }
      }
    }
    if (tSheet) {
      const lastRow = tSheet.getLastRow();
      if (lastRow > 1) {
        const start = Math.max(2, lastRow - 200);
        const rows = tSheet.getRange(start, 1, lastRow - start + 1, 2).getValues();
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i][1] === sensorId) { latestTs = rows[i][0]; break; }
        }
      }
    }
    return json({ sensor_id: sensorId, command_interval: interval,
      latest_reading: latestTs ? new Date(latestTs).toISOString() : "No data available" });
  }

  if (action === "setInterval") {
    const sensorId = param(e, "sensor_id");
    const value = parseInt(e.parameter.value);
    const sheet = ss.getSheetByName(INTERVALS_SHEET);
    const rows = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === sensorId) { sheet.getRange(i + 1, 2).setValue(value); found = true; break; }
    }
    if (!found) sheet.appendRow([sensorId, value]);
    return json({ status: "updated", sensor_id: sensorId, interval: value });
  }

  if (action === "getArchives") {
    const folderId = e.parameter.folder_id ||
      PropertiesService.getScriptProperties().getProperty("ARCHIVE_FOLDER_ID");
    if (!folderId) return json([]);
    const folder = DriveApp.getFolderById(folderId);
    const iter = folder.getFiles();
    const output = [];
    while (iter.hasNext()) {
      const f = iter.next();
      output.push({ id: f.getId(), name: f.getName(),
        size: bytesToHuman(f.getSize()),
        created_at: f.getDateCreated().toISOString(),
        sensor_id: (f.getName().match(/^Telemetry_(.+?)_\\d{4}/) || [])[1] || null });
    }
    output.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return json(output);
  }

  if (action === "downloadArchive") {
    const file = DriveApp.getFileById(e.parameter.file_id);
    return ContentService.createTextOutput(file.getBlob().getDataAsString())
      .setMimeType(ContentService.MimeType.CSV);
  }

  if (action === "generateArchives") {
    const mode = e.parameter.mode || "incremental";
    const fromDate = e.parameter.from_date ? new Date(e.parameter.from_date) : null;
    const excluded = e.parameter.exclude_sensors ? e.parameter.exclude_sensors.split(",") : [];
    const folderId = e.parameter.folder_id ||
      PropertiesService.getScriptProperties().getProperty("ARCHIVE_FOLDER_ID");
    const result = generateArchives(ss, folderId, mode, fromDate, excluded);
    return json({ status: "ok", summary: result });
  }

  return json({ error: "Unknown action." });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sensorId = data.sensor_id;
    if (!sensorId) return text("ERROR: sensor_id missing");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, TELEMETRY_SHEET);
    const headers = getHeaders(sheet);
    const headerNames = headers.map(h => h.name);
    Object.keys(data).filter(k => k !== "sensor_id").forEach(field => {
      if (!headerNames.includes(field)) {
        const newCol = headers.length + 1;
        sheet.getRange(1, newCol).setValue(field);
        headers.push({ name: field, col: newCol });
        headerNames.push(field);
      }
    });
    const row = new Array(headers.length).fill("");
    row[COL_TIMESTAMP - 1] = new Date();
    row[COL_SENSOR_ID - 1] = sensorId;
    headers.slice(2).forEach((h, i) => { if (data[h.name] !== undefined) row[i + 2] = data[h.name]; });
    sheet.appendRow(row);
    return text("SUCCESS");
  } catch (err) { return text("ERROR: " + err.toString()); }
}

function generateArchives(ss, folderId, mode, fromDate, excludedSensors) {
  if (!folderId) return "No archive folder configured.";
  const sheet = ss.getSheetByName(TELEMETRY_SHEET);
  const folder = DriveApp.getFolderById(folderId);
  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "No data to archive.";
  const allRows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const groups = {};
  allRows.forEach(row => {
    const sid = row[COL_SENSOR_ID - 1]?.toString().trim();
    if (!sid || excludedSensors.includes(sid)) return;
    if (!groups[sid]) groups[sid] = [];
    groups[sid].push(row);
  });
  const existingFiles = [];
  if (mode === "incremental") {
    const iter = folder.getFiles();
    while (iter.hasNext()) existingFiles.push(iter.next());
  }
  function getLastTs(sid) {
    const prefix = "Telemetry_" + sid + "_";
    const sFiles = existingFiles.filter(f => f.getName().startsWith(prefix))
      .sort((a, b) => b.getDateCreated() - a.getDateCreated());
    if (!sFiles.length) return null;
    const lines = sFiles[0].getBlob().getDataAsString().split("\\n").filter(l => l.trim());
    if (lines.length <= 1) return null;
    const d = new Date(lines[lines.length - 1].split(",")[0].replace(/"/g, "").trim());
    return isNaN(d.getTime()) ? null : d;
  }
  const results = [];
  const headerRow = headers.map(h => '"' + h.name + '"').join(",");
  const dateStr = new Date().toISOString().split("T")[0];
  for (const sid in groups) {
    const rows = groups[sid];
    const cutoff = mode === "incremental" ? getLastTs(sid) : mode === "from_date" ? fromDate : null;
    let csv = headerRow + "\\n", count = 0;
    rows.forEach(row => {
      const ts = row[0];
      if (!(ts instanceof Date) || (cutoff && ts <= cutoff)) return;
      csv += row.map(v => v instanceof Date ? '"' + v.toISOString() + '"' : '"' + String(v).replace(/"/g, '""') + '"').join(",") + "\\n";
      count++;
    });
    if (count === 0) { results.push(sid + ": No new entries."); continue; }
    const fileName = "Telemetry_" + sid + "_" + dateStr + "_" + Date.now() + ".csv";
    folder.createFile(fileName, csv, MimeType.CSV);
    results.push(sid + ": Created \\"" + fileName + "\\" (" + count + " rows)");
  }
  return results.join(" | ");
}

function getHeaders(sheet) {
  if (sheet.getLastRow() === 0) sheet.appendRow(["Timestamp", "SensorID"]);
  const lastCol = Math.max(sheet.getLastColumn(), 2);
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map((name, i) => ({ name: name.toString(), col: i + 1 }));
}
function getOrCreateSheet(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function param(e, key) { return (e.parameter[key] || "").toString().trim(); }
function json(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function text(msg)  { return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT); }
function bytesToHuman(b) {
  if (!b) return "0 B";
  const s = ["B","KB","MB","GB"], i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + " " + s[i];
}`;

document.addEventListener("DOMContentLoaded", async () => {

  // ── Guard: must be authenticated ─────────────────────────────────────────
  const ok = await API.refreshToken();
  if (!ok) { API.redirectToLogin(); return; }

  document.getElementById("logout-btn")
    ?.addEventListener("click", () => API.logout());

  // ── Populate the Apps Script code block ──────────────────────────────────
  const codeBlock = document.getElementById("apps-script-code");
  if (codeBlock) {
    // Insert code as text node (before the Copy button)
    codeBlock.insertBefore(
      document.createTextNode(APPS_SCRIPT_CODE),
      codeBlock.querySelector(".code-block__copy")
    );
  }

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

    const res  = await API.post("/api/account/setup", { script_url: scriptUrl, drive_folder_id: driveFolderId || null });
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
