import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth';
import { getPokeSettings, setSettings } from '../../utils/settings';
import { fillTemplate } from '../../utils/helpers';
import { dbLog } from '../../utils/logger';

export function createPokeRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /api/poke
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const settings = await getPokeSettings();
      res.json(settings);
    } catch {
      res.status(500).json({ error: 'Failed to fetch poke settings' });
    }
  });

  // PUT /api/poke
  router.put(
    '/',
    [
      body('template').notEmpty().withMessage('Template required'),
    ],
    async (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      try {
        const { template, templateNoPassword } = req.body as { template: string; templateNoPassword?: string };
        const pairs: Record<string, string> = { poke_template: template };
        if (templateNoPassword) pairs['poke_template_no_password'] = templateNoPassword;

        await setSettings(pairs);
        void dbLog({ eventType: 'POKE_TEMPLATE_UPDATED', message: 'Poke template updated' });
        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to update poke template' });
      }
    }
  );

  // POST /api/poke/preview — render preview with sample values
  router.post('/preview', async (req: Request, res: Response) => {
    try {
      const { template } = req.body as { template: string };
      if (!template) return res.status(400).json({ error: 'Template required' });

      const preview = fillTemplate(template, {
        USER_NICKNAME: 'Amir',
        CHANNEL_NAME: 'Gaming | Amir',
        CHANNEL_PASSWORD: 'Abc12345',
      });
      res.json({ preview });
    } catch {
      res.status(500).json({ error: 'Preview failed' });
    }
  });

  return router;
}
