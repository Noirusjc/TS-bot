"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTempChannelsRouter = createTempChannelsRouter;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../../utils/logger");
const settings_1 = require("../../utils/settings");
function createTempChannelsRouter(prisma) {
    const router = (0, express_1.Router)();
    router.use(auth_1.requireAuth);
    // GET /api/temp-channels/rules
    router.get('/rules', async (_req, res) => {
        try {
            const rules = await prisma.temporaryChannelRule.findMany({ orderBy: { id: 'asc' } });
            const enabled = await (0, settings_1.getSetting)('temp_channel_enabled', 'true');
            res.json({ enabled: enabled === 'true', rules });
        }
        catch {
            res.status(500).json({ error: 'Failed to fetch rules' });
        }
    });
    // GET /api/temp-channels/rules/:id
    router.get('/rules/:id', (0, express_validator_1.param)('id').isInt(), async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: 'Invalid ID' });
        try {
            const rule = await prisma.temporaryChannelRule.findUnique({ where: { id: parseInt(req.params.id, 10) } });
            if (!rule)
                return res.status(404).json({ error: 'Rule not found' });
            res.json(rule);
        }
        catch {
            res.status(500).json({ error: 'Failed to fetch rule' });
        }
    });
    // POST /api/temp-channels/rules — create new rule
    router.post('/rules', [
        (0, express_validator_1.body)('name').trim().notEmpty().withMessage('Name required'),
        (0, express_validator_1.body)('sourceChannelId').trim().notEmpty().isNumeric().withMessage('Source channel ID must be numeric'),
        (0, express_validator_1.body)('channelNamePrefix').trim().notEmpty().withMessage('Channel name prefix required'),
        (0, express_validator_1.body)('deletionDelay').isInt({ min: 30, max: 3600 }).withMessage('Deletion delay must be 30-3600 seconds'),
        (0, express_validator_1.body)('passwordLength').isInt({ min: 4, max: 32 }).withMessage('Password length must be 4-32'),
        (0, express_validator_1.body)('maxClients').isInt({ min: -1, max: 256 }).withMessage('Max clients must be -1 to 256'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        try {
            const data = req.body;
            const rule = await prisma.temporaryChannelRule.create({
                data: {
                    name: data.name,
                    enabled: Boolean(data.enabled),
                    sourceChannelId: String(data.sourceChannelId),
                    parentChannelId: data.parentChannelId ? String(data.parentChannelId) : null,
                    channelNamePrefix: data.channelNamePrefix,
                    nameSeparator: data.nameSeparator ?? ' | ',
                    passwordEnabled: Boolean(data.passwordEnabled),
                    passwordLength: parseInt(data.passwordLength, 10),
                    passwordCharset: data.passwordCharset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
                    maxClients: parseInt(data.maxClients, 10),
                    channelGroupId: data.channelGroupId ? String(data.channelGroupId) : null,
                    deletionDelay: parseInt(data.deletionDelay, 10),
                },
            });
            void (0, logger_1.dbLog)({ eventType: 'RULE_CREATED', message: `New temp channel rule created: ${rule.name}` });
            res.status(201).json(rule);
        }
        catch {
            res.status(500).json({ error: 'Failed to create rule' });
        }
    });
    // PUT /api/temp-channels/rules/:id — update rule
    router.put('/rules/:id', [
        (0, express_validator_1.param)('id').isInt(),
        (0, express_validator_1.body)('sourceChannelId').optional().isNumeric().withMessage('Source channel ID must be numeric'),
        (0, express_validator_1.body)('deletionDelay').optional().isInt({ min: 30, max: 3600 }),
        (0, express_validator_1.body)('passwordLength').optional().isInt({ min: 4, max: 32 }),
        (0, express_validator_1.body)('maxClients').optional().isInt({ min: -1, max: 256 }),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        try {
            const id = parseInt(req.params.id, 10);
            const data = req.body;
            const rule = await prisma.temporaryChannelRule.update({
                where: { id },
                data: {
                    ...(data.name !== undefined && { name: data.name }),
                    ...(data.enabled !== undefined && { enabled: Boolean(data.enabled) }),
                    ...(data.sourceChannelId !== undefined && { sourceChannelId: String(data.sourceChannelId) }),
                    ...(data.parentChannelId !== undefined && { parentChannelId: data.parentChannelId ? String(data.parentChannelId) : null }),
                    ...(data.channelNamePrefix !== undefined && { channelNamePrefix: data.channelNamePrefix }),
                    ...(data.nameSeparator !== undefined && { nameSeparator: data.nameSeparator }),
                    ...(data.passwordEnabled !== undefined && { passwordEnabled: Boolean(data.passwordEnabled) }),
                    ...(data.passwordLength !== undefined && { passwordLength: parseInt(data.passwordLength, 10) }),
                    ...(data.passwordCharset !== undefined && { passwordCharset: data.passwordCharset }),
                    ...(data.maxClients !== undefined && { maxClients: parseInt(data.maxClients, 10) }),
                    ...(data.channelGroupId !== undefined && { channelGroupId: data.channelGroupId ? String(data.channelGroupId) : null }),
                    ...(data.deletionDelay !== undefined && { deletionDelay: parseInt(data.deletionDelay, 10) }),
                },
            });
            void (0, logger_1.dbLog)({ eventType: 'RULE_UPDATED', message: `Temp channel rule updated: ${rule.name}` });
            res.json(rule);
        }
        catch {
            res.status(500).json({ error: 'Failed to update rule' });
        }
    });
    // DELETE /api/temp-channels/rules/:id
    router.delete('/rules/:id', (0, express_validator_1.param)('id').isInt(), async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: 'Invalid ID' });
        try {
            const id = parseInt(req.params.id, 10);
            await prisma.temporaryChannelRule.delete({ where: { id } });
            void (0, logger_1.dbLog)({ eventType: 'RULE_DELETED', message: `Temp channel rule deleted: ${id}` });
            res.json({ success: true });
        }
        catch {
            res.status(500).json({ error: 'Failed to delete rule' });
        }
    });
    // PUT /api/temp-channels/global-enabled
    router.put('/global-enabled', (0, express_validator_1.body)('enabled').isBoolean(), async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: 'Invalid value' });
        await (0, settings_1.setSetting)('temp_channel_enabled', req.body.enabled ? 'true' : 'false');
        res.json({ success: true });
    });
    // GET /api/temp-channels/active — list active channels
    router.get('/active', async (_req, res) => {
        try {
            const channels = await prisma.temporaryChannel.findMany({
                where: { status: { in: [client_1.ChannelStatus.ACTIVE, client_1.ChannelStatus.EMPTY] } },
                include: { rule: { select: { name: true } } },
                orderBy: { createdAt: 'desc' },
            });
            res.json(channels);
        }
        catch {
            res.status(500).json({ error: 'Failed to fetch active channels' });
        }
    });
    return router;
}
//# sourceMappingURL=tempChannels.js.map