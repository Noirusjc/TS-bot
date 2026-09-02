import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { PrismaClient, LogLevel, Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

export function createLogsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /api/logs
  router.get(
    '/',
    [
      query('level').optional().isIn(['DEBUG', 'INFO', 'WARN', 'ERROR']),
      query('page').optional().isInt({ min: 1 }),
      query('limit').optional().isInt({ min: 1, max: 200 }),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      try {
        const {
          level,
          eventType,
          search,
          from,
          to,
          page = '1',
          limit = '50',
        } = req.query as Record<string, string>;

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const take = parseInt(limit, 10);

        const where: Prisma.LogEntryWhereInput = {};

        if (level) where.level = level as LogLevel;
        if (eventType) where.eventType = { contains: eventType, mode: 'insensitive' };
        if (search) {
          where.OR = [
            { message: { contains: search, mode: 'insensitive' } },
            { eventType: { contains: search, mode: 'insensitive' } },
          ];
        }
        if (from || to) {
          where.timestamp = {};
          if (from) where.timestamp.gte = new Date(from);
          if (to) where.timestamp.lte = new Date(to);
        }

        const [logs, total] = await Promise.all([
          prisma.logEntry.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            skip,
            take,
          }),
          prisma.logEntry.count({ where }),
        ]);

        res.json({
          logs,
          total,
          page: parseInt(page, 10),
          limit: take,
          pages: Math.ceil(total / take),
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch logs' });
      }
    }
  );

  // DELETE /api/logs — clear old logs (older than X days)
  router.delete('/', requireAuth, async (req: Request, res: Response) => {
    try {
      const days = parseInt((req.query.days as string) ?? '30', 10);
      const cutoff = new Date(Date.now() - days * 86400 * 1000);
      const result = await prisma.logEntry.deleteMany({ where: { timestamp: { lt: cutoff } } });
      res.json({ deleted: result.count });
    } catch {
      res.status(500).json({ error: 'Failed to clear logs' });
    }
  });

  return router;
}
