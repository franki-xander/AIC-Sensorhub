// =============================================================================
// AIC Sensorhub v3 — Google Apps Script
// Deploy this as a Web App:
//   Extensions → Apps Script → Deploy → New Deployment
//   Type: Web App | Execute as: Me | Who has access: Anyone
// Copy the resulting /exec URL into the Sensorhub setup wizard.
// =============================================================================

// Sheet tab names — do not rename these tabs in your Google Sheet
const TELEMETRY_SHEET = "Telemetry";
const INTERVALS_SHEET = "Intervals";

// Column positions that are always fixed
const COL_TIMESTAMP = 1;  // A
const COL_SENSOR_ID = 2;  // B
// All other columns are created on-demand as new data fields arrive

// =============================================================================
// GET HANDLER — serves the frontend (proxied through the backend server)
// =============================================================================
function doGet(e) {
  const action = e.parameter.action;

  // ── Connectivity check used by the setup wizard ───────────────────────────
  if (action === "ping") {
    return text("PONG");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Return all distinct sensor IDs that have ever posted data ─────────────
  if (action === "getSensorIds") {
    const sheet   = getOrCreateSheet(ss, TELEMETRY_SHEET);
    const lastRow = sheet.getLastRow();
    const ids     = new Set();
    if (lastRow > 1) {
      sheet.getRange(2, COL_SENSOR_ID, lastRow - 1, 1)
           .getValues()
           .forEach(r => { if (r[0]) ids.add(r[0].toString().trim()); });
    }
    return json([...ids]);
  }

  // ── Return column headers (field names) available for a sensor ────────────
  if (action === "getFields") {
    const sensorId = param(e, "sensor_id");
    const sheet    = getOrCreateSheet(ss, TELEMETRY_SHEET);
    const headers  = getHeaders(sheet);
    // Return all headers except Timestamp and SensorID
    const fields = headers.slice(2).map(h => h.name);
    return json(fields);
  }

  // ── Return historical telemetry rows for one sensor ───────────────────────
  if (action === "getData") {
    const sensorId = param(e, "sensor_id");
    const hours    = parseInt(e.parameter.hours) || 48;
    const fields   = e.parameter.fields ? e.parameter.fields.split(",") : null; // optional field filter
    const sheet    = getOrCreateSheet(ss, TELEMETRY_SHEET);
    const headers  = getHeaders(sheet);
    const lastRow  = sheet.getLastRow();
    const output   = [];
    const cutoff   = new Date(Date.now() - hours * 60 * 60 * 1000);

    if (lastRow > 1) {
      const startRow = Math.max(2, lastRow - 3000);
      const numRows  = lastRow - startRow + 1;
      const numCols  = headers.length;
      const rows     = sheet.getRange(startRow, 1, numRows, numCols).getValues();

      rows.forEach(row => {
        const ts       = row[COL_TIMESTAMP - 1];
        const sid      = row[COL_SENSOR_ID - 1];
        if (!ts || sid !== sensorId) return;
        const rowDate = new Date(ts);
        if (rowDate < cutoff) return;

        const entry = { timestamp: rowDate.toISOString() };
        headers.slice(2).forEach((h, i) => {
          if (!fields || fields.includes(h.name)) {
            entry[h.name] = row[i + 2];
          }
        });
        output.push(entry);
      });
    }
    return json(output);
  }

  // ── Return config (interval + latest timestamp) for a sensor ─────────────
  if (action === "getConfig") {
    const sensorId       = param(e, "sensor_id") || param(e, "sensor");
    const intervalsSheet = getOrCreateSheet(ss, INTERVALS_SHEET);
    const telemetrySheet = getOrCreateSheet(ss, TELEMETRY_SHEET);
    let interval = 5;
    let latestTs = null;
    // Automatically add headers if it's a brand new Intervals sheet
    if (intervalsSheet.getLastRow() === 0) {
      intervalsSheet.appendRow(["SensorID", "Interval"]);
    }

    if (intervalsSheet) {
      const rows = intervalsSheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === sensorId) { interval = parseInt(rows[i][1]) || 5; break; }
      }
    }
    if (telemetrySheet) {
      const lastRow = telemetrySheet.getLastRow();
      if (lastRow > 1) {
        const start = Math.max(2, lastRow - 200);
        const rows  = telemetrySheet.getRange(start, 1, lastRow - start + 1, 2).getValues();
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i][1] === sensorId) { latestTs = rows[i][0]; break; }
        }
      }
    }
    return json({
      sensor_id:        sensorId,
      command_interval: interval,
      latest_reading:   latestTs ? new Date(latestTs).toISOString() : "No data available",
    });
  }

  // ── Set the posting interval for a sensor ─────────────────────────────────
  if (action === "setInterval") {
    const sensorId = param(e, "sensor_id");
    const value    = parseInt(e.parameter.value);
    const sheet    = getOrCreateSheet(ss, INTERVALS_SHEET);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["SensorID", "Interval"]);
    }
    const rows     = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === sensorId) { sheet.getRange(i + 1, 2).setValue(value); found = true; break; }
    }
    if (!found) sheet.appendRow([sensorId, value]);
    return json({ status: "updated", sensor_id: sensorId, interval: value });
  }

  // ── List archive files in the Drive folder ────────────────────────────────
  if (action === "getArchives") {
    const folderId = e.parameter.folder_id || PropertiesService.getScriptProperties().getProperty("ARCHIVE_FOLDER_ID");
    if (!folderId) return json([]);
    const folder = DriveApp.getFolderById(folderId);
    const iter   = folder.getFiles();
    const output = [];
    while (iter.hasNext()) {
      const f = iter.next();
      output.push({
        id:         f.getId(),
        name:       f.getName(),
        size:       bytesToHuman(f.getSize()),
        created_at: f.getDateCreated().toISOString(),
        sensor_id:  extractSensorIdFromFilename(f.getName()),
      });
    }
    // Sort newest first
    output.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return json(output);
  }

  // ── Download a single archive file (streamed by the backend) ─────────────
  if (action === "downloadArchive") {
    const fileId = e.parameter.file_id;
    const file   = DriveApp.getFileById(fileId);
    return ContentService.createTextOutput(file.getBlob().getDataAsString())
      .setMimeType(ContentService.MimeType.CSV);
  }

  // ── Generate incremental CSV archives ─────────────────────────────────────
  if (action === "generateArchives") {
    const mode            = e.parameter.mode || "incremental"; // incremental | from_date | all
    const fromDate        = e.parameter.from_date ? new Date(e.parameter.from_date) : null;
    const excludeRaw      = e.parameter.exclude_sensors || "";
    const excludedSensors = excludeRaw ? excludeRaw.split(",").map(s => s.trim()) : [];
    const folderId        = e.parameter.folder_id || PropertiesService.getScriptProperties().getProperty("ARCHIVE_FOLDER_ID");

    const result = generateArchives(ss, folderId, mode, fromDate, excludedSensors);
    return json({ status: "ok", summary: result });
  }

  return json({ error: "Unknown action." });
}

// =============================================================================
// POST HANDLER — receives telemetry from ESP32 devices
// =============================================================================
function doPost(e) {
  try {
    const data     = JSON.parse(e.postData.contents);
    const sensorId = data.sensor_id;
    if (!sensorId) return text("ERROR: sensor_id missing");

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, TELEMETRY_SHEET);

    // ── Column-on-demand: inspect payload keys, add columns as needed ───────
    const headers    = getHeaders(sheet);
    const headerNames = headers.map(h => h.name);

    // Collect all data fields (everything except sensor_id)
    const dataFields = Object.keys(data).filter(k => k !== "sensor_id");

    dataFields.forEach(field => {
      if (!headerNames.includes(field)) {
        // New field seen for the first time — append a column
        const newCol = headers.length + 1;
        sheet.getRange(1, newCol).setValue(field);
        headers.push({ name: field, col: newCol });
        headerNames.push(field);
      }
    });

    // ── Build the row, writing each value into the correct column ────────────
    const numCols = headers.length;
    const row     = new Array(numCols).fill("");
    row[COL_TIMESTAMP - 1] = new Date();
    row[COL_SENSOR_ID - 1] = sensorId;

    headers.slice(2).forEach((h, i) => {
      if (data[h.name] !== undefined) row[i + 2] = data[h.name];
    });

    sheet.appendRow(row);
    return text("SUCCESS");
  } catch (err) {
    return text("ERROR: " + err.toString());
  }
}

