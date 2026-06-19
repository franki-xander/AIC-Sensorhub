// =============================================================================
//  AIC Sensorhub v3 — DHT22 Example
//  ─────────────────────────────────────────────────────────────────────────
//  This is a complete, working example of the firmware template configured
//  for a DHT22 temperature and humidity sensor.
//
//  WIRING:
//    DHT22 VCC  → ESP32 3.3V
//    DHT22 GND  → ESP32 GND
//    DHT22 DATA → ESP32 GPIO 4  (change DHTPIN below if using a different pin)
//    DHT22 DATA → 10kΩ pull-up resistor to 3.3V (recommended)
//
//  LIBRARIES REQUIRED:
//    - DHT sensor library  (by Adafruit)
//    - Adafruit Unified Sensor  (by Adafruit, required by DHT library)
//    - ArduinoJson  (by Benoit Blanchon)
//
//  WHAT THIS SENDS TO YOUR GOOGLE SHEET:
//    Each row will have:
//      Timestamp      — set automatically by the Apps Script
//      SensorID       — the value you set in SENSOR_ID below
//      temperature_c  — temperature in degrees Celsius
//      humidity_pct   — relative humidity as a percentage
//
//  WHAT YOU NEED TO CHANGE:
//    1. WIFI_SSID and WIFI_PASSWORD
//    2. GOOGLE_SCRIPT_ID — from your Web App deployment URL
//    3. SENSOR_ID        — a unique name for this device
//    4. DHTPIN           — if your DATA wire is on a different GPIO
// =============================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>

// =============================================================================
// SECTION 1: USER CONFIGURATION
// =============================================================================
const char*   WIFI_SSID       = "YOUR_WIFI_NAME";
const char*   WIFI_PASSWORD   = "YOUR_WIFI_PASSWORD";
const String  GOOGLE_SCRIPT_ID = "YOUR_SCRIPT_ID_HERE";
const String  SENSOR_ID        = "dht22_sensor_1";

// GPIO pin connected to the DHT22 DATA line
#define DHTPIN  4
#define DHTTYPE DHT22

// Starting upload interval in minutes — can be changed remotely from the dashboard
volatile uint32_t uploadIntervalMinutes = 5;

// =============================================================================
// SECTION 2: INTERNAL CONFIGURATION
// =============================================================================
const String   SCRIPT_BASE_URL        = "https://script.google.com/macros/s/" + GOOGLE_SCRIPT_ID + "/exec";
const uint32_t CONFIG_POLL_INTERVAL_MS = 30000;
const int      SENSOR_READ_RETRIES     = 3;
const uint32_t SENSOR_RETRY_DELAY_MS   = 2000;
const uint32_t SLEEP_TICK_MS           = 15000;

TaskHandle_t TelemetryTaskHandle = NULL;
TaskHandle_t ControlTaskHandle   = NULL;

// =============================================================================
// SECTION 3: SENSOR SETUP
// =============================================================================

// Create the DHT sensor object
DHT dht(DHTPIN, DHTTYPE);

void sensorSetup() {
  dht.begin();
  Serial.printf("DHT22 initialized on GPIO %d\n", DHTPIN);
}

// ─────────────────────────────────────────────────────────────────────────────
// readSensorData — reads temperature and humidity from the DHT22.
// Returns false if either reading is invalid (NaN), which triggers a retry.
// ─────────────────────────────────────────────────────────────────────────────
bool readSensorData(JsonDocument& doc) {
  float temperature = dht.readTemperature();   // Celsius
  float humidity    = dht.readHumidity();      // Relative humidity %

  // isnan() catches DHT22 communication failures
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT22 read failed (NaN). Will retry.");
    return false;
  }

  // These string keys become column headers in your Google Sheet.
  // You can rename them to anything you like (no spaces).
  doc["temperature_c"] = temperature;
  doc["humidity_pct"]  = humidity;

  // Optional: also send heat index as a derived value
  float heatIndex = dht.computeHeatIndex(temperature, humidity, false);
  doc["heat_index_c"] = heatIndex;

  Serial.printf("  Temperature : %.2f °C\n", temperature);
  Serial.printf("  Humidity    : %.2f %%\n", humidity);
  Serial.printf("  Heat Index  : %.2f °C\n", heatIndex);

  return true;
}

