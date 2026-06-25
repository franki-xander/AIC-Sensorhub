// =============================================================================
//   AIC Sensorhub v3 — ESP32 Firmware Template
//   ─────────────────────────────────────────────────────────────────────────
//   HOW TO USE THIS TEMPLATE
//   ─────────────────────────────────────────────────────────────────────────
//   1. Fill in your WiFi credentials below (WIFI_SSID, WIFI_PASSWORD).
//   2. Paste your Google Apps Script ID into GOOGLE_SCRIPT_ID.
//      This is the long string in your Web App URL between /s/ and /exec.
//      Example URL: https://script.google.com/macros/s/AKfycb.../exec
//                                                               ^^^^^^^^ this part
//   3. Give this device a unique name in SENSOR_ID.
//      Use only letters, numbers, and underscores. No spaces.
//      Example: "lab_bench_1" or "rooftop_weather"
//   4. Open the function readSensorData() near the bottom of this file.
//      Add your sensor reading code inside it.
//      Use doc.set("your_field_name", value) for each value you want to send.
//      The field name becomes a column header in your Google Sheet.
//   5. Flash to your ESP32 and watch the Serial Monitor at 115200 baud.
//
//   LIBRARIES REQUIRED (install via Arduino Library Manager):
//     - ArduinoJson  (by Benoit Blanchon)
//     - Any libraries required by your specific sensors
//
//   BOARD SETTINGS:
//     Board: "ESP32 Dev Module" (or your specific ESP32 board)
//     Upload Speed: 921600
//     Flash Size: 4MB
// =============================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// =============================================================================
// SECTION 1: USER CONFIGURATION — Edit these values before flashing
// =============================================================================

// Your WiFi network name (case-sensitive)
const char* WIFI_SSID     = "STARLINK";

// Your WiFi password
const char* WIFI_PASSWORD = "";

// Your Google Apps Script ID
// Find this in your Web App URL: .../macros/s/THIS_PART_HERE/exec
const String GOOGLE_SCRIPT_ID = "AKfycbz5y7VqbIuxyIFUdPKiEATPJBm5xoTeP4uuBHlEf9ZXwe68RgyXgDsly10paeJ0D8yT";

// A unique identifier for this specific device.
// This is how the Sensorhub dashboard tells your devices apart.
// Use only letters, numbers, and underscores — no spaces.
const String SENSOR_ID = "dht22_sensor";

// How many minutes between each data upload (default: 5).
// The dashboard can change this remotely without reflashing.
volatile uint32_t uploadIntervalMinutes = 5;

// =============================================================================
// SECTION 2: INTERNAL CONFIGURATION — You generally do not need to change these
// =============================================================================

// The full URL is assembled from your Script ID automatically
const String SCRIPT_BASE_URL =
  "https://script.google.com/macros/s/" + GOOGLE_SCRIPT_ID + "/exec";

// How often the control thread checks for remote configuration updates (ms)
const uint32_t CONFIG_POLL_INTERVAL_MS = 30000;  // 30 seconds

// How many times to retry a failed sensor read before skipping the cycle
const int SENSOR_READ_RETRIES = 3;

// Delay between sensor read retries (ms)
// Many sensors need time to stabilize between reads
const uint32_t SENSOR_RETRY_DELAY_MS = 2000;

// Tick size for the interruptible sleep loop (ms)
// A smaller value means interval changes take effect faster.
// 15 seconds is a good balance between responsiveness and CPU usage.
const uint32_t SLEEP_TICK_MS = 15000;

// FreeRTOS task handles (used internally)
TaskHandle_t TelemetryTaskHandle = NULL;
TaskHandle_t ControlTaskHandle   = NULL;

// =============================================================================
// SECTION 3: FORWARD DECLARATIONS — do not modify
// =============================================================================
void telemetryTask(void* pvParameters);
void controlTask(void* pvParameters);
bool connectToWifi();
void verifyWifiConnection();

// =============================================================================
// SECTION 4: YOUR SENSOR SETUP — Add your sensor initialization here
// =============================================================================

// ▼▼▼ ADD YOUR SENSOR #include STATEMENTS HERE ▼▼▼
#include <DHT.h>
// ▲▲▲

// ▼▼▼ ADD YOUR SENSOR OBJECT DECLARATIONS HERE ▼▼▼
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);
// ▲▲▲

// ─────────────────────────────────────────────────────────────────────────────
// sensorSetup()
// Called once during startup. Initialize your sensor hardware here.
// ─────────────────────────────────────────────────────────────────────────────
void sensorSetup() {
  // ▼▼▼ ADD YOUR SENSOR INITIALIZATION CODE HERE ▼▼▼
  dht.begin();
  Serial.printf("DHT22 initialized on GPIO %d\n", DHTPIN);
  // ▲▲▲
}

// ─────────────────────────────────────────────────────────────────────────────
// readSensorData(JsonDocument& doc)
// Called before every upload. Read your sensors here and add values to `doc`.
//
// HOW TO ADD DATA:
// For ArduinoJson6:
//   doc.set("field_name", value);
// For ArduinoJson7 (Current):
//   doc["field_name"] = value;         
//   - "field_name" becomes a column header in your Google Sheet.
//   - value can be a float, int, bool, or String.
//   - Use descriptive names: "temperature_c", "humidity_pct", "co2_ppm"
//
// Return true if readings are valid, false to skip this upload cycle.
// ─────────────────────────────────────────────────────────────────────────────
bool readSensorData(JsonDocument& doc) {
  // ▼▼▼ ADD YOUR SENSOR READING CODE HERE ▼▼▼
  float temperature = dht.readTemperature();
  float humidity    = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT22 read failed (NaN). Will retry.");
    return false;
  }

  doc["temperature_c"] = temperature;
  doc["humidity_pct"] = humidity;

  // Optional calculated field
  float heatIndex = dht.computeHeatIndex(temperature, humidity, false);
  doc["heat_index_c"] = heatIndex;

  Serial.printf("  Temperature : %.2f °C\n", temperature);
  Serial.printf("  Humidity    : %.2f %%\n", humidity);
  Serial.printf("  Heat Index  : %.2f °C\n", heatIndex);

  return true;
  // ▲▲▲
}

// =============================================================================
// SECTION 5: MAIN ARDUINO ENTRY POINTS — do not modify
// =============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n─────────────────────────────────────────");
  Serial.println("  AIC Sensorhub v3 — Booting");
  Serial.printf ("  Sensor ID: %s\n", SENSOR_ID.c_str());
  Serial.println("─────────────────────────────────────────");

  // Initialize user-defined sensors
  sensorSetup();

  // Connect to WiFi before spawning tasks
  if (!connectToWifi()) {
    Serial.println("FATAL: Could not connect to WiFi. Restarting in 10 seconds...");
    delay(10000);
    ESP.restart();
  }

  // Spawn the two worker tasks on separate cores
  xTaskCreatePinnedToCore(telemetryTask, "TelemetryTask", 8192, NULL, 1, &TelemetryTaskHandle, 1);
  xTaskCreatePinnedToCore(controlTask,   "ControlTask",   8192, NULL, 1, &ControlTaskHandle,   0);

  Serial.println("Tasks spawned. Main loop yielding.");
}

void loop() {
  // All work is done in FreeRTOS tasks.
  // Delay indefinitely to yield the main core.
  vTaskDelay(portMAX_DELAY);
}

