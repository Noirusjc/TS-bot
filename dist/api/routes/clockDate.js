"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClockDateRouter = createClockDateRouter;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const settings_1 = require("../../utils/settings");
const clockDateService_1 = require("../../services/clockDateService");
const logger_1 = require("../../utils/logger");
function createClockDateRouter() {
    const router = (0, express_1.Router)();
    router.use(auth_1.requireAuth);
    // GET /api/clock-date
    router.get('/', async (_req, res) => {
        try {
            const settings = await (0, settings_1.getClockDateSettings)();
            const clockPreview = settings.clockEnabled ? (0, clockDateService_1.previewClock)(settings.clockFormat) : null;
            const datePreview = settings.dateEnabled ? (0, clockDateService_1.previewDate)(settings.dateFormat) : null;
            res.json({ ...settings, clockPreview, datePreview });
        }
        catch {
            res.status(500).json({ error: 'Failed to fetch clock/date settings' });
        }
    });
    // PUT /api/clock-date
    router.put('/', [
        (0, express_validator_1.body)('clockUpdateInterval').optional().isInt({ min: 10, max: 3600 }),
        (0, express_validator_1.body)('dateUpdateInterval').optional().isInt({ min: 10, max: 3600 }),
        (0, express_validator_1.body)('clockChannelId').optional().custom((v) => v === '' || /^\d+$/.test(v)).withMessage('Clock channel ID must be numeric'),
        (0, express_validator_1.body)('dateChannelId').optional().custom((v) => v === '' || /^\d+$/.test(v)).withMessage('Date channel ID must be numeric'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        try {
            const d = req.body;
            const pairs = {};
            if (d.clockEnabled !== undefined)
                pairs['clock_enabled'] = d.clockEnabled ? 'true' : 'false';
            if (d.clockChannelId !== undefined)
                pairs['clock_channel_id'] = String(d.clockChannelId);
            if (d.clockFormat !== undefined)
                pairs['clock_format'] = String(d.clockFormat);
            if (d.clockUpdateInterval !== undefined)
                pairs['clock_update_interval'] = String(d.clockUpdateInterval);
            if (d.dateEnabled !== undefined)
                pairs['date_enabled'] = d.dateEnabled ? 'true' : 'false';
            if (d.dateChannelId !== undefined)
                pairs['date_channel_id'] = String(d.dateChannelId);
            if (d.dateFormat !== undefined)
                pairs['date_format'] = String(d.dateFormat);
            if (d.dateUpdateInterval !== undefined)
                pairs['date_update_interval'] = String(d.dateUpdateInterval);
            await (0, settings_1.setSettings)(pairs);
            // Restart clock/date service with new settings
            (0, clockDateService_1.stopClockDateService)();
            await (0, clockDateService_1.startClockDateService)();
            void (0, logger_1.dbLog)({ eventType: 'CLOCK_DATE_SETTINGS_UPDATED', message: 'Clock/date settings updated and service restarted' });
            res.json({ success: true });
        }
        catch {
            res.status(500).json({ error: 'Failed to update settings' });
        }
    });
    // GET /api/clock-date/preview
    router.get('/preview', async (req, res) => {
        const { clockFormat, dateFormat } = req.query;
        res.json({
            clockPreview: clockFormat ? (0, clockDateService_1.previewClock)(clockFormat) : null,
            datePreview: dateFormat ? (0, clockDateService_1.previewDate)(dateFormat) : null,
        });
    });
    return router;
}
//# sourceMappingURL=clockDate.js.map