# AIC Sensorhub v3

**A multi-tenant IoT monitoring platform developed by Aldwyn James N. Bernardo in cooperation with the Ateneo Innovation Center (AIC).**

Originally created to support the research project of Ramos, Andal et al. and made available for further use by the developer and AIC.

---

## What It Does

AIC Sensorhub connects ESP32 microcontrollers to a personal web dashboard through the user's own Google Sheet. Each user brings their own data storage — sensor readings live in a Google Sheet they own, archives go to their own Google Drive, and the platform provides the interface, authentication, and connection layer on top.

- **Live sensor dashboard** — real-time charts for any data fields your ESP32 sends
- **Remote interval control** — change how often your device uploads without reflashing
- **Per-sensor pages** — create multiple dashboard views showing different fields from different devices
- **CSV archiving** — export data to Google Drive incrementally, from a date, or all at once
- **Private and isolated** — each user's data stays in their own Google account

---

## Architecture

```
ESP32 Firmware
  └─ POST telemetry ──────────────→ Google Apps Script (user's own deployment)
  └─ GET config (every 30s) ──────→ Google Apps Script

Browser
  └─ All requests ────────────────→ Vercel Serverless API (/api/*)
       └─ Auth routes              → Issues JWT + HTTP-only refresh cookie
       └─ /api/data                → Proxied to user's Apps Script (URL never exposed)
       └─ /api/archives/*          → Proxied to user's Apps Script + Drive
       └─ /api/pages               → Reads/writes sensor page config in PostgreSQL

Google Apps Script (per user)
  └─ Reads/writes ────────────────→ Google Sheet (Telemetry + Intervals tabs)
  └─ Reads/writes ────────────────→ Google Drive (CSV archive files)

PostgreSQL (Supabase)
  └─ Stores: user accounts, hashed passwords, session tokens, sensor page configs
  └─ Never stores: sensor readings
```

**Key design principle:** The platform stores nothing about your sensor data. Everything lives in infrastructure you own and control.

---

## Repository Structure

```
AIC-Sensorhub/
├── frontend/                        Vercel deployment (static site + serverless API)
│   ├── index.html                   Login page
│   ├── register.html                Account creation
│   ├── setup.html                   Onboarding wizard (5-step)
│   ├── dashboard.html               Sensor fleet overview
│   ├── sensor.html                  Per-sensor analytics and controls
│   ├── archive.html                 CSV archive management
│   ├── terms.html                   Terms of Service
│   ├── vercel.json                  Clean URLs, function config
│   ├── package.json                 Dependencies for serverless functions
│   ├── css/
│   │   └── style.css                Design system (dark slate theme)
│   ├── js/
│   │   ├── app.js                   Global API client + UI utilities
│   │   ├── auth.js                  Login and registration logic
│   │   ├── setup.js                 Wizard logic + Apps Script code display
│   │   ├── dashboard.js             Fleet grid + sensor page CRUD
│   │   ├── sensor.js                Dynamic chart rendering
│   │   └── archive.js               Archive generation and download
│   └── api/
│       ├── _utils/
│       │   ├── db.js                PostgreSQL connection pool
│       │   ├── auth-helpers.js      Token signing, cookie management
│       │   └── session.js           JWT verification middleware
│       ├── auth/
│       │   ├── google.js            Redirect to Google OAuth consent
│       │   ├── callback.js          Handle OAuth return, upsert user
│       │   ├── login.js             Email/password login
│       │   ├── register.js          New account creation
│       │   ├── refresh.js           Silent token rotation
│       │   └── logout.js            Invalidate session
│       ├── index.js                 Sensor pages CRUD + Apps Script proxy
│       ├── account.js               Account setup, info, update, delete
│       └── archives/
│           ├── index.js             List archive files
│           ├── generate.js          Trigger CSV generation
│           └── download/
│               └── [fileId].js      Proxied private file download
├── apps-script/
│   └── Code.gs                      Paste into Google Apps Script editor
└── firmware/
    ├── AIC_Sensorhub_Template/
    │   └── AIC_Sensorhub_Template.ino     Base template — add your sensor code
    └── AIC_Sensorhub_DHT22_Example/
        └── AIC_Sensorhub_DHT22_Example.ino  Complete DHT22 working example
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Serverless API | Vercel Functions (Node.js 20, ES Modules) |
| Authentication | Google OAuth 2.0 + bcrypt email/password |
| Sessions | JWT access tokens (15 min) + rotating refresh tokens (30 days) |
| Database | PostgreSQL via Supabase (account metadata only) |
| Sensor data storage | Google Sheets (user-owned) |
| Archive storage | Google Drive (user-owned) |
| Cloud backend | Google Apps Script (user-deployed) |
| Firmware | ESP32 Arduino with FreeRTOS dual-task architecture |
| Hosting | Vercel (frontend + API) |
| Charts | Chart.js with chartjs-adapter-date-fns |

---

## Quick Start

### 1. Deploy the Backend (Vercel)

1. Fork or clone this repository
2. Import the repo into [vercel.com](https://vercel.com) — set **Root Directory** to `frontend`
3. Add these environment variables in Vercel → Project → Settings → Environment Variables:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → URI |
| `JWT_SECRET` | Run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Same as above |
| `GOOGLE_CALLBACK_URL` | `https://your-site.vercel.app/api/auth/callback` |

4. Deploy

### 2. Set Up the Database

Run `backend/db/schema.sql` against your Supabase database once:

```
psql "postgresql://postgres:PASSWORD@db.YOUR-PROJECT.supabase.co:5432/postgres" -f backend/db/schema.sql
```

Or paste the contents into Supabase → SQL Editor → Run.

### 3. Configure Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials → Create OAuth 2.0 Client ID
3. Application type: **Web application**
4. Authorized redirect URIs: `https://your-site.vercel.app/api/auth/callback`
5. Add your Terms of Service URL under OAuth consent screen: `https://your-site.vercel.app/terms`
6. Publish the app to remove the unverified warning screen

### 4. Flash the ESP32

1. Install [Arduino IDE 2](https://www.arduino.cc/en/software)
2. Install required libraries via Library Manager:
   - **ArduinoJson** by Benoit Blanchon
   - **DHT sensor library** by Adafruit (DHT22 example only)
   - **Adafruit Unified Sensor** by Adafruit (DHT22 example only)
3. Open `firmware/AIC_Sensorhub_Template/AIC_Sensorhub_Template.ino`
4. Fill in `WIFI_SSID`, `WIFI_PASSWORD`, `GOOGLE_SCRIPT_ID`, and `SENSOR_ID`
5. Add your sensor reading code inside `readSensorData()`
6. Flash to your ESP32

The DHT22 example is a complete ready-to-flash file requiring only WiFi and Script ID credentials.

### 5. Onboard as a User

1. Visit your deployed site and create an account
2. Follow the 5-step setup wizard:
   - Create a Google Sheet
   - Paste the Apps Script code and deploy as a Web App
   - Enter the Web App URL and an optional Google Drive folder ID
   - Flash the firmware to your ESP32
   - Wait for the first reading
3. Add sensor pages on the dashboard for each device you want to monitor

---

## Firmware Architecture

Each ESP32 runs two concurrent FreeRTOS tasks:

**Telemetry Task (Core 1)** reads sensor data and POSTs to the Apps Script on a configurable interval. Uses an interruptible 15-second tick sleep loop so remote interval changes apply within seconds rather than waiting out the full previous cycle.

**Control Task (Core 0)** polls the Apps Script every 30 seconds for configuration updates, primarily the upload interval. Writes changes to the shared `uploadIntervalMinutes` variable which the telemetry task reads on its next tick.

Both tasks handle WiFi reconnection automatically and retry failed sensor reads up to 3 times before skipping a cycle.

---

## Adding a New Sensor Type

No platform changes are required. The Apps Script uses column-on-demand — any new JSON key in the ESP32 payload automatically creates a new column in the Google Sheet. The dashboard dynamically generates one chart per numeric field. To add a new sensor:

1. Add the sensor library and wiring to your ESP32
2. Add `doc["your_field_name"] = value;` inside `readSensorData()`
       {{This syntax is for ArduinoJson 7 and above; for ArduinoJson6, `doc.set("your_field_name", value)` is used.}}
4. Flash the firmware
5. The new field appears automatically in the sheet and on the dashboard

---

## Security Notes

- Apps Script URLs are stored server-side and never sent to the browser
- Archive downloads are proxied through the API — Google Drive URLs are never exposed
- Passwords are hashed with bcrypt (cost factor 12) — plaintext is never stored
- Access tokens are 15-minute JWTs stored in JavaScript memory only
- Refresh tokens are stored as SHA-256 hashes in the database and rotate on every use
- Refresh token cookies are HTTP-only, preventing JavaScript access

---

## Terms of Service

Non-commercial use only. Developed for academic research and further use by the developer and AIC. See [Terms of Service](https://aic-sensorhub.vercel.app/terms) for full details.

---

## License

Developed by Aldwyn James N. Bernardo in cooperation with the Ateneo Innovation Center.
For academic and non-commercial use. All rights reserved.
