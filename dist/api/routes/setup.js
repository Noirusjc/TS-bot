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
    // ── Guard: block all setup routes once setup is complete ──────────────────
    router.use(async (_req, res, next) => {
        const complete = await (0, settings_1.isSetupComplete)().catch(() => false);
        if (complete) {
            return res.status(403).json({ error: 'Setup has already been completed.' });
        }
        next();
    });
    // ── GET /api/setup/status ─────────────────────────────────────────────────
    router.get('/status', async (_req, res) => {
        const complete = await (0, settings_1.isSetupComplete)().catch(() => false);
        res.json({ setupComplete: complete });
    });
    // ── POST /api/setup/test-ts ───────────────────────────────────────────────
    // Test a TS connection without saving anything.
    router.post('/test-ts', [
        (0, express_validator_1.body)('tsHost').trim().notEmpty().withMessage('Host required'),
        (0, express_validator_1.body)('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid port required'),
        (0, express_validator_1.body)('tsQueryUsername').trim().notEmpty().withMessage('Username required'),
        (0, express_validator_1.body)('tsQueryPassword').notEmpty().withMessage('Password required'),
        (0, express_validator_1.body)('tsVirtualServerId').isInt({ min: 1 }).withMessage('Virtual server ID required'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }
        const cfg = {
            host: String(req.body.tsHost),
            queryPort: parseInt(req.body.tsQueryPort, 10),
            username: String(req.body.tsQueryUsername),
            password: String(req.body.tsQueryPassword),
            virtualServerId: parseInt(req.body.tsVirtualServerId, 10),
            botNickname: String(req.body.tsBotNickname || 'TS3-Bot'),
        };
        // Use the static method on the class directly
        const result = await tsConnection_1.TSConnectionManager.testConnection(cfg);
        return res.json(result);
    });
    // ── POST /api/setup/complete ──────────────────────────────────────────────
    // Full setup: saves all config, creates admin user, marks setup done,
    // triggers live bot connection.
    router.post('/complete', [
        // TeamSpeak
        (0, express_validator_1.body)('tsHost').trim().notEmpty().withMessage('TeamSpeak host is required'),
        (0, express_validator_1.body)('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid ServerQuery port required'),
        (0, express_validator_1.body)('tsQueryUsername').trim().notEmpty().withMessage('ServerQuery username required'),
        (0, express_validator_1.body)('tsQueryPassword').notEmpty().withMessage('ServerQuery password required'),
        (0, express_validator_1.body)('tsVirtualServerId').isInt({ min: 1 }).withMessage('Virtual server ID required'),
        // Admin account
        (0, express_validator_1.body)('adminUsername').trim().isLength({ min: 3 }).withMessage('Admin username must be at least 3 characters'),
        (0, express_validator_1.body)('adminPassword').isLength({ min: 8 }).withMessage('Admin password must be at least 8 characters'),
        (0, express_validator_1.body)('adminPasswordConfirm').custom((val, { req: r }) => {
            if (val !== r.body.adminPassword)
                throw new Error('Passwords do not match');
            return true;
        }),
        // Optional channel IDs (must be numeric if provided)
        (0, express_validator_1.body)('sourceChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Source channel ID must be numeric'),
        (0, express_validator_1.body)('parentChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Parent channel ID must be numeric'),
        (0, express_validator_1.body)('clockChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Clock channel ID must be numeric'),
        (0, express_validator_1.body)('dateChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Date channel ID must be numeric'),
        (0, express_validator_1.body)('channelGroupId').optional({ checkFalsy: true }).isNumeric().withMessage('Channel group ID must be numeric'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }
        const b = req.body;
        try {
            // ── 1. Build TS config and run a live connection test ─────────────
            const tsCfg = {
                host: String(b.tsHost),
                queryPort: parseInt(String(b.tsQueryPort), 10),
                username: String(b.tsQueryUsername),
                password: String(b.tsQueryPassword),
                virtualServerId: parseInt(String(b.tsVirtualServerId), 10),
                botNickname: b.tsBotNickname ? String(b.tsBotNickname) : 'TS3-Bot',
            };
            const testResult = await tsConnection_1.TSConnectionManager.testConnection(tsCfg);
            if (!testResult.success) {
                return res.status(400).json({
                    error: `TeamSpeak connection test failed: ${testResult.message}`,
                    field: 'ts',
                });
            }
            // ── 2. Ensure all default settings rows exist ─────────────────────
            await (0, settings_1.ensureDefaultSettings)();
            // ── 3. Save TeamSpeak credentials to database ─────────────────────
            await (0, settings_1.saveTSConfig)(tsCfg);
            // ── 4. Create admin user (hash password) ──────────────────────────
            const adminUsername = String(b.adminUsername);
            const adminPassword = String(b.adminPassword);
            const passwordHash = await bcryptjs_1.default.hash(adminPassword, 12);
            await prisma.adminUser.upsert({
                where: { username: adminUsername },
                update: { passwordHash },
                create: { username: adminUsername, passwordHash },
            });
            // ── 5. Save / update default temp channel rule ────────────────────
            const tempEnabled = b.tempChannelEnabled === true || b.tempChannelEnabled === 'true';
            const sourceChannelId = b.sourceChannelId ? String(b.sourceChannelId) : '0';
            const parentChannelId = b.parentChannelId ? String(b.parentChannelId) : null;
            const channelNamePrefix = b.channelNamePrefix ? String(b.channelNamePrefix) : 'Channel';
            const channelGroupId = b.channelGroupId ? String(b.channelGroupId) : null;
            const existingRule = await prisma.temporaryChannelRule.findFirst();
            if (existingRule) {
                await prisma.temporaryChannelRule.update({
                    where: { id: existingRule.id },
                    data: { enabled: tempEnabled, sourceChannelId, parentChannelId, channelNamePrefix, channelGroupId },
                });
            }
            else {
                await prisma.temporaryChannelRule.create({
                    data: {
                        name: 'Default Rule',
                        enabled: tempEnabled,
                        sourceChannelId,
                        parentChannelId,
                        channelNamePrefix,
                        channelGroupId,
                    },
                });
            }
            // ── 6. Save optional clock/date channel IDs ───────────────────────
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
            // ── 7. Mark setup as complete (disables /setup permanently) ───────
            await (0, settings_1.markSetupComplete)();
            void (0, logger_1.dbLog)({
                eventType: 'SETUP_COMPLETED',
                message: `Setup completed. Admin: ${adminUsername}, TS: ${tsCfg.host}`,
                level: 'INFO',
            });
            // ── 8. Start bot services in background ───────────────────────────
            // reconfigure() tears down any existing connection and connects fresh
            tsConnection_1.tsManager.reconfigure(tsCfg).catch((err) => {
                logger_1.winstonLogger.warn(`[SETUP] Bot connect after setup: ${err.message}`);
            });
            // ── 9. Auto-login the user who just completed setup ───────────────
            const adminUser = await prisma.adminUser.findUnique({ where: { username: adminUsername } });
            if (adminUser) {
                req.session.userId = adminUser.id;
                req.session.username = adminUser.username;
                req.session.loginAt = Date.now();
            }
            return res.json({ success: true, message: 'Setup complete. Redirecting to dashboard...' });
        }
        catch (err) {
            logger_1.winstonLogger.error(`[SETUP] Setup failed: ${err.message}`);
            return res.status(500).json({ error: `Setup failed: ${err.message}` });
        }
    });
    return router;
}
//# sourceMappingURL=setup.js.map