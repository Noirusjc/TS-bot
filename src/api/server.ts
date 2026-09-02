import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import ConnectPgSimple from 'connect-pg-simple';
import { config } from '../utils/config';
import { isSetupComplete } from '../utils/settings';
import { requireAuth, requireGuest } from './middleware/auth';

// Route factories
import { createAuthRouter } from './routes/auth';
import { createStatusRouter } from './routes/status';
import { createTempChannelsRouter } from './routes/tempChannels';
import { createClockDateRouter } from './routes/clockDate';
import { createPokeRouter } from './routes/poke';
import { createLogsRouter } from './routes/logs';
import { createSettingsRouter } from './routes/settings';
import { createSetupRouter } from './routes/setup';

export function createApp(prisma: PrismaClient): express.Application {
  const app = express();

  // ─── Security Headers ───────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
          fontSrc: ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
    })
  );

  // Allow any origin in development, restrict in production via APP_URL
  const corsOrigin = config.appUrl && config.appUrl !== '' ? config.appUrl : true;
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Session (stored in PostgreSQL) ────────────────────────────────────────
  const PgStore = ConnectPgSimple(session);
  app.use(
    session({
      store: new PgStore({
        conString: config.databaseUrl,
        tableName: 'session',
        createTableIfMissing: true,
      }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'ts3bot.sid',
      cookie: {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  // ─── Static Files ───────────────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, '../../public')));

  // ─── Health Endpoint (public — required by Railway) ─────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── Setup API (public — only active before setup is complete) ──────────────
  app.use('/api/setup', createSetupRouter(prisma));

  // ─── Protected API Routes ───────────────────────────────────────────────────
  app.use('/api/auth', createAuthRouter(prisma));
  app.use('/api/status', createStatusRouter(prisma));
  app.use('/api/temp-channels', createTempChannelsRouter(prisma));
  app.use('/api/clock-date', createClockDateRouter());
  app.use('/api/poke', createPokeRouter());
  app.use('/api/logs', createLogsRouter(prisma));
  app.use('/api/settings', createSettingsRouter(prisma));

  // ─── Setup Wizard Page (only available before setup) ───────────────────────
  app.get('/setup', async (req: Request, res: Response) => {
    try {
      const complete = await isSetupComplete();
      if (complete) return res.redirect('/login');
      res.sendFile(path.join(__dirname, '../../public/pages/setup.html'));
    } catch {
      res.sendFile(path.join(__dirname, '../../public/pages/setup.html'));
    }
  });

  // ─── Login Page ─────────────────────────────────────────────────────────────
  app.get('/login', requireGuest, (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../../public/pages/login.html'));
  });

  // ─── Protected Panel Pages ──────────────────────────────────────────────────
  const protectedPages = ['/dashboard', '/temporary-channels', '/clock-date', '/poke-message', '/logs', '/settings'];
  for (const page of protectedPages) {
    app.get(page, requireAuth, (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, `../../public/pages/${page.slice(1)}.html`));
    });
  }

  // ─── Root: smart redirect ────────────────────────────────────────────────────
  app.get('/', async (req: Request, res: Response) => {
    try {
      const complete = await isSetupComplete();
      if (!complete) return res.redirect('/setup');
      if (req.session?.userId) return res.redirect('/dashboard');
      res.redirect('/login');
    } catch {
      res.redirect('/login');
    }
  });

  // ─── 404 ────────────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ─── Error Handler ───────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const isDev = config.nodeEnv !== 'production';
    res.status(500).json({
      error: 'Internal server error',
      ...(isDev && { details: err.message }),
    });
  });

  return app;
}