// =============================================================================
// SECTION 6: TASK IMPLEMENTATIONS — do not modify
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// TASK 1: Telemetry — Core 1
// Reads sensors and POSTs data on the configured interval.
// Uses an interruptible sleep loop so remote interval changes take effect
// within SLEEP_TICK_MS rather than after the full previous interval expires.
// ─────────────────────────────────────────────────────────────────────────────
void telemetryTask(void* pvParameters) {
  uint32_t elapsedMs = 0;
  uint32_t targetMs  = (uint32_t)uploadIntervalMinutes * 60UL * 1000UL;

  for (;;) {
    verifyWifiConnection();

    if (WiFi.status() == WL_CONNECTED) {
      // Attempt to read sensors, retrying on failure
      bool success = false;
      StaticJsonDocument<512> doc;
      doc["sensor_id"] = SENSOR_ID;

      for (int attempt = 1; attempt <= SENSOR_READ_RETRIES; attempt++) {
        if (readSensorData(doc)) {
          success = true;
          break;
        }
        Serial.printf("Sensor read attempt %d/%d failed.\n", attempt, SENSOR_READ_RETRIES);
        if (attempt < SENSOR_READ_RETRIES) {
          vTaskDelay(SENSOR_RETRY_DELAY_MS / portTICK_PERIOD_MS);
        }
      }

      if (!success) {
        Serial.println("All sensor read attempts failed. Skipping this upload cycle.");
      } else {
        // Serialize and POST
        String payload;
        serializeJson(doc, payload);
        Serial.printf("Uploading: %s\n", payload.c_str());

        WiFiClientSecure client;
        client.setInsecure(); // Skips cert validation — avoids cert expiry bricking the device

        HTTPClient http;
        http.begin(client, SCRIPT_BASE_URL);
        http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("Connection", "close");

        int code = http.POST(payload);
        if (code == 200 || code == 302) {
          Serial.printf("Upload confirmed. HTTP %d\n", code);
        } else if (code < 0) {
          Serial.printf("Upload connection error: %s\n", http.errorToString(code).c_str());
        } else {
          Serial.printf("Upload returned HTTP %d\n", code);
        }
        http.end();
      }
    } else {
      Serial.println("WiFi offline — skipping upload cycle.");
      vTaskDelay(10000 / portTICK_PERIOD_MS);
      continue;
    }

    // Interruptible sleep: checks for interval changes every SLEEP_TICK_MS
    elapsedMs = 0;
    targetMs  = (uint32_t)uploadIntervalMinutes * 60UL * 1000UL;
    Serial.printf("Next upload in %lu minutes.\n", uploadIntervalMinutes);

    while (elapsedMs < targetMs) {
      vTaskDelay(SLEEP_TICK_MS / portTICK_PERIOD_MS);
      elapsedMs += SLEEP_TICK_MS;

      uint32_t newTarget = (uint32_t)uploadIntervalMinutes * 60UL * 1000UL;
      if (newTarget != targetMs) {
        Serial.printf("[Telemetry] Interval updated to %lu min — applying now.\n", uploadIntervalMinutes);
        targetMs  = newTarget;
        elapsedMs = 0;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 2: Control — Core 0
// Polls the Apps Script every 30 seconds for remote configuration changes.
// Currently handles: upload interval (command_interval)
// ─────────────────────────────────────────────────────────────────────────────
void controlTask(void* pvParameters) {
  for (;;) {
    vTaskDelay(CONFIG_POLL_INTERVAL_MS / portTICK_PERIOD_MS);

    if (WiFi.status() != WL_CONNECTED) continue;

    Serial.println("[Control] Polling for configuration updates...");

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient http;
    String url = SCRIPT_BASE_URL + "?action=getConfig&sensor_id=" + SENSOR_ID;
    http.begin(client, url);
    http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    http.addHeader("Connection", "close");

    int code = http.GET();
    if (code == 200) {
      String body = http.getString();

      // Guard against receiving an HTML error page instead of JSON
      if (body.startsWith("<!DOCTYPE") || body.indexOf("<html") != -1) {
        Serial.println("[Control] Received HTML instead of JSON — skipping.");
        http.end();
        continue;
      }

      StaticJsonDocument<256> resp;
      if (!deserializeJson(resp, body) && resp.containsKey("command_interval")) {
        uint32_t newInterval = resp["command_interval"].as<uint32_t>();
        if (newInterval > 0 && newInterval != uploadIntervalMinutes) {
          uploadIntervalMinutes = newInterval;
          Serial.printf("[Control] Interval updated to %lu minutes.\n", uploadIntervalMinutes);
        }
      }
    } else {
      Serial.printf("[Control] Config poll returned HTTP %d\n", code);
    }
    http.end();
  }
}

// =============================================================================
// SECTION 7: WIFI HELPERS — do not modify
// =============================================================================

bool connectToWifi() {
  WiFi.disconnect(true, true);
  delay(500);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected. IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  Serial.println("\nFailed to connect.");
  return false;
}

void verifyWifiConnection() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.println("WiFi lost. Reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    vTaskDelay(500 / portTICK_PERIOD_MS);
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi reconnected.");
  } else {
    Serial.println("WiFi reconnection failed — will retry next cycle.");
  }
}