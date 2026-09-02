"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStatusRouter = createStatusRouter;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const tsConnection_1 = require("../../services/tsConnection");
const helpers_1 = require("../../utils/helpers");
const settings_1 = require("../../utils/settings");
const startTime = Date.now();
function createStatusRouter(prisma) {
    const router = (0, express_1.Router)();
    // ── GET /api/status ───────────────────────────────────────────────────────
    // Protected — requires login. Returns full dashboard status.
    router.get('/', auth_1.requireAuth, async (_req, res) => {
        try {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const [activeChannels, createdToday, deletedToday, recentLogs, clockSettings, setupComplete] = await Promise.all([
                prisma.temporaryChannel.count({
                    where: { status: { in: [client_1.ChannelStatus.ACTIVE, client_1.ChannelStatus.EMPTY] } },
                }),
                prisma.temporaryChannel.count({ where: { createdAt: { gte: startOfDay } } }),
                prisma.temporaryChannel.count({
                    where: { status: client_1.ChannelStatus.DELETED, lastActiveAt: { gte: startOfDay } },
                }),
                prisma.logEntry.findMany({ orderBy: { timestamp: 'desc' }, take: 20 }),
                (0, settings_1.getClockDateSettings)(),
                (0, settings_1.isSetupComplete)(),
            ]);
            const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
            return res.json({
                botStatus: setupComplete ? 'running' : 'setup_required',
                tsStatus: tsConnection_1.tsManager.getStatus(),
                setupComplete,
                uptime: uptimeSec,
                uptimeFormatted: (0, helpers_1.formatUptime)(uptimeSec),
                activeChannels,
                createdToday,
                deletedToday,
                clockEnabled: clockSettings.clockEnabled,
                dateEnabled: clockSettings.dateEnabled,
                recentLogs,
            });
        }
        catch (err) {
            return res.status(500).json({ error: 'Failed to fetch status' });
        }
    });
    // ── GET /health ───────────────────────────────────────────────────────────
    // Public — used by Railway for healthcheck.
    router.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            ts: tsConnection_1.tsManager.getStatus(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
        });
    });
    return router;
}
//# sourceMappingURL=status.js.map