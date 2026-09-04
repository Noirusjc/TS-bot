import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/auth';
import { tsManager, TSConnectionManager } from '../../services/tsConnection';
import { saveTSConfig, getTSConfig } from '../../utils/settings';
import { dbLog } from '../../utils/logger';

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
  router.get('/ts', async (_req: Request, res: Response) => {
    try {
      const cfg = await getTSConfig();
      if (!cfg) return res.json({ configured: false });
      res.json({
        configured: true,
        host: cfg.host,
        serverPort: cfg.serverPort,
        queryPort: cfg.queryPort,
        username: cfg.username,
        password: '••••••••',   // never expose the actual password
        botNickname: cfg.botNickname,
        // detectedVirtualServerId is intentionally exposed here for debugging
        detectedVirtualServerId: cfg.detectedVirtualServerId,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch TS config' });
    }
  });

  // ── PUT /api/settings/ts ──────────────────────────────────────────────────
  // Update TS credentials — auto-detects virtual server, then reconnects.
  router.put(
    '/ts',
    [
      body('host').trim().notEmpty().withMessage('Host required'),
      body('serverPort').isInt({ min: 1, max: 65535 }).withMessage('Valid TeamSpeak server port required (e.g. 9987)'),
      body('queryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid ServerQuery port required (e.g. 10011)'),
      body('username').trim().notEmpty().withMessage('Username required'),
      body('password').notEmpty().withMessage('Password required'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      try {
        const { host, serverPort, queryPort, username, password, botNickname } = req.body as Record<string, string>;

        const cfg = {
          host,
          serverPort:  parseInt(serverPort, 10),
          queryPort:   parseInt(queryPort, 10),
          username,
          password,
          botNickname: botNickname || 'TS3-Bot',
        };

        // Test and auto-detect before saving
        const test = await TSConnectionManager.testConnection(cfg);
        if (!test.success) {
          return res.status(400).json({ error: `Connection test failed: ${test.message}` });
        }

        // Persist with detected virtual server ID
        const cfgToSave = {
          ...cfg,
          detectedVirtualServerId: test.detectedVirtualServerId,
        };
        await saveTSConfig(cfgToSave);

        void dbLog({
          eventType: 'TS_CREDENTIALS_UPDATED',
          message: `TS credentials updated. Host: ${host}:${serverPort}, VS ID: ${test.detectedVirtualServerId ?? 'auto'}`,
        });

        // Reconnect in background
        tsManager.reconfigure(cfgToSave).catch(() => { /* errors logged inside */ });

        res.json({
          success: true,
          message: 'Settings saved and reconnecting...',
          serverName: test.serverName,
          detectedVirtualServerId: test.detectedVirtualServerId,
        });
      } catch {
        res.status(500).json({ error: 'Failed to update TS settings' });
      }
    }
  );

  // ── POST /api/settings/ts-test ────────────────────────────────────────────
  router.post('/ts-test', async (_req: Request, res: Response) => {
    try {
      const status = tsManager.getStatus();
      if (status === 'connected') {
        const version = await tsManager.run((ts) => ts.version());
        const info    = await tsManager.run((ts) => ts.serverInfo()).catch(() => null);
        const serverName = (info as unknown as Record<string, string> | null)?.virtualserverName;
        return res.json({ success: !!version, status, version, serverName });
      }
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