// =============================================================================
// ARCHIVE GENERATION
// =============================================================================
function generateArchives(ss, folderId, mode, fromDate, excludedSensors) {
  if (!folderId) return "No archive folder configured.";

  const sheet   = getOrCreateSheet(ss, TELEMETRY_SHEET);
  const folder  = DriveApp.getFolderById(folderId);
  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "No data to archive.";

  // Load all data rows
  const allRows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  // Group by sensor_id, excluding any sensors the user has excluded
  const groups = {};
  allRows.forEach(row => {
    const sid = row[COL_SENSOR_ID - 1]?.toString().trim();
    if (!sid || excludedSensors.includes(sid)) return;
    if (!groups[sid]) groups[sid] = [];
    groups[sid].push(row);
  });

  if (Object.keys(groups).length === 0) return "No sensors to archive after exclusions.";

  // Load existing archive files for incremental mode
  const existingFiles = [];
  if (mode === "incremental") {
    const iter = folder.getFiles();
    while (iter.hasNext()) existingFiles.push(iter.next());
  }

  function getLastArchivedTimestamp(sensorId) {
    const prefix = "Telemetry_" + sensorId + "_";
    const sensorFiles = existingFiles
      .filter(f => f.getName().startsWith(prefix))
      .sort((a, b) => b.getDateCreated() - a.getDateCreated());
    if (!sensorFiles.length) return null;
    const lines = sensorFiles[0].getBlob().getDataAsString()
                    .split("\n").filter(l => l.trim());
    if (lines.length <= 1) return null;
    const lastCell = lines[lines.length - 1].split(",")[0].replace(/"/g, "").trim();
    const d = new Date(lastCell);
    return isNaN(d.getTime()) ? null : d;
  }

  const results = [];
  const headerRow = headers.map(h => `"${h.name}"`).join(",");
  const dateStr   = new Date().toISOString().split("T")[0];

  for (const sensorId in groups) {
    const rows = groups[sensorId];
    let cutoff = null;

    if (mode === "incremental") {
      cutoff = getLastArchivedTimestamp(sensorId);
    } else if (mode === "from_date" && fromDate) {
      cutoff = fromDate;
    }

    let csv          = headerRow + "\n";
    let entriesCount = 0;

    rows.forEach(row => {
      const ts = row[COL_TIMESTAMP - 1];
      if (!(ts instanceof Date)) return;
      if (cutoff && ts <= cutoff) return;
      const line = row.map(v => v instanceof Date ? `"${v.toISOString()}"` : `"${v.toString().replace(/"/g, '""')}"`).join(",");
      csv += line + "\n";
      entriesCount++;
    });

    if (entriesCount === 0) {
      results.push(`${sensorId}: No new entries.`);
      continue;
    }

    const fileName = `Telemetry_${sensorId}_${dateStr}_${Date.now()}.csv`;
    const file     = folder.createFile(fileName, csv, MimeType.CSV);
    results.push(`${sensorId}: Created "${fileName}" (${entriesCount} rows)`);
  }

  return results.join(" | ");
}

// =============================================================================
// UTILITIES
// =============================================================================

function getHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "SensorID"]);
  }
  const lastCol = Math.max(sheet.getLastColumn(), 2);
  const raw     = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return raw.map((name, i) => ({ name: name.toString(), col: i + 1 }));
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function extractSensorIdFromFilename(name) {
  const match = name.match(/^Telemetry_(.+?)_\d{4}-\d{2}-\d{2}_\d+\.csv$/);
  return match ? match[1] : null;
}

function param(e, key) {
  return (e.parameter[key] || "").toString().trim();
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function text(msg) {
  return ContentService.createTextOutput(msg)
    .setMimeType(ContentService.MimeType.TEXT);
}

function bytesToHuman(bytes) {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}