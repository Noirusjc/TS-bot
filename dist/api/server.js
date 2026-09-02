"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const connect_pg_simple_1 = __importDefault(require("connect-pg-simple"));
const config_1 = require("../utils/config");
const settings_1 = require("../utils/settings");
const auth_1 = require("./middleware/auth");
const auth_2 = require("./routes/auth");
const status_1 = require("./routes/status");
const tempChannels_1 = require("./routes/tempChannels");
const clockDate_1 = require("./routes/clockDate");
const poke_1 = require("./routes/poke");
const logs_1 = require("./routes/logs");
const settings_2 = require("./routes/settings");
const setup_1 = require("./routes/setup");
function createApp(prisma) {
    const app = (0, express_1.default)();
    // ─── Security Headers ────────────────────────────────────────────────────────
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
                styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
                fontSrc: ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'"],
            },
        },
    }));
    const corsOrigin = config_1.config.appUrl && config_1.config.appUrl !== '' ? config_1.config.appUrl : true;
    app.use((0, cors_1.default)({ origin: corsOrigin, credentials: true }));
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use(express_1.default.urlencoded({ extended: true }));
    // ─── Health endpoint — registered BEFORE session middleware ──────────────────
    // This guarantees /health always responds even if session store has issues.
    app.get('/health', (_req, res) => {
        res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    // ─── Session ─────────────────────────────────────────────────────────────────
    // Use memory store as fallback if DATABASE_URL is missing (prevents crash)
    let sessionStore;
    if (config_1.config.databaseUrl) {
        try {
            const PgStore = (0, connect_pg_simple_1.default)(express_session_1.default);
            sessionStore = new PgStore({
                conString: config_1.config.databaseUrl,
                tableName: 'session',
                createTableIfMissing: true,
            });
        }
        catch (err) {
            console.error('[SESSION] Failed to create PG session store, falling back to memory store:', err.message);
            sessionStore = undefined; // will use default memory store
        }
    }
    else {
        console.warn('[SESSION] DATABASE_URL not set — using in-memory session store (sessions lost on restart)');
    }
    app.use((0, express_session_1.default)({
        ...(sessionStore ? { store: sessionStore } : {}),
        secret: config_1.config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        name: 'ts3bot.sid',
        cookie: {
            httpOnly: true,
            // Only send secure cookies when actually behind HTTPS (Railway)
            secure: config_1.config.nodeEnv === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000,
        },
    }));
    // ─── Static Files ─────────────────────────────────────────────────────────────
    const publicDir = path_1.default.join(__dirname, '../../public');
    app.use(express_1.default.static(publicDir));
    // ─── Setup API (public — blocked after setup completes) ──────────────────────
    app.use('/api/setup', (0, setup_1.createSetupRouter)(prisma));
    // ─── Protected API Routes ─────────────────────────────────────────────────────
    app.use('/api/auth', (0, auth_2.createAuthRouter)(prisma));
    app.use('/api/status', (0, status_1.createStatusRouter)(prisma));
    app.use('/api/temp-channels', (0, tempChannels_1.createTempChannelsRouter)(prisma));
    app.use('/api/clock-date', (0, clockDate_1.createClockDateRouter)());
    app.use('/api/poke', (0, poke_1.createPokeRouter)());
    app.use('/api/logs', (0, logs_1.createLogsRouter)(prisma));
    app.use('/api/settings', (0, settings_2.createSettingsRouter)(prisma));
    // ─── Setup Wizard Page ────────────────────────────────────────────────────────
    app.get('/setup', async (_req, res) => {
        try {
            const complete = await (0, settings_1.isSetupComplete)();
            if (complete)
                return res.redirect('/login');
        }
        catch { /* DB not ready yet — show setup page anyway */ }
        res.sendFile(path_1.default.join(publicDir, 'pages/setup.html'));
    });
    // ─── Login Page ───────────────────────────────────────────────────────────────
    app.get('/login', auth_1.requireGuest, (_req, res) => {
        res.sendFile(path_1.default.join(publicDir, 'pages/login.html'));
    });
    // ─── Protected Panel Pages ────────────────────────────────────────────────────
    const protectedPages = [
        '/dashboard', '/temporary-channels', '/clock-date',
        '/poke-message', '/logs', '/settings',
    ];
    for (const page of protectedPages) {
        app.get(page, auth_1.requireAuth, (_req, res) => {
            res.sendFile(path_1.default.join(publicDir, `pages/${page.slice(1)}.html`));
        });
    }
    // ─── Root redirect ────────────────────────────────────────────────────────────
    app.get('/', async (req, res) => {
        try {
            const complete = await (0, settings_1.isSetupComplete)();
            if (!complete)
                return res.redirect('/setup');
        }
        catch {
            return res.redirect('/setup');
        }
        if (req.session?.userId)
            return res.redirect('/dashboard');
        res.redirect('/login');
    });
    // ─── 404 ──────────────────────────────────────────────────────────────────────
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    // ─── Global error handler ─────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err, _req, res, _next) => {
        console.error('[EXPRESS]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    });
    return app;
}
//# sourceMappingURL=server.js.map