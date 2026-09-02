"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthRouter = createAuthRouter;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const logger_1 = require("../../utils/logger");
function createAuthRouter(prisma) {
    const router = (0, express_1.Router)();
    const loginLimiter = (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10,
        message: { error: 'Too many login attempts, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    // POST /api/auth/login
    router.post('/login', loginLimiter, [
        (0, express_validator_1.body)('username').trim().notEmpty().withMessage('Username required'),
        (0, express_validator_1.body)('password').notEmpty().withMessage('Password required'),
    ], async (req, res) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }
        const { username, password } = req.body;
        try {
            const user = await prisma.adminUser.findUnique({ where: { username } });
            if (!user) {
                void (0, logger_1.dbLog)({ eventType: 'LOGIN_FAILED', message: `Login failed for: ${username}`, level: 'WARN', status: 'error' });
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
            if (!valid) {
                void (0, logger_1.dbLog)({ eventType: 'LOGIN_FAILED', message: `Wrong password for: ${username}`, level: 'WARN', status: 'error' });
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.loginAt = Date.now();
            void (0, logger_1.dbLog)({ eventType: 'LOGIN_SUCCESS', message: `Admin logged in: ${username}` });
            return res.json({ success: true, username: user.username });
        }
        catch (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    });
    // POST /api/auth/logout
    router.post('/logout', (req, res) => {
        const username = req.session.username ?? 'unknown';
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            void (0, logger_1.dbLog)({ eventType: 'LOGOUT', message: `Admin logged out: ${username}` });
            res.json({ success: true });
        });
    });
    // GET /api/auth/me
    router.get('/me', (req, res) => {
        if (!req.session?.userId) {
            return res.status(401).json({ authenticated: false });
        }
        return res.json({ authenticated: true, username: req.session.username });
    });
    return router;
}
//# sourceMappingURL=auth.js.map