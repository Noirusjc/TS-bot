import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth';
import { setSettings, getClockDateSettings } from '../../utils/settings';
import { startClockDateService, stopClockDateService, previewClock, previewDate } from '../../services/clockDateService';
import { dbLog } from '../../utils/logger';

export function createClockDateRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /api/clock-date
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const settings = await getClockDateSettings();
      const clockPreview = settings.clockEnabled ? previewClock(settings.clockFormat) : null;
      const datePreview = settings.dateEnabled ? previewDate(settings.dateFormat) : null;
      res.json({ ...settings, clockPreview, datePreview });
    } catch {
      res.status(500).json({ error: 'Failed to fetch clock/date settings' });
    }
  });

  // PUT /api/clock-date
  router.put(
    '/',
    [
      body('clockUpdateInterval').optional().isInt({ min: 10, max: 3600 }),
      body('dateUpdateInterval').optional().isInt({ min: 10, max: 3600 }),
      body('clockChannelId').optional().custom((v) => v === '' || /^\d+$/.test(v)).withMessage('Clock channel ID must be numeric'),
      body('dateChannelId').optional().custom((v) => v === '' || /^\d+$/.test(v)).withMessage('Date channel ID must be numeric'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      try {
        const d = req.body;
        const pairs: Record<string, string> = {};

        if (d.clockEnabled !== undefined) pairs['clock_enabled'] = d.clockEnabled ? 'true' : 'false';
        if (d.clockChannelId !== undefined) pairs['clock_channel_id'] = String(d.clockChannelId);
        if (d.clockFormat !== undefined) pairs['clock_format'] = String(d.clockFormat);
        if (d.clockUpdateInterval !== undefined) pairs['clock_update_interval'] = String(d.clockUpdateInterval);
        if (d.dateEnabled !== undefined) pairs['date_enabled'] = d.dateEnabled ? 'true' : 'false';
        if (d.dateChannelId !== undefined) pairs['date_channel_id'] = String(d.dateChannelId);
        if (d.dateFormat !== undefined) pairs['date_format'] = String(d.dateFormat);
        if (d.dateUpdateInterval !== undefined) pairs['date_update_interval'] = String(d.dateUpdateInterval);

        await setSettings(pairs);

        // Restart clock/date service with new settings
        stopClockDateService();
        await startClockDateService();

        void dbLog({ eventType: 'CLOCK_DATE_SETTINGS_UPDATED', message: 'Clock/date settings updated and service restarted' });
        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to update settings' });
      }
    }
  );

  // GET /api/clock-date/preview
  router.get('/preview', async (req: Request, res: Response) => {
    const { clockFormat, dateFormat } = req.query as { clockFormat?: string; dateFormat?: string };
    res.json({
      clockPreview: clockFormat ? previewClock(clockFormat) : null,
      datePreview: dateFormat ? previewDate(dateFormat) : null,
    });
  });

  return router;
}
