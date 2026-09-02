import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/auth';
import { tsManager, TSConnectionManager } from '../../services/tsConnection';
import { saveTSConfig, getTSConfig } from '../../utils/settings';
import { dbLog } from '../../utils/logger';
import { startClockDateService, stopClockDateService } from '../../services/clockDateService';
import { startCleanupScheduler, stopCleanupScheduler } from '../../services/tempChannelService';
import { registerTSEvents } from '../../services/tsEventHandler';

export function createSettingsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth);

  // ── PUT /api/settings/password ────────────────────────────────────────────
  router.put(
    '/password',
    [
      body('currentPassword').notEmpty().withMessage('Current password required'),
      body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      try {
        const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
        const user = await prisma.adminUser.findUnique({ where: { id: req.session.userId! } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const valid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

        const newHash = await bcrypt.hash(newPassword, 12);
        await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash: newHash } });

        void dbLog({ eventType: 'PASSWORD_CHANGED', message: `Admin password changed for: ${user.username}` });
        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to change password' });
      }
    }
  );

  // ── GET /api/settings/ts ──────────────────────────────────────────────────
  // Return current TS config from DB (password redacted)
  router.get('/ts', async (_req: Request, res: Response) => {
    try {
      const cfg = await getTSConfig();
      if (!cfg) return res.json({ configured: false });
      res.json({
        configured: true,
        host: cfg.host,
        queryPort: cfg.queryPort,
        username: cfg.username,
        // Never expose password
        password: '••••••••',
        virtualServerId: cfg.virtualServerId,
        botNickname: cfg.botNickname,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch TS config' });
    }
  });

  // ── PUT /api/settings/ts ──────────────────────────────────────────────────
  // Update TS credentials and reconnect dynamically
  router.put(
    '/ts',
    [
      body('host').trim().notEmpty().withMessage('Host required'),
      body('queryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid port required'),
      body('username').trim().notEmpty().withMessage('Username required'),
      body('password').notEmpty().withMessage('Password required'),
      body('virtualServerId').isInt({ min: 1 }).withMessage('Virtual server ID required'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      try {
        const { host, queryPort, username, password, virtualServerId, botNickname } = req.body as Record<string, string>;

        const cfg = {
          host,
          queryPort: parseInt(queryPort, 10),
          username,
          password,
          virtualServerId: parseInt(virtualServerId, 10),
          botNickname: botNickname || 'TS3-Bot',
        };

        // Test before saving
        const test = await TSConnectionManager.testConnection(cfg);
        if (!test.success) {
          return res.status(400).json({ error: `Connection test failed: ${test.message}` });
        }

        await saveTSConfig(cfg);
        void dbLog({ eventType: 'TS_CREDENTIALS_UPDATED', message: `TS credentials updated. Host: ${host}` });

        // Reconfigure live connection — runs in background
        tsManager.reconfigure(cfg).catch(() => { /* errors are logged inside */ });

        res.json({ success: true, message: 'TS credentials saved and reconnecting...' });
      } catch {
        res.status(500).json({ error: 'Failed to update TS settings' });
      }
    }
  );

  // ── POST /api/settings/ts-test ────────────────────────────────────────────
  // Quick live connection test using current saved config
  router.post('/ts-test', async (_req: Request, res: Response) => {
    try {
      const status = tsManager.getStatus();
      if (status === 'connected') {
        const version = await tsManager.run((ts) => ts.version());
        return res.json({ success: !!version, status, version });
      }
      // Not connected — try a fresh test with saved config
      const cfg = await getTSConfig();
      if (!cfg) return res.json({ success: false, message: 'TeamSpeak not configured' });
      const result = await TSConnectionManager.testConnection(cfg);
      return res.json(result);
    } catch {
      return res.status(500).json({ error: 'Test failed' });
    }
  });

  // ── POST /api/settings/ts-reconnect ──────────────────────────────────────
  router.post('/ts-reconnect', async (_req: Request, res: Response) => {
    try {
      const cfg = await getTSConfig();
      if (!cfg) return res.status(400).json({ error: 'TeamSpeak not configured' });
      tsManager.reconfigure(cfg).catch(() => { /* errors logged inside */ });
      res.json({ success: true, message: 'Reconnect initiated' });
    } catch {
      res.status(500).json({ error: 'Reconnect failed' });
    }
  });

  return router;
}
