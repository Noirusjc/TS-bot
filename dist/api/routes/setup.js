"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSetupRouter = createSetupRouter;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const settings_1 = require("../../utils/settings");
const logger_1 = require("../../utils/logger");
const tsConnection_1 = require("../../services/tsConnection");
function createSetupRouter(prisma) {
    const router = (0, express_1.Router)();
    // ── Guard: block once setup is complete ───────────────────────────────────
    router.use(async (_req, res, next) => {
        const complete = await (0, settings_1.isSetupComplete)().catch(() => false);
        if (complete)
            return res.status(403).json({ error: 'Setup has already been completed.' });
        next();
    });
    // ── GET /api/setup/status ─────────────────────────────────────────────────
    router.get('/status', async (_req, res) => {
        const complete = await (0, settings_1.isSetupComplete)().catch(() => false);
        res.json({ setupComplete: complete });
    });
    // ── POST /api/setup/test-ts ───────────────────────────────────────────────
    // Test the connection and auto-detect virtual server — nothing is saved.
    router.post('/test-ts', [
        (0, express_validator_1.body)('tsHost').trim().notEmpty().withMessage('Host required'),
        (0, express_validator_1.body)('tsServerPort').isInt({ min: 1, max: 65535 }).withMessage('Valid TeamSpeak server port required (e.g. 9987)'),
        (0, express_validator_1.body)('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid ServerQuery port required (e.g. 10011)'),
        (0, express_validator_1.body)('tsQueryUsername').trim().notEmpty().withMessage('ServerQuery username required'),
        (0, express_validator_1.body)('tsQueryPassword').notEmpty().withMessage('ServerQuery password required'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        const cfg = {
            host: String(req.body.tsHost),
            serverPort: parseInt(req.body.tsServerPort, 10),
            queryPort: parseInt(req.body.tsQueryPort, 10),
            username: String(req.body.tsQueryUsername),
            password: String(req.body.tsQueryPassword),
            botNickname: String(req.body.tsBotNickname || 'TS3-Bot'),
        };
        const result = await tsConnection_1.TSConnectionManager.testConnection(cfg);
        return res.json(result);
    });
    // ── POST /api/setup/complete ──────────────────────────────────────────────
    router.post('/complete', [
        // TeamSpeak — no virtualServerId required
        (0, express_validator_1.body)('tsHost').trim().notEmpty().withMessage('TeamSpeak host is required'),
        (0, express_validator_1.body)('tsServerPort').isInt({ min: 1, max: 65535 }).withMessage('TeamSpeak server port required (e.g. 9987)'),
        (0, express_validator_1.body)('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('ServerQuery port required (e.g. 10011)'),
        (0, express_validator_1.body)('tsQueryUsername').trim().notEmpty().withMessage('ServerQuery username required'),
        (0, express_validator_1.body)('tsQueryPassword').notEmpty().withMessage('ServerQuery password required'),
        // Admin account
        (0, express_validator_1.body)('adminUsername').trim().isLength({ min: 3 }).withMessage('Admin username must be at least 3 characters'),
        (0, express_validator_1.body)('adminPassword').isLength({ min: 8 }).withMessage('Admin password must be at least 8 characters'),
        (0, express_validator_1.body)('adminPasswordConfirm').custom((val, { req: r }) => {
            if (val !== r.body.adminPassword)
                throw new Error('Passwords do not match');
            return true;
        }),
        // Optional channel IDs
        (0, express_validator_1.body)('sourceChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Source channel ID must be numeric'),
        (0, express_validator_1.body)('parentChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Parent channel ID must be numeric'),
        (0, express_validator_1.body)('clockChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Clock channel ID must be numeric'),
        (0, express_validator_1.body)('dateChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Date channel ID must be numeric'),
        (0, express_validator_1.body)('channelGroupId').optional({ checkFalsy: true }).isNumeric().withMessage('Channel group ID must be numeric'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        const b = req.body;
        try {
            // ── 1. Build TS config (no virtualServerId needed from user) ──────
            const tsCfg = {
                host: String(b.tsHost),
                serverPort: parseInt(String(b.tsServerPort), 10),
                queryPort: parseInt(String(b.tsQueryPort), 10),
                username: String(b.tsQueryUsername),
                password: String(b.tsQueryPassword),
                botNickname: b.tsBotNickname ? String(b.tsBotNickname) : 'TS3-Bot',
            };
            // ── 2. Test connection and auto-detect virtual server ID ──────────
            const testResult = await tsConnection_1.TSConnectionManager.testConnection(tsCfg);
            if (!testResult.success) {
                return res.status(400).json({
                    error: `TeamSpeak connection failed: ${testResult.message}`,
                    field: 'ts',
                });
            }
            // Store the detected virtual server ID for fast reconnects
            if (testResult.detectedVirtualServerId) {
                tsCfg.detectedVirtualServerId = testResult.detectedVirtualServerId;
            }
            // ── 3. Ensure default settings rows ───────────────────────────────
            await (0, settings_1.ensureDefaultSettings)();
            // ── 4. Save TS config ─────────────────────────────────────────────
            await (0, settings_1.saveTSConfig)(tsCfg);
            // ── 5. Create admin user ──────────────────────────────────────────
            const adminUsername = String(b.adminUsername);
            const adminPassword = String(b.adminPassword);
            const passwordHash = await bcryptjs_1.default.hash(adminPassword, 12);
            await prisma.adminUser.upsert({
                where: { username: adminUsername },
                update: { passwordHash },
                create: { username: adminUsername, passwordHash },
            });
            // ── 6. Save / update default temp channel rule ────────────────────
            const tempEnabled = b.tempChannelEnabled === true || b.tempChannelEnabled === 'true';
            const existingRule = await prisma.temporaryChannelRule.findFirst();
            const ruleData = {
                enabled: tempEnabled,
                sourceChannelId: b.sourceChannelId ? String(b.sourceChannelId) : '0',
                parentChannelId: b.parentChannelId ? String(b.parentChannelId) : null,
                channelNamePrefix: b.channelNamePrefix ? String(b.channelNamePrefix) : 'Channel',
                channelGroupId: b.channelGroupId ? String(b.channelGroupId) : null,
            };
            if (existingRule) {
                await prisma.temporaryChannelRule.update({ where: { id: existingRule.id }, data: ruleData });
            }
            else {
                await prisma.temporaryChannelRule.create({ data: { name: 'Default Rule', ...ruleData } });
            }
            // ── 7. Save optional clock/date channel IDs ───────────────────────
            const extra = {};
            if (b.clockChannelId) {
                extra['clock_channel_id'] = String(b.clockChannelId);
                extra['clock_enabled'] = 'true';
            }
            if (b.dateChannelId) {
                extra['date_channel_id'] = String(b.dateChannelId);
                extra['date_enabled'] = 'true';
            }
            if (Object.keys(extra).length > 0)
                await (0, settings_1.setSettings)(extra);
            // ── 8. Mark setup complete ────────────────────────────────────────
            await (0, settings_1.markSetupComplete)();
            void (0, logger_1.dbLog)({
                eventType: 'SETUP_COMPLETED',
                message: `Setup complete. Admin: ${adminUsername}, TS: ${tsCfg.host}:${tsCfg.serverPort}, VS ID: ${tsCfg.detectedVirtualServerId ?? 'auto'}`,
                level: 'INFO',
            });
            // ── 9. Activate bot in background ─────────────────────────────────
            tsConnection_1.tsManager.reconfigure(tsCfg).catch((err) => {
                logger_1.winstonLogger.warn(`[SETUP] Bot connect after setup: ${err.message}`);
            });
            // ── 10. Auto-login ────────────────────────────────────────────────
            const adminUser = await prisma.adminUser.findUnique({ where: { username: adminUsername } });
            if (adminUser) {
                req.session.userId = adminUser.id;
                req.session.username = adminUser.username;
                req.session.loginAt = Date.now();
            }
            return res.json({
                success: true,
                message: 'Setup complete. Redirecting to dashboard...',
                serverName: testResult.serverName,
                detectedVirtualServerId: tsCfg.detectedVirtualServerId,
            });
        }
        catch (err) {
            logger_1.winstonLogger.error(`[SETUP] Setup failed: ${err.message}`);
            return res.status(500).json({ error: `Setup failed: ${err.message}` });
        }
    });
    return router;
}
//# sourceMappingURL=setup.js.map