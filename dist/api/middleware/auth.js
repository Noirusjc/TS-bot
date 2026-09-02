"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireGuest = requireGuest;
function requireAuth(req, res, next) {
    if (req.session?.userId) {
        return next();
    }
    // API vs page request
    if (req.path.startsWith('/api/')) {
        res.status(401).json({ error: 'Unauthorized' });
    }
    else {
        res.redirect('/login');
    }
}
function requireGuest(req, res, next) {
    if (req.session?.userId) {
        return res.redirect('/dashboard');
    }
    next();
}
//# sourceMappingURL=auth.js.map