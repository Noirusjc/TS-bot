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

  // ── Guard: block all setup routes once setup is complete ──────────────────
  router.use(async (_req: Request, res: Response, next: NextFunction) => {
    const complete = await isSetupComplete().catch(() => false);
    if (complete) {
      return res.status(403).json({ error: 'Setup has already been completed.' });
    }
    next();
  });

  // ── GET /api/setup/status ─────────────────────────────────────────────────
  router.get('/status', async (_req: Request, res: Response) => {
    const complete = await isSetupComplete().catch(() => false);
    res.json({ setupComplete: complete });
  });

  // ── POST /api/setup/test-ts ───────────────────────────────────────────────
  // Test a TS connection without saving anything.
  router.post(
    '/test-ts',
    [
      body('tsHost').trim().notEmpty().withMessage('Host required'),
      body('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid port required'),
      body('tsQueryUsername').trim().notEmpty().withMessage('Username required'),
      body('tsQueryPassword').notEmpty().withMessage('Password required'),
      body('tsVirtualServerId').isInt({ min: 1 }).withMessage('Virtual server ID required'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const cfg: TSConfig = {
        host: String(req.body.tsHost),
        queryPort: parseInt(req.body.tsQueryPort, 10),
        username: String(req.body.tsQueryUsername),
        password: String(req.body.tsQueryPassword),
        virtualServerId: parseInt(req.body.tsVirtualServerId, 10),
        botNickname: String(req.body.tsBotNickname || 'TS3-Bot'),
      };

      // Use the static method on the class directly
      const result = await TSConnectionManager.testConnection(cfg);
      return res.json(result);
    }
  );

  // ── POST /api/setup/complete ──────────────────────────────────────────────
  // Full setup: saves all config, creates admin user, marks setup done,
  // triggers live bot connection.
  router.post(
    '/complete',
    [
      // TeamSpeak
      body('tsHost').trim().notEmpty().withMessage('TeamSpeak host is required'),
      body('tsQueryPort').isInt({ min: 1, max: 65535 }).withMessage('Valid ServerQuery port required'),
      body('tsQueryUsername').trim().notEmpty().withMessage('ServerQuery username required'),
      body('tsQueryPassword').notEmpty().withMessage('ServerQuery password required'),
      body('tsVirtualServerId').isInt({ min: 1 }).withMessage('Virtual server ID required'),
      // Admin account
      body('adminUsername').trim().isLength({ min: 3 }).withMessage('Admin username must be at least 3 characters'),
      body('adminPassword').isLength({ min: 8 }).withMessage('Admin password must be at least 8 characters'),
      body('adminPasswordConfirm').custom((val, { req: r }) => {
        if (val !== r.body.adminPassword) throw new Error('Passwords do not match');
        return true;
      }),
      // Optional channel IDs (must be numeric if provided)
      body('sourceChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Source channel ID must be numeric'),
      body('parentChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Parent channel ID must be numeric'),
      body('clockChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Clock channel ID must be numeric'),
      body('dateChannelId').optional({ checkFalsy: true }).isNumeric().withMessage('Date channel ID must be numeric'),
      body('channelGroupId').optional({ checkFalsy: true }).isNumeric().withMessage('Channel group ID must be numeric'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const b = req.body as Record<string, unknown>;

      try {
        // ── 1. Build TS config and run a live connection test ─────────────
        const tsCfg: TSConfig = {
          host: String(b.tsHost),
          queryPort: parseInt(String(b.tsQueryPort), 10),
          username: String(b.tsQueryUsername),
          password: String(b.tsQueryPassword),
          virtualServerId: parseInt(String(b.tsVirtualServerId), 10),
          botNickname: b.tsBotNickname ? String(b.tsBotNickname) : 'TS3-Bot',
        };

        const testResult = await TSConnectionManager.testConnection(tsCfg);
        if (!testResult.success) {
          return res.status(400).json({
            error: `TeamSpeak connection test failed: ${testResult.message}`,
            field: 'ts',
          });
        }

        // ── 2. Ensure all default settings rows exist ─────────────────────
        await ensureDefaultSettings();

        // ── 3. Save TeamSpeak credentials to database ─────────────────────
        await saveTSConfig(tsCfg);

        // ── 4. Create admin user (hash password) ──────────────────────────
        const adminUsername = String(b.adminUsername);
        const adminPassword = String(b.adminPassword);
        const passwordHash = await bcrypt.hash(adminPassword, 12);

        await prisma.adminUser.upsert({
          where: { username: adminUsername },
          update: { passwordHash },
          create: { username: adminUsername, passwordHash },
        });

        // ── 5. Save / update default temp channel rule ────────────────────
        const tempEnabled = b.tempChannelEnabled === true || b.tempChannelEnabled === 'true';
        const sourceChannelId = b.sourceChannelId ? String(b.sourceChannelId) : '0';
        const parentChannelId = b.parentChannelId ? String(b.parentChannelId) : null;
        const channelNamePrefix = b.channelNamePrefix ? String(b.channelNamePrefix) : 'Channel';
        const channelGroupId = b.channelGroupId ? String(b.channelGroupId) : null;

        const existingRule = await prisma.temporaryChannelRule.findFirst();
        if (existingRule) {
          await prisma.temporaryChannelRule.update({
            where: { id: existingRule.id },
            data: { enabled: tempEnabled, sourceChannelId, parentChannelId, channelNamePrefix, channelGroupId },
          });
        } else {
          await prisma.temporaryChannelRule.create({
            data: {
              name: 'Default Rule',
              enabled: tempEnabled,
              sourceChannelId,
              parentChannelId,
              channelNamePrefix,
              channelGroupId,
            },
          });
        }

        // ── 6. Save optional clock/date channel IDs ───────────────────────
        const extra: Record<string, string> = {};
        if (b.clockChannelId) { extra['clock_channel_id'] = String(b.clockChannelId); extra['clock_enabled'] = 'true'; }
        if (b.dateChannelId)  { extra['date_channel_id']  = String(b.dateChannelId);  extra['date_enabled']  = 'true'; }
        if (Object.keys(extra).length > 0) await setSettings(extra);

        // ── 7. Mark setup as complete (disables /setup permanently) ───────
        await markSetupComplete();

        void dbLog({
          eventType: 'SETUP_COMPLETED',
          message: `Setup completed. Admin: ${adminUsername}, TS: ${tsCfg.host}`,
          level: 'INFO',
        });

        // ── 8. Start bot services in background ───────────────────────────
        // reconfigure() tears down any existing connection and connects fresh
        tsManager.reconfigure(tsCfg).catch((err: Error) => {
          winstonLogger.warn(`[SETUP] Bot connect after setup: ${err.message}`);
        });

        // ── 9. Auto-login the user who just completed setup ───────────────
        const adminUser = await prisma.adminUser.findUnique({ where: { username: adminUsername } });
        if (adminUser) {
          req.session.userId = adminUser.id;
          req.session.username = adminUser.username;
          req.session.loginAt = Date.now();
        }

        return res.json({ success: true, message: 'Setup complete. Redirecting to dashboard...' });
      } catch (err) {
        winstonLogger.error(`[SETUP] Setup failed: ${(err as Error).message}`);
        return res.status(500).json({ error: `Setup failed: ${(err as Error).message}` });
      }
    }
  );

  return router;
}
