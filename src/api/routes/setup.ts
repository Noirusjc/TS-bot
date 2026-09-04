import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import {
  isSetupComplete,
  markSetupComplete,
  saveTSConfig,
  setSettings,
  ensureDefaultSettings,
} from '../../utils/settings';
import { dbLog, winstonLogger } from '../../utils/logger';
import { tsManager, TSConnectionManager } from '../../services/tsConnection';
import type { TSConfig } from '../../utils/config';

export function createSetupRouter(prisma: PrismaClient): Router {
  const router = Router();

  // ── Guard: block once setup is complete ───────────────────────────────────
  router.use(async (_req: Request, res: Response, next: NextFunction) => {
    const complete = await isSetupComplete().catch(() => false);
    if (complete) return res.status(403).json({ error: 'Setup has already been completed.' });
    next();
  });

  // ── GET /api/setup/status ─────────────────────────────────────────────────
  router.get('/status', async (_req: Request, res: Response) => {
    const complete = await isSetupComplete().catch(() => false);
    res.json({ setupComplete: complete });
  });

  // ── POST /api/setup/test-ts ───────────────────────────────────────────────
  // Test the connection and auto-detect virtual server — nothing is saved.
  router.post(
    '/test-ts',
    [
      body('tsHost').trim().notEmpty().withMessage('Host required'),
      body('tsServerPort').isInt({ min: 1, max: 65535 }).withMessage('Valid TeamSpeak server port required (e.g. 9987)'),
      body('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid ServerQuery port required (e.g. 10011)'),
      body('tsQueryUsername').trim().notEmpty().withMessage('ServerQuery username required'),
      body('tsQueryPassword').notEmpty().withMessage('ServerQuery password required'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      const cfg: TSConfig = {
        host:       String(req.body.tsHost),
        serverPort: parseInt(req.body.tsServerPort, 10),
        queryPort:  parseInt(req.body.tsQueryPort, 10),
        username:   String(req.body.tsQueryUsername),
        password:   String(req.body.tsQueryPassword),
        botNickname: String(req.body.tsBotNickname || 'TS3-Bot'),
      };

      const result = await TSConnectionManager.testConnection(cfg);
      return res.json(result);
    }
  );

  // ── POST /api/setup/complete ──────────────────────────────────────────────
  router.post(
    '/complete',
    [
      // TeamSpeak — no virtualServerId required
      body('tsHost').trim().notEmpty().withMessage('TeamSpeak host is required'),
      body('tsServerPort').isInt({ min: 1, max: 65535 }).withMessage('TeamSpeak server port required (e.g. 9987)'),
      body('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('ServerQuery port required (e.g. 10011)'),
      body('tsQueryUsername').trim().notEmpty().withMessage('ServerQuery username required'),
      body('tsQueryPassword').notEmpty().withMessage('ServerQuery password required'),
      // Admin account
      body('adminUsername').trim().isLength({ min: 3 }).withMessage('Admin username must be at least 3 characters'),
      body('adminPassword').isLength({ min: 8 }).withMessage('Admin password must be at least 8 characters'),
      body('adminPasswordConfirm').custom((val, { req: r }) => {
        if (val !== r.body.adminPassword) throw new Error('Passwords do not match');
        return true;
      }),
      // Optional channel IDs
      body('sourceChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Source channel ID must be numeric'),
      body('parentChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Parent channel ID must be numeric'),
      body('clockChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Clock channel ID must be numeric'),
      body('dateChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Date channel ID must be numeric'),
      body('channelGroupId').optional({ checkFalsy: true }).isNumeric().withMessage('Channel group ID must be numeric'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      const b = req.body as Record<string, unknown>;

      try {
        // ── 1. Build TS config (no virtualServerId needed from user) ──────
        const tsCfg: TSConfig = {
          host:       String(b.tsHost),
          serverPort: parseInt(String(b.tsServerPort), 10),
          queryPort:  parseInt(String(b.tsQueryPort), 10),
          username:   String(b.tsQueryUsername),
          password:   String(b.tsQueryPassword),
          botNickname: b.tsBotNickname ? String(b.tsBotNickname) : 'TS3-Bot',
        };

        // ── 2. Test connection and auto-detect virtual server ID ──────────
        const testResult = await TSConnectionManager.testConnection(tsCfg);
        if (!testResult.success) {
          return res.status(400).json({
            error: `TeamSpeak connection failed: ${testResult.message}`,
            field: 'ts',
          });
        }

        // Store the detected virtual server ID for fast reconnects
        if (testResult.detectedVirtualServerId) {
          tsCfg.detectedVirtualServerId = testResult.detectedVirtualServerId;
        }

        // ── 3. Ensure default settings rows ───────────────────────────────
        await ensureDefaultSettings();

        // ── 4. Save TS config ─────────────────────────────────────────────
        await saveTSConfig(tsCfg);

        // ── 5. Create admin user ──────────────────────────────────────────
        const adminUsername = String(b.adminUsername);
        const adminPassword = String(b.adminPassword);
        const passwordHash = await bcrypt.hash(adminPassword, 12);

        await prisma.adminUser.upsert({
          where: { username: adminUsername },
          update: { passwordHash },
          create: { username: adminUsername, passwordHash },
        });

        // ── 6. Save / update default temp channel rule ────────────────────
        const tempEnabled = b.tempChannelEnabled === true || b.tempChannelEnabled === 'true';
        const existingRule = await prisma.temporaryChannelRule.findFirst();
        const ruleData = {
          enabled:          tempEnabled,
          sourceChannelId:  b.sourceChannelId ? String(b.sourceChannelId) : '0',
          parentChannelId:  b.parentChannelId ? String(b.parentChannelId) : null,
          channelNamePrefix:b.channelNamePrefix ? String(b.channelNamePrefix) : 'Channel',
          channelGroupId:   b.channelGroupId ? String(b.channelGroupId) : null,
        };

        if (existingRule) {
          await prisma.temporaryChannelRule.update({ where: { id: existingRule.id }, data: ruleData });
        } else {
          await prisma.temporaryChannelRule.create({ data: { name: 'Default Rule', ...ruleData } });
        }

        // ── 7. Save optional clock/date channel IDs ───────────────────────
        const extra: Record<string, string> = {};
        if (b.clockChannelId) { extra['clock_channel_id'] = String(b.clockChannelId); extra['clock_enabled'] = 'true'; }
        if (b.dateChannelId)  { extra['date_channel_id']  = String(b.dateChannelId);  extra['date_enabled']  = 'true'; }
        if (Object.keys(extra).length > 0) await setSettings(extra);

        // ── 8. Mark setup complete ────────────────────────────────────────
        await markSetupComplete();

        void dbLog({
          eventType: 'SETUP_COMPLETED',
          message: `Setup complete. Admin: ${adminUsername}, TS: ${tsCfg.host}:${tsCfg.serverPort}, VS ID: ${tsCfg.detectedVirtualServerId ?? 'auto'}`,
          level: 'INFO',
        });

        // ── 9. Activate bot in background ─────────────────────────────────
        tsManager.reconfigure(tsCfg).catch((err: Error) => {
          winstonLogger.warn(`[SETUP] Bot connect after setup: ${err.message}`);
        });

        // ── 10. Auto-login ────────────────────────────────────────────────
        const adminUser = await prisma.adminUser.findUnique({ where: { username: adminUsername } });
        if (adminUser) {
          req.session.userId   = adminUser.id;
          req.session.username = adminUser.username;
          req.session.loginAt  = Date.now();
        }

        return res.json({
          success: true,
          message: 'Setup complete. Redirecting to dashboard...',
          serverName: testResult.serverName,
          detectedVirtualServerId: tsCfg.detectedVirtualServerId,
        });
      } catch (err) {
        winstonLogger.error(`[SETUP] Setup failed: ${(err as Error).message}`);
        return res.status(500).json({ error: `Setup failed: ${(err as Error).message}` });
      }
    }
  );

  return router;
}
