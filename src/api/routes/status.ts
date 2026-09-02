import { Router, Request, Response } from 'express';
import { PrismaClient, ChannelStatus } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { tsManager } from '../../services/tsConnection';
import { formatUptime } from '../../utils/helpers';
import { getClockDateSettings, isSetupComplete } from '../../utils/settings';

const startTime = Date.now();

export function createStatusRouter(prisma: PrismaClient): Router {
  const router = Router();

  // ── GET /api/status ───────────────────────────────────────────────────────
  // Protected — requires login. Returns full dashboard status.
  router.get('/', requireAuth, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const [activeChannels, createdToday, deletedToday, recentLogs, clockSettings, setupComplete] =
        await Promise.all([
          prisma.temporaryChannel.count({
            where: { status: { in: [ChannelStatus.ACTIVE, ChannelStatus.EMPTY] } },
          }),
          prisma.temporaryChannel.count({ where: { createdAt: { gte: startOfDay } } }),
          prisma.temporaryChannel.count({
            where: { status: ChannelStatus.DELETED, lastActiveAt: { gte: startOfDay } },
          }),
          prisma.logEntry.findMany({ orderBy: { timestamp: 'desc' }, take: 20 }),
          getClockDateSettings(),
          isSetupComplete(),
        ]);

      const uptimeSec = Math.floor((Date.now() - startTime) / 1000);

      return res.json({
        botStatus: setupComplete ? 'running' : 'setup_required',
        tsStatus: tsManager.getStatus(),
        setupComplete,
        uptime: uptimeSec,
        uptimeFormatted: formatUptime(uptimeSec),
        activeChannels,
        createdToday,
        deletedToday,
        clockEnabled: clockSettings.clockEnabled,
        dateEnabled: clockSettings.dateEnabled,
        recentLogs,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  // ── GET /health ───────────────────────────────────────────────────────────
  // Public — used by Railway for healthcheck.
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      ts: tsManager.getStatus(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  return router;
}
