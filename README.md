# TS3 Management Bot

A production-ready **TeamSpeak 3 Management Bot** with a Web Admin Panel.  
Designed for one-click deployment on [Railway](https://railway.app).

**Features**
- 📁 Automatic Temporary Channel creation & management
- 🕒 Iran Clock updater (Asia/Tehran, correct IRST/IRDT handling)
- 📅 Persian / Jalali (Shamsi) date channel updater
- 💬 Configurable BBCode Poke messages with placeholders
- 🌐 Dark responsive Web Admin Panel
- 🔄 Auto-reconnect with exponential backoff
- 🗑️ Restart-safe 3-minute empty channel auto-delete (persisted in PostgreSQL)
- 📋 Searchable, filterable database log viewer
- 🧙 First-time setup wizard — no terminal commands needed
- 🔍 **Automatic Virtual Server detection** — enter your server port, bot finds the rest

---

## ⚡ Railway Deployment (7 Steps — No Terminal)

### Step 1 — Fork
Click **Fork** on this GitHub repository to create your own copy.

### Step 2 — Create a Railway project
1. Go to [railway.app](https://railway.app) and log in.
2. Click **New Project → Deploy from GitHub repo**.
3. Select your forked repository. Railway starts the build automatically.

### Step 3 — Add PostgreSQL
1. In your Railway project click **+ New → Database → Add PostgreSQL**.
2. Go to your **application service → Variables tab**.
3. Add a new variable:
   - **Name:** `DATABASE_URL`
   - **Value:** `${{Postgres.DATABASE_URL}}`

### Step 4 — Add SESSION_SECRET
Still in the application service Variables tab, add:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | Any long random string (min 32 chars) |

Generate one: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

> Those are the only two variables you need before deploying.

### Step 5 — Wait for deployment
Railway will automatically:
- Install dependencies (`npm ci`)
- Build TypeScript (`npm run build`)
- Run database migrations (`prisma migrate deploy`)
- Start the application (`node dist/main.js`)

Watch **Deploy Logs** — when you see `[HTTP] Server listening` the app is ready.

### Step 6 — Generate a public domain
In your Railway project → application service → **Settings → Networking → Generate Domain**.

### Step 7 — Open the domain and complete setup
1. Open your Railway domain in a browser.
2. The **First-Time Setup Wizard** appears automatically at `/setup`.
3. Fill in 3 steps:
   - **Step 1:** TeamSpeak connection details (host, ports, credentials)
   - **Step 2:** Create your admin account
   - **Step 3:** Configure channels (optional — can do later in the panel)
4. Click **Complete Setup & Start Bot**.
5. The bot connects to TeamSpeak automatically. You are redirected to the dashboard.

**Done. No terminal. No manual commands. No restarts.**

---

## 🔍 Virtual Server Auto-Detection

You never need to know or enter a Virtual Server ID.

**What you enter:**
- TeamSpeak Host/IP
- **TeamSpeak Server Port** (the port clients connect to, e.g. `9987`)
- ServerQuery Port (e.g. `10011`)
- ServerQuery Username & Password

**What the bot does automatically:**
1. Connects to ServerQuery without selecting a virtual server
2. Calls `useByPort(serverPort)` — the TeamSpeak library selects the correct virtual server by game port
3. Reads the server name and virtual server ID for diagnostics
4. Stores the detected ID in the database for fast reconnects
5. Logs: `Connected to "My TS Server" on host:9987 via query port 10011`

**Multi-server hosting:** Each virtual server runs on a different game port (9987, 9988, 9989...). The bot selects exactly the one matching your configured port. If no server is running on that port, you get a clear error message.

---

## 🏠 Local Development

### Requirements
- Node.js 18+
- PostgreSQL 14+
- A TeamSpeak 3 server with ServerQuery access

### Setup
```bash
git clone https://github.com/YOUR_USERNAME/ts3-management-bot
cd ts3-management-bot
npm install

# Create your local .env (only DATABASE_URL + SESSION_SECRET needed)
cp .env.example .env
# Edit .env and fill in DATABASE_URL and SESSION_SECRET

# Run database migrations
npx prisma migrate deploy

# Start in development mode (hot reload)
npm run dev
```
Open `http://localhost:3000` — the setup wizard appears.

### Build for production
```bash
npm run build
npm start
```

---

## 📁 Project Structure

```
ts3-management-bot/
├── Dockerfile              # Multi-stage Docker build (builder + production)
├── railway.toml            # Railway: use Dockerfile, no startCommand override
├── scripts/
│   └── start.sh            # Startup: wait for DB → migrate → start app
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── migrations/         # SQL migration files (auto-applied on deploy)
├── src/
│   ├── main.ts             # Entry point — HTTP server starts first, background init after
│   ├── api/
│   │   ├── server.ts       # Express app — /health registered before session middleware
│   │   ├── middleware/     # Auth guards
│   │   └── routes/
│   │       ├── setup.ts    # First-time setup wizard API (public, blocked after setup)
│   │       ├── auth.ts
│   │       ├── status.ts
│   │       ├── tempChannels.ts
│   │       ├── clockDate.ts
│   │       ├── poke.ts
│   │       ├── logs.ts
│   │       └── settings.ts # TS credential update with auto VS detection + reconnect
│   ├── services/
│   │   ├── tsConnection.ts # TeamSpeak manager — useByPort() auto-detects virtual server
│   │   ├── tsEventHandler.ts
│   │   ├── tsQueue.ts      # Rate-limited command queue (250ms between commands)
│   │   ├── tempChannelService.ts
│   │   └── clockDateService.ts
│   ├── types/index.ts      # Shared TypeScript types (no virtualServerId in SetupPayload)
│   └── utils/
│       ├── config.ts       # Base config — only PORT + DATABASE_URL + SESSION_SECRET
│       ├── settings.ts     # DB settings store — getTSConfig/saveTSConfig use serverPort
│       ├── helpers.ts
│       └── logger.ts
└── public/
    ├── css/style.css
    ├── js/api.js + app.js
    └── pages/
        ├── setup.html      # Setup wizard — Server Port field, no VS ID field
        ├── settings.html   # TS settings — Server Port field, detected VS ID shown read-only
        ├── dashboard.html
        ├── temporary-channels.html
        ├── clock-date.html
        ├── poke-message.html
        └── logs.html
```

---

## ⚙️ Environment Variables

Only **2 variables** are required before first deployment:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | PostgreSQL URL. Use Railway variable reference `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | ✅ Yes | Long random string for session encryption |
| `NODE_ENV` | Auto | Set to `production` by Railway automatically |
| `PORT` | Auto | Set by Railway automatically — **never hardcode this** |
| `APP_URL` | Optional | Your public domain URL for CORS. Leave empty to allow all origins. |

**All TeamSpeak settings** (host, server port, query port, credentials) and **admin account** are entered in the `/setup` wizard and stored in PostgreSQL. They are never environment variables.

---

## 🔌 TeamSpeak Permissions Required

| Permission | Purpose |
|---|---|
| `b_virtualserver_select` | Select virtual server |
| `b_channel_create_permanent` | Create temporary channels |
| `b_channel_delete_permanent` | Delete empty channels |
| `b_channel_modify_make_default` | Edit/rename channels |
| `i_channel_modify_power` | Sufficient modify power |
| `b_client_move_others` | Move clients into created channels |
| `b_client_poke_send` | Send poke messages |
| `i_group_member_add_power` | Assign channel groups to users |
| `b_virtualserver_notify_register` | Subscribe to server events |

### Finding the ServerQuery password
- **Self-hosted:** Check `query_password.txt` in your TS3 server data directory
- **Hosted:** Check your hosting control panel

### IP Allowlist (important for Railway)
TeamSpeak 3 servers have a `query_ip_allowlist.txt`. Railway's outbound IPs are dynamic.

**Option A (easiest):** Add `0.0.0.0/0` to the allowlist  
**Option B:** Check Railway docs for their outbound IP range and add it specifically  
**Option C:** Use a fixed-IP proxy between Railway and your TS3 server

---

## 📋 How to Find TeamSpeak IDs

### TeamSpeak Server Port
The port your clients connect to — shown in the TeamSpeak client connection dialog. Default is `9987`.

### Channel IDs
1. In TeamSpeak client: right-click a channel → **Channel Info** → look for `cid`
2. Via ServerQuery: `channellist` → lists all channels with their `cid`

### Channel Group IDs
1. TeamSpeak client: **Permissions → Channel Groups** → hover to see the ID
2. Via ServerQuery: `channelgrouplist`

---

## 🗂️ Temporary Channel System

### How it works
1. Admin configures a **Source Channel ID** in the panel (Temp Channels page)
2. When a user joins that channel, the bot:
   - Creates a new channel: `[Channel Name] | [User Nickname]` (e.g. `Gaming | Amir`)
   - Moves the user into the new channel
   - Optionally assigns a Channel Group to the user (owner permissions)
   - Optionally generates a random password and sends it via TeamSpeak Poke

### Auto-delete after 3 minutes
- When the last user leaves, `deleteAt = now + 3 minutes` is saved to PostgreSQL
- A scheduler checks every 30 seconds for overdue channels and deletes them
- If a user rejoins before the deadline, the timer is cancelled
- On restart, the bot reads pending deletions from the database and resumes — no channels missed
- Deletion delay is configurable per rule (default: 180 seconds)

---

## 🕒 Iran Clock & Jalali Date

1. Create two dedicated TeamSpeak channels (e.g. `🕒 Iran Time` and `📅 Iran Date`)
2. Note their Channel IDs
3. Go to panel → **Clock & Date** → enter Channel IDs, enable each updater
4. Set formats:
   - Clock: `🕒 ساعت ایران: HH:mm`
   - Date: `📅 تاریخ: YYYY/MM/DD`
5. Save — bot updates the channels immediately

Uses `Asia/Tehran` timezone — automatically handles IRST (UTC+3:30) and IRDT (UTC+4:30).

---

## 🔒 Security

- Admin passwords hashed with **bcrypt** (cost 12) — never stored in plain text
- TeamSpeak credentials stored in PostgreSQL — never in environment variables or source code
- `/setup` route permanently blocked (returns 403) after setup completes
- Sessions stored in PostgreSQL with HTTP-only, SameSite=Strict cookies
- Rate limiting on login (10 attempts / 15 minutes)
- User nicknames and channel names sanitized before use in ServerQuery commands
- TeamSpeak password never returned in API responses

---

## 🛠️ Troubleshooting

### 502 Bad Gateway on Railway
- Check Deploy Logs for errors
- Ensure `DATABASE_URL` uses the Railway variable reference `${{Postgres.DATABASE_URL}}`
- Ensure the PostgreSQL service is in the same Railway project
- The app should start even without a DB — check if `/health` returns 200

### "No virtual server found running on port X"
- The **TeamSpeak Server Port** in the setup wizard must be the game port clients connect to (default `9987`)
- This is different from the ServerQuery port (default `10011`)
- Check your TS3 server is running and the port is correct

### "Connection test failed" in setup wizard
- Verify host, ports, and credentials are correct
- Ensure port 10011 (ServerQuery) is reachable from Railway — check firewall and IP allowlist

### Channels not being created
- Verify Source Channel ID is correct (right-click the channel in TS client → Channel Info)
- Ensure the rule is **enabled** and the **global toggle** is on
- Check Logs page for `TEMP_CHANNEL_CREATE_ERROR`

### Clock/Date not updating
- Verify the Channel ID is correct
- Ensure the bot has permission to rename that channel
- Check Logs for `CLOCK_UPDATED` / `DATE_UPDATED` events

### Re-running setup after reset
In the database, run:
```sql
UPDATE settings SET value = 'false' WHERE key = 'setup_complete';
```
Then open the app — the setup wizard reappears.

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Alpine Docker) |
| Language | TypeScript 5 |
| Web Framework | Express 4 |
| Database ORM | Prisma 5 |
| Database | PostgreSQL 14+ |
| TS3 Library | ts3-nodejs-library 3.x (`useByPort` for auto VS detection) |
| Session Store | PostgreSQL (connect-pg-simple) |
| Password Hashing | bcryptjs (cost 12) |
| Timezone | moment-timezone (Asia/Tehran) |
| Jalali Calendar | jalali-moment |
| Deployment | Railway + Docker (multi-stage build) |
