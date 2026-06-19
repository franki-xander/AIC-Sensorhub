# AIC Sensorhub v3

A multi-tenant IoT monitoring platform. Each user connects their own Google Sheet as a data source, flashes an ESP32 with the provided firmware template, and gets a private dashboard with live charts, remote interval control, and per-sensor CSV archives.

---

## Repository Structure

```
aic-sensorhub-v3/
├── backend/                  Node.js + Express backend (auth, proxy, archives)
│   ├── server.js
│   ├── package.json
│   ├── .env.example          Copy to .env and fill in values
│   ├── db/schema.sql         Run once to create PostgreSQL tables
│   ├── middleware/session.js
│   └── routes/
│       ├── auth.js           Google OAuth + email/password
│       ├── proxy.js          Apps Script proxy + sensor page CRUD
│       └── archive.js        Archive generation + proxied download
├── frontend/                 Vercel static site
│   ├── index.html            Login page
│   ├── register.html         Account creation
│   ├── setup.html            Onboarding wizard
│   ├── dashboard.html        Fleet overview
│   ├── sensor.html           Per-sensor analytics
│   ├── archive.html          Archive management
│   ├── vercel.json
│   ├── css/style.css
│   └── js/
│       ├── app.js            Global API client + utilities
│       ├── auth.js           Login / register logic
│       ├── setup.js          Wizard logic
│       ├── dashboard.js      Fleet grid + sensor page CRUD
│       ├── sensor.js         Dynamic chart rendering
│       └── archive.js        Archive generation + download
├── apps-script/
│   └── Code.gs               Paste into Google Apps Script editor
└── firmware/
    ├── AIC_Sensorhub_Template/
    │   └── AIC_Sensorhub_Template.ino    Base template — fill in sensor code
    └── AIC_Sensorhub_DHT22_Example/
        └── AIC_Sensorhub_DHT22_Example.ino  Complete DHT22 example
```

---

## 1. Backend Setup

### Prerequisites
- Node.js 18+
- PostgreSQL database (local, Railway, Supabase, etc.)
- Google Cloud project with OAuth 2.0 credentials

### Google Cloud OAuth Setup
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Google+ API** (or People API)
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add your backend callback URL to **Authorized redirect URIs**:
   `https://your-backend.fly.dev/auth/google/callback`
7. Copy the **Client ID** and **Client Secret**

### Install and configure
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your database URL, JWT secret, and Google credentials
```

### Create database tables
```bash
psql -d your_database_name -f db/schema.sql
```

### Run locally
```bash
npm run dev      # uses nodemon for auto-reload
# or
npm start        # production start
```

### Deploy to Fly.io (recommended)
```bash
fly launch       # follow prompts, set secrets from .env
fly secrets set DATABASE_URL="..." JWT_SECRET="..." GOOGLE_CLIENT_ID="..." ...
fly deploy
```

---

## 2. Frontend Setup (Vercel)

1. Push the `frontend/` directory to a GitHub repository
2. Import the repository in [vercel.com](https://vercel.com)
3. Set the **Root Directory** to `frontend`
4. Set the environment variable `BACKEND_URL` — or edit `js/app.js` directly:
   ```js
   const CONFIG = {
     BACKEND_URL: "https://your-backend.fly.dev",
   };
   ```
5. Deploy. Vercel will handle the clean URL routing via `vercel.json`.

---

## 3. ESP32 Firmware

### Required Arduino libraries
Install via **Arduino Library Manager** (Tools → Manage Libraries):
- **ArduinoJson** by Benoit Blanchon
- **DHT sensor library** by Adafruit *(DHT22 example only)*
- **Adafruit Unified Sensor** by Adafruit *(DHT22 example only)*

### Board settings
- Board: **ESP32 Dev Module** (or your specific ESP32 variant)
- Upload Speed: 921600

### Template firmware (`AIC_Sensorhub_Template.ino`)
1. Open in Arduino IDE
2. Fill in `WIFI_SSID`, `WIFI_PASSWORD`, `GOOGLE_SCRIPT_ID`, `SENSOR_ID`
3. Add your sensor `#include` statements and initialization in `sensorSetup()`
4. Add your sensor readings inside `readSensorData()` using `doc["field_name"] = value`
5. Flash to your ESP32

### DHT22 example (`AIC_Sensorhub_DHT22_Example.ino`)
A complete, ready-to-flash example. Fill in WiFi and Script credentials, flash, and it will immediately begin posting `temperature_c`, `humidity_pct`, and `heat_index_c`.

---

## 4. User Onboarding Flow

Once the backend and frontend are deployed:

1. User visits the site and creates an account (Google OAuth or email/password)
2. They are guided through the **Setup Wizard**:
   - Create a Google Sheet
   - Paste the Apps Script code (`apps-script/Code.gs`) and deploy it as a Web App
   - Paste the Web App URL into the wizard — the backend validates connectivity
   - Download and flash the firmware template
3. Once the ESP32 posts its first reading, the wizard confirms success
4. User is redirected to their personal dashboard
5. They add **Sensor Pages** for each sensor, choosing which fields to display
6. Each sensor page shows live charts (one per selected field) and a remote interval control

---

## 5. Architecture Notes

**Data isolation:** Every user has their own Google Sheet and their own Apps Script deployment. The platform's backend stores only account metadata (email, hashed password or Google ID, Script URL). It never stores sensor readings.

**Apps Script URL privacy:** The Script URL is stored in the backend database and never sent to the browser. All data requests from the frontend go to the backend (`/api/data`), which proxies the request to the user's script.

**Archive privacy:** Archive files in Google Drive are not shared publicly. Downloads are proxied through the backend (`/api/archives/download/:fileId`), which streams the file content to the authenticated browser session.

**Schema flexibility:** The Apps Script uses column-on-demand — any JSON key in the ESP32 payload becomes a column in the Google Sheet automatically. The sensor page can then display any numeric field as a chart.

**Token security:** Access tokens (15-minute JWTs) are stored in JavaScript memory only. Refresh tokens are stored as HTTP-only cookies (inaccessible to JavaScript) and hashed in the database. Rotating refresh tokens are issued on each use.

---

## 6. Changing Your Google Sheet

Users can re-run the setup wizard at any time from the **Change Sheet** link in the nav. This replaces the stored Script URL with a new one. Existing sensor pages on the dashboard will immediately start reading from the new sheet.

---

## License

MIT