// =============================================================================
// SECTION 4: ARDUINO ENTRY POINTS
// =============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n─────────────────────────────────────────");
  Serial.println("  AIC Sensorhub v3 — DHT22 Example");
  Serial.printf ("  Sensor ID: %s\n", SENSOR_ID.c_str());
  Serial.println("─────────────────────────────────────────");

  sensorSetup();

  if (!connectToWifi()) {
    Serial.println("FATAL: Could not connect to WiFi. Restarting in 10 seconds...");
    delay(10000);
    ESP.restart();
  }

  xTaskCreatePinnedToCore(telemetryTask, "TelemetryTask", 8192, NULL, 1, &TelemetryTaskHandle, 1);
  xTaskCreatePinnedToCore(controlTask,   "ControlTask",   8192, NULL, 1, &ControlTaskHandle,   0);

  Serial.println("Tasks running. Watching Serial Monitor for output.");
}

void loop() {
  vTaskDelay(portMAX_DELAY);
}

// =============================================================================
// SECTION 5: TASK IMPLEMENTATIONS
// (Identical to the template — do not modify)
// =============================================================================

void telemetryTask(void* pvParameters) {
  uint32_t elapsedMs = 0;
  uint32_t targetMs  = (uint32_t)uploadIntervalMinutes * 60UL * 1000UL;

  for (;;) {
    verifyWifiConnection();

    if (WiFi.status() == WL_CONNECTED) {
      bool success = false;
      StaticJsonDocument<512> doc;
      doc["sensor_id"] = SENSOR_ID;

      for (int attempt = 1; attempt <= SENSOR_READ_RETRIES; attempt++) {
        if (readSensorData(doc)) { success = true; break; }
        Serial.printf("Attempt %d/%d failed.\n", attempt, SENSOR_READ_RETRIES);
        if (attempt < SENSOR_READ_RETRIES)
          vTaskDelay(SENSOR_RETRY_DELAY_MS / portTICK_PERIOD_MS);
      }

      if (!success) {
        Serial.println("All read attempts failed. Skipping upload.");
      } else {
        String payload;
        serializeJson(doc, payload);
        Serial.printf("Uploading payload: %s\n", payload.c_str());

        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        http.begin(client, SCRIPT_BASE_URL);
        http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("Connection", "close");

        int code = http.POST(payload);
        if (code == 200 || code == 302) {
          Serial.printf("Upload confirmed (HTTP %d).\n", code);
        } else if (code < 0) {
          Serial.printf("Connection error: %s\n", http.errorToString(code).c_str());
        } else {
          Serial.printf("HTTP %d received.\n", code);
        }
        http.end();
      }
    } else {
      Serial.println("WiFi offline — skipping cycle.");
      vTaskDelay(10000 / portTICK_PERIOD_MS);
      continue;
    }

    elapsedMs = 0;
    targetMs  = (uint32_t)uploadIntervalMinutes * 60UL * 1000UL;
    Serial.printf("Sleeping. Next upload in %lu min.\n", uploadIntervalMinutes);

    while (elapsedMs < targetMs) {
      vTaskDelay(SLEEP_TICK_MS / portTICK_PERIOD_MS);
      elapsedMs += SLEEP_TICK_MS;
      uint32_t newTarget = (uint32_t)uploadIntervalMinutes * 60UL * 1000UL;
      if (newTarget != targetMs) {
        targetMs = newTarget; elapsedMs = 0;
        Serial.printf("[Telemetry] Interval changed to %lu min.\n", uploadIntervalMinutes);
      }
    }
  }
}

void controlTask(void* pvParameters) {
  for (;;) {
    vTaskDelay(CONFIG_POLL_INTERVAL_MS / portTICK_PERIOD_MS);
    if (WiFi.status() != WL_CONNECTED) continue;

    Serial.println("[Control] Checking for updates...");
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.begin(client, SCRIPT_BASE_URL + "?action=getConfig&sensor_id=" + SENSOR_ID);
    http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    http.addHeader("Connection", "close");

    int code = http.GET();
    if (code == 200) {
      String body = http.getString();
      if (!body.startsWith("<!DOCTYPE")) {
        StaticJsonDocument<256> resp;
        if (!deserializeJson(resp, body) && resp.containsKey("command_interval")) {
          uint32_t newInterval = resp["command_interval"].as<uint32_t>();
          if (newInterval > 0 && newInterval != uploadIntervalMinutes) {
            uploadIntervalMinutes = newInterval;
            Serial.printf("[Control] Interval set to %lu min.\n", uploadIntervalMinutes);
          }
        }
      }
    }
    http.end();
  }
}

// =============================================================================
// SECTION 6: WIFI HELPERS
// =============================================================================

bool connectToWifi() {
  WiFi.disconnect(true, true);
  delay(500);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected. IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  Serial.println("\nFailed.");
  return false;
}

void verifyWifiConnection() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.println("WiFi lost. Reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    vTaskDelay(500 / portTICK_PERIOD_MS); attempts++;
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? "Reconnected." : "Reconnection failed.");
}
