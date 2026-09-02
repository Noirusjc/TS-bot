import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { dbLog } from '../../utils/logger';

export function createAuthRouter(prisma: PrismaClient): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: 'Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // POST /api/auth/login
  router.post(
    '/login',
    loginLimiter,
    [
      body('username').trim().notEmpty().withMessage('Username required'),
      body('password').notEmpty().withMessage('Password required'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { username, password } = req.body as { username: string; password: string };

      try {
        const user = await prisma.adminUser.findUnique({ where: { username } });
        if (!user) {
          void dbLog({ eventType: 'LOGIN_FAILED', message: `Login failed for: ${username}`, level: 'WARN', status: 'error' });
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          void dbLog({ eventType: 'LOGIN_FAILED', message: `Wrong password for: ${username}`, level: 'WARN', status: 'error' });
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.loginAt = Date.now();

        void dbLog({ eventType: 'LOGIN_SUCCESS', message: `Admin logged in: ${username}` });
        return res.json({ success: true, username: user.username });
      } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  // POST /api/auth/logout
  router.post('/logout', (req: Request, res: Response) => {
    const username = req.session.username ?? 'unknown';
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      void dbLog({ eventType: 'LOGOUT', message: `Admin logged out: ${username}` });
      res.json({ success: true });
    });
  });

  // GET /api/auth/me
  router.get('/me', (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ authenticated: false });
    }
    return res.json({ authenticated: true, username: req.session.username });
  });

  return router;
}
