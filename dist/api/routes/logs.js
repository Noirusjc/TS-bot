"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogsRouter = createLogsRouter;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
function createLogsRouter(prisma) {
    const router = (0, express_1.Router)();
    router.use(auth_1.requireAuth);
    // GET /api/logs
    router.get('/', [
        (0, express_validator_1.query)('level').optional().isIn(['DEBUG', 'INFO', 'WARN', 'ERROR']),
        (0, express_validator_1.query)('page').optional().isInt({ min: 1 }),
        (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 200 }),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        try {
            const { level, eventType, search, from, to, page = '1', limit = '50', } = req.query;
            const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
            const take = parseInt(limit, 10);
            const where = {};
            if (level)
                where.level = level;
            if (eventType)
                where.eventType = { contains: eventType, mode: 'insensitive' };
            if (search) {
                where.OR = [
                    { message: { contains: search, mode: 'insensitive' } },
                    { eventType: { contains: search, mode: 'insensitive' } },
                ];
            }
            if (from || to) {
                where.timestamp = {};
                if (from)
                    where.timestamp.gte = new Date(from);
                if (to)
                    where.timestamp.lte = new Date(to);
            }
            const [logs, total] = await Promise.all([
                prisma.logEntry.findMany({
                    where,
                    orderBy: { timestamp: 'desc' },
                    skip,
                    take,
                }),
                prisma.logEntry.count({ where }),
            ]);
            res.json({
                logs,
                total,
                page: parseInt(page, 10),
                limit: take,
                pages: Math.ceil(total / take),
            });
        }
        catch {
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    });
    // DELETE /api/logs — clear old logs (older than X days)
    router.delete('/', auth_1.requireAuth, async (req, res) => {
        try {
            const days = parseInt(req.query.days ?? '30', 10);
            const cutoff = new Date(Date.now() - days * 86400 * 1000);
            const result = await prisma.logEntry.deleteMany({ where: { timestamp: { lt: cutoff } } });
            res.json({ deleted: result.count });
        }
        catch {
            res.status(500).json({ error: 'Failed to clear logs' });
        }
    });
    return router;
}
//# sourceMappingURL=logs.js.map