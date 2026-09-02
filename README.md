# TS3 Management Bot

A production-ready **TeamSpeak 3 Management Bot** with a Web Admin Panel.  
Designed for one-click deployment on [Railway](https://railway.app).

**Features**
- 📁 Automatic Temporary Channel creation & management
- 🕒 Iran Clock updater (Asia/Tehran timezone, correct IRST/IRDT handling)
- 📅 Persian / Jalali (Shamsi) date channel updater
- 💬 Configurable BBCode Poke messages with placeholders
- 🌐 Full-featured dark Web Admin Panel
- 🔄 Auto-reconnect with exponential backoff
- 🗑️ Restart-safe 3-minute empty channel cleanup (persisted in PostgreSQL)
- 📋 Searchable database log viewer
- 🧙 First-time setup wizard — no terminal commands needed

---

## ⚡ Railway Deployment (7 Steps, No Terminal Required)

> **Goal:** Fork → Deploy → Open → Setup → Bot works.

### Step 1 — Fork the repository

Click **Fork** on this GitHub repository to create your own copy.

### Step 2 — Create a Railway project

1. Go to [railway.app](https://railway.app) and log in.
2. Click **New Project → Deploy from GitHub repo**.
3. Select your forked repository.
4. Railway will start the first build automatically.

### Step 3 — Add a PostgreSQL database

1. In your Railway project, click **+ New** → **Database** → **Add PostgreSQL**.
2. After it provisions, click on the **PostgreSQL service**.
3. Go to the **Variables** tab of your **application service** (not the database).
4. Add a new variable:
   - **Name:** `DATABASE_URL`
   - **Value:** `${{Postgres.DATABASE_URL}}`  
     *(This is a Railway variable reference — it automatically links the two services.)*

### Step 4 — Add SESSION_SECRET

Still in your application service **Variables** tab, add:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | Any long random string (min 32 chars) |

**Generate one easily:**
```
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Or use any random string generator online.

> That's all the variables you need. Everything else is entered through the setup wizard.

### Step 5 — Wait for deployment to finish

Railway will automatically:
- Install dependencies
- Build TypeScript
- Run database migrations (`prisma migrate deploy`)
- Start the application

Watch the **Deploy Logs** tab — when you see `Admin panel listening on port ...` the app is ready.

### Step 6 — Generate a public domain

1. In your Railway project, click on the application service.
2. Go to **Settings** → **Networking** → **Generate Domain**.
3. Copy the generated URL (e.g. `https://your-app.railway.app`).

### Step 7 — Open the domain and complete the setup wizard

1. Open your Railway domain in a browser.
2. You will be redirected to `/setup` automatically.
3. Fill in the 3-step wizard:
   - **Step 1:** Your TeamSpeak ServerQuery credentials
   - **Step 2:** Create your admin account
   - **Step 3:** Configure channels (optional — can be done later in the panel)
4. Click **Complete Setup & Start Bot**.
5. The bot connects to TeamSpeak automatically.
6. You are redirected to the dashboard. ✅

**Done.** No terminal. No manual commands. No restarts needed.

---

## 🔁 The Deployment Flow (Summary)

```
Fork repository
      ↓
Connect fork to Railway
      ↓
Add PostgreSQL service
      ↓
Set DATABASE_URL + SESSION_SECRET variables
      ↓
Railway builds & deploys automatically
  • npm install
  • npm run build (TypeScript compile)
  • prisma migrate deploy (creates all tables)
  • node dist/main.js (starts app)
      ↓
Generate Railway public domain
      ↓
Open domain → /setup wizard appears
      ↓
Enter TeamSpeak credentials + create admin account
      ↓
Bot connects to TeamSpeak automatically
      ↓
Dashboard is live ✅
```

---

## 🏠 Local Development

### Requirements
- Node.js 18+
- PostgreSQL 14+
- A TeamSpeak 3 server with ServerQuery access

### Setup

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/ts3-management-bot
cd ts3-management-bot

# 2. Install dependencies
npm install

# 3. Create your local .env
cp .env.example .env
# Edit .env — set DATABASE_URL and SESSION_SECRET at minimum

# 4. Run database migrations
npx prisma migrate deploy

# 5. Start in development mode (hot reload)
npm run dev
```

Open `http://localhost:3000` — the setup wizard will appear.

### Build for production locally

```bash
npm run build
npm start
```

---

## 📁 Project Structure

```
ts3-management-bot/
├── Dockerfile              # Multi-stage Docker build
├── railway.toml            # Railway deployment config
├── scripts/
│   └── start.sh            # Startup: waits for DB, runs migrations, starts app
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── migrations/         # SQL migration files
├── src/
│   ├── main.ts             # Application entry point
│   ├── api/
│   │   ├── server.ts       # Express app setup
│   │   ├── middleware/     # Auth guards
│   │   └── routes/         # API route handlers
│   ├── services/
│   │   ├── tsConnection.ts # TeamSpeak connection manager
│   │   ├── tsEventHandler.ts
│   │   ├── tsQueue.ts      # Rate-limited command queue
│   │   ├── tempChannelService.ts
│   │   └── clockDateService.ts
│   ├── types/              # Shared TypeScript types
│   └── utils/              # Config, logger, helpers, settings
└── public/
    ├── css/style.css
    ├── js/
    │   ├── api.js
    │   └── app.js
    └── pages/
        ├── setup.html      # First-time setup wizard
        ├── login.html
        ├── dashboard.html
        ├── temporary-channels.html
        ├── clock-date.html
        ├── poke-message.html
        ├── logs.html
        └── settings.html
```

---

## ⚙️ Environment Variables Reference

Only **2 variables** are required before first deployment:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string. Use Railway variable reference `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | ✅ Yes | Long random string for session encryption |
| `NODE_ENV` | Auto | Set to `production` by Railway automatically |
| `PORT` | Auto | Set by Railway automatically — do not hardcode |
| `APP_URL` | Optional | Your public domain URL, used for CORS. Leave empty to allow all. |

**Everything else** (TeamSpeak credentials, admin account, channel IDs) is entered through the `/setup` wizard and stored in the database.

---

## 🔌 TeamSpeak Permissions Required

The ServerQuery account needs these permissions on your virtual server:

| Permission | Purpose |
|---|---|
| `b_virtualserver_select` | Select the virtual server |
| `b_channel_create_permanent` | Create temporary channels |
| `b_channel_delete_permanent` | Delete empty channels |
| `b_channel_modify_make_default` | Edit channels (rename clock/date) |
| `i_channel_modify_power` | Sufficient modify power |
| `b_client_move_others` | Move users into new channels |
| `b_client_poke_send` | Send poke messages |
| `i_group_member_add_power` | Assign channel groups to users |
| `b_virtualserver_notify_register` | Subscribe to server events |

### Finding the serveradmin password

The default `serveradmin` password is saved in your TS3 server's data folder:
- Windows: `%AppData%\TS3Server\query_password.txt`
- Linux:   `~/.ts3server/query_password.txt`

Or check your hosting control panel if using a hosted TS3 server.

### IP Allowlist (important for Railway)

TeamSpeak 3 servers have a ServerQuery IP allowlist (`query_ip_allowlist.txt`).  
Railway's outbound IPs are dynamic. To allow connections:

**Option A (easiest):** Add `0.0.0.0/0` to the allowlist (allows all IPs).  
**Option B (safer):** Get Railway's outbound IP from their docs and add it specifically.  
**Option C:** Use a fixed-IP proxy between Railway and your TS server.

---

## 📋 How to Find TeamSpeak IDs

### Channel IDs
1. In the TeamSpeak client, right-click a channel → **Channel Info**
2. The Channel ID (`cid`) is shown in the info panel
3. Or connect via ServerQuery and run: `channellist`

### Channel Group IDs
1. In the TeamSpeak client: **Permissions** → **Channel Groups**
2. Hover over a group name to see its ID
3. Or via ServerQuery: `channelgrouplist`

---

## 🗂️ Temporary Channel System

### How it works

1. Admin configures a **Source Channel** in the panel (Temp Channels → Source Channel ID)
2. When a user joins that channel, the bot:
   - Creates a new channel: `[Channel Name] | [User Nickname]`  
     Example: `Gaming | Amir`
   - Moves the user into the new channel
   - Optionally assigns a Channel Group (admin/owner)
   - Optionally generates a password and sends it via poke

### Channel naming

The **Channel Name** field in the panel is the prefix:
```
Panel input:  Gaming
User name:    Amir
Result:       Gaming | Amir
```
The separator (` | `) is configurable.

### Auto-delete after 3 minutes

- When the last user leaves a temporary channel, the bot records `deleteAt = now + 3 minutes` in PostgreSQL
- A cleanup scheduler checks every 30 seconds for overdue channels
- If a user rejoins before the deadline, the timer is cancelled
- On restart, the bot reads pending deletions from the database and resumes — **no channels are missed**
- The deletion delay is configurable per rule (default: 180 seconds)

---

## 🕒 Iran Clock & Jalali Date

1. Create two dedicated TeamSpeak channels (e.g. `🕒 Iran Time` and `📅 Iran Date`)
2. Note their Channel IDs
3. In the panel go to **Clock & Date**
4. Enter the Channel IDs, enable each updater, set the format:
   - Clock: `🕒 ساعت ایران: HH:mm`
   - Date:  `📅 تاریخ: YYYY/MM/DD`
5. Save — the bot starts updating immediately

The bot uses `Asia/Tehran` timezone and automatically handles:
- IRST (UTC+3:30) in winter
- IRDT (UTC+4:30) in summer (Iranian Daylight Saving Time)

---

## 🔒 Security Notes

- Admin passwords are hashed with **bcrypt** (cost factor 12) — never stored in plain text
- TeamSpeak credentials are stored in the PostgreSQL database — never in environment variables or source code
- The `/setup` route is permanently disabled after setup completes (returns 403)
- Sessions use HTTP-only, SameSite=Strict cookies stored in PostgreSQL
- All admin API routes require authentication
- Rate limiting on login endpoint (10 attempts per 15 minutes)
- User nicknames and channel names are sanitized before use in ServerQuery commands

---

## 🛠️ Troubleshooting

### Bot connects but channels aren't created
- Verify the **Source Channel ID** is correct (must be numeric)
- Ensure the rule is **enabled** and the **global toggle** is on
- Check **Logs** page for `TEMP_CHANNEL_CREATE_ERROR` events
- Verify the ServerQuery account has channel create permissions

### Clock/Date not updating
- Verify the Channel ID is correct
- Ensure the bot has permission to rename that specific channel
- Check Logs for `TS_ERROR` or `DATE_UPDATED`/`CLOCK_UPDATED` events

### "TeamSpeak connection test failed" in setup wizard
- Check host/port/credentials are correct
- Ensure port 10011 (or your query port) is open and reachable from Railway
- Check IP allowlist on your TS server (see IP Allowlist section above)

### Railway: App deploys but database errors appear
- Verify `DATABASE_URL` is set using the Railway variable reference `${{Postgres.DATABASE_URL}}`
- Check the PostgreSQL service is in the same Railway project
- Check Deploy Logs for migration errors

### Session not persisting after restart
- Ensure `SESSION_SECRET` is set in Railway Variables and is consistent
- Sessions are stored in PostgreSQL so they survive restarts

### "Setup has already been completed" error
- The `/setup` route is blocked once setup is done — this is correct security behaviour
- Go to `/login` to access the panel
- If you need to reset: in the database, update `settings` set `value = 'false'` where `key = 'setup_complete'`

---

## 🔄 Re-deploying / Updating

```bash
# Push changes to your fork
git add .
git commit -m "your changes"
git push

# Railway automatically rebuilds and redeploys
# Migrations run automatically on every deploy
# Your settings and data are preserved in PostgreSQL
```

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Alpine Docker) |
| Language | TypeScript 5 |
| Web Framework | Express 4 |
| Database ORM | Prisma 5 |
| Database | PostgreSQL 14+ |
| TS3 Library | ts3-nodejs-library 3.x |
| Session Store | PostgreSQL (connect-pg-simple) |
| Password Hashing | bcryptjs |
| Timezone | moment-timezone (Asia/Tehran) |
| Jalali Calendar | jalali-moment |
| Deployment | Railway + Docker |
