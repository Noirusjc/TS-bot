"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSettingsRouter = createSettingsRouter;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auth_1 = require("../middleware/auth");
const tsConnection_1 = require("../../services/tsConnection");
const settings_1 = require("../../utils/settings");
const logger_1 = require("../../utils/logger");
function createSettingsRouter(prisma) {
    const router = (0, express_1.Router)();
    router.use(auth_1.requireAuth);
    // ── PUT /api/settings/password ────────────────────────────────────────────
    router.put('/password', [
        (0, express_validator_1.body)('currentPassword').notEmpty().withMessage('Current password required'),
        (0, express_validator_1.body)('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        try {
            const { currentPassword, newPassword } = req.body;
            const user = await prisma.adminUser.findUnique({ where: { id: req.session.userId } });
            if (!user)
                return res.status(404).json({ error: 'User not found' });
            const valid = await bcryptjs_1.default.compare(currentPassword, user.passwordHash);
            if (!valid)
                return res.status(401).json({ error: 'Current password is incorrect' });
            const newHash = await bcryptjs_1.default.hash(newPassword, 12);
            await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash: newHash } });
            void (0, logger_1.dbLog)({ eventType: 'PASSWORD_CHANGED', message: `Admin password changed for: ${user.username}` });
            res.json({ success: true });
        }
        catch {
            res.status(500).json({ error: 'Failed to change password' });
        }
    });
    // ── GET /api/settings/ts ──────────────────────────────────────────────────
    router.get('/ts', async (_req, res) => {
        try {
            const cfg = await (0, settings_1.getTSConfig)();
            if (!cfg)
                return res.json({ configured: false });
            res.json({
                configured: true,
                host: cfg.host,
                serverPort: cfg.serverPort,
                queryPort: cfg.queryPort,
                username: cfg.username,
                password: '••••••••', // never expose the actual password
                botNickname: cfg.botNickname,
                // detectedVirtualServerId is intentionally exposed here for debugging
                detectedVirtualServerId: cfg.detectedVirtualServerId,
            });
        }
        catch {
            res.status(500).json({ error: 'Failed to fetch TS config' });
        }
    });
    // ── PUT /api/settings/ts ──────────────────────────────────────────────────
    // Update TS credentials — auto-detects virtual server, then reconnects.
    router.put('/ts', [
        (0, express_validator_1.body)('host').trim().notEmpty().withMessage('Host required'),
        (0, express_validator_1.body)('serverPort').isInt({ min: 1, max: 65535 }).withMessage('Valid TeamSpeak server port required (e.g. 9987)'),
        (0, express_validator_1.body)('queryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid ServerQuery port required (e.g. 10011)'),
        (0, express_validator_1.body)('username').trim().notEmpty().withMessage('Username required'),
        (0, express_validator_1.body)('password').notEmpty().withMessage('Password required'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        try {
            const { host, serverPort, queryPort, username, password, botNickname } = req.body;
            const cfg = {
                host,
                serverPort: parseInt(serverPort, 10),
                queryPort: parseInt(queryPort, 10),
                username,
                password,
                botNickname: botNickname || 'TS3-Bot',
            };
            // Test and auto-detect before saving
            const test = await tsConnection_1.TSConnectionManager.testConnection(cfg);
            if (!test.success) {
                return res.status(400).json({ error: `Connection test failed: ${test.message}` });
            }
            // Persist with detected virtual server ID
            const cfgToSave = {
                ...cfg,
                detectedVirtualServerId: test.detectedVirtualServerId,
            };
            await (0, settings_1.saveTSConfig)(cfgToSave);
            void (0, logger_1.dbLog)({
                eventType: 'TS_CREDENTIALS_UPDATED',
                message: `TS credentials updated. Host: ${host}:${serverPort}, VS ID: ${test.detectedVirtualServerId ?? 'auto'}`,
            });
            // Reconnect in background
            tsConnection_1.tsManager.reconfigure(cfgToSave).catch(() => { });
            res.json({
                success: true,
                message: 'Settings saved and reconnecting...',
                serverName: test.serverName,
                detectedVirtualServerId: test.detectedVirtualServerId,
            });
        }
        catch {
            res.status(500).json({ error: 'Failed to update TS settings' });
        }
    });
    // ── POST /api/settings/ts-test ────────────────────────────────────────────
    router.post('/ts-test', async (_req, res) => {
        try {
            const status = tsConnection_1.tsManager.getStatus();
            if (status === 'connected') {
                const version = await tsConnection_1.tsManager.run((ts) => ts.version());
                const info = await tsConnection_1.tsManager.run((ts) => ts.serverInfo()).catch(() => null);
                const serverName = info?.virtualserverName;
                return res.json({ success: !!version, status, version, serverName });
            }
            const cfg = await (0, settings_1.getTSConfig)();
            if (!cfg)
                return res.json({ success: false, message: 'TeamSpeak not configured' });
            const result = await tsConnection_1.TSConnectionManager.testConnection(cfg);
            return res.json(result);
        }
        catch {
            return res.status(500).json({ error: 'Test failed' });
        }
    });
    // ── POST /api/settings/ts-reconnect ──────────────────────────────────────
    router.post('/ts-reconnect', async (_req, res) => {
        try {
            const cfg = await (0, settings_1.getTSConfig)();
            if (!cfg)
                return res.status(400).json({ error: 'TeamSpeak not configured' });
            tsConnection_1.tsManager.reconfigure(cfg).catch(() => { });
            res.json({ success: true, message: 'Reconnect initiated' });
        }
        catch {
            res.status(500).json({ error: 'Reconnect failed' });
        }
    });
    return router;
}
//# sourceMappingURL=settings.js.map