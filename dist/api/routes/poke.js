"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPokeRouter = createPokeRouter;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const settings_1 = require("../../utils/settings");
const helpers_1 = require("../../utils/helpers");
const logger_1 = require("../../utils/logger");
function createPokeRouter() {
    const router = (0, express_1.Router)();
    router.use(auth_1.requireAuth);
    // GET /api/poke
    router.get('/', async (_req, res) => {
        try {
            const settings = await (0, settings_1.getPokeSettings)();
            res.json(settings);
        }
        catch {
            res.status(500).json({ error: 'Failed to fetch poke settings' });
        }
    });
    // PUT /api/poke
    router.put('/', [
        (0, express_validator_1.body)('template').notEmpty().withMessage('Template required'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return res.status(400).json({ error: errors.array()[0].msg });
        try {
            const { template, templateNoPassword } = req.body;
            const pairs = { poke_template: template };
            if (templateNoPassword)
                pairs['poke_template_no_password'] = templateNoPassword;
            await (0, settings_1.setSettings)(pairs);
            void (0, logger_1.dbLog)({ eventType: 'POKE_TEMPLATE_UPDATED', message: 'Poke template updated' });
            res.json({ success: true });
        }
        catch {
            res.status(500).json({ error: 'Failed to update poke template' });
        }
    });
    // POST /api/poke/preview — render preview with sample values
    router.post('/preview', async (req, res) => {
        try {
            const { template } = req.body;
            if (!template)
                return res.status(400).json({ error: 'Template required' });
            const preview = (0, helpers_1.fillTemplate)(template, {
                USER_NICKNAME: 'Amir',
                CHANNEL_NAME: 'Gaming | Amir',
                CHANNEL_PASSWORD: 'Abc12345',
            });
            res.json({ preview });
        }
        catch {
            res.status(500).json({ error: 'Preview failed' });
        }
    });
    return router;
}
//# sourceMappingURL=poke.js.map