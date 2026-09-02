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

  // ─── Security Headers ────────────────────────────────────────────────────────
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

  const corsOrigin = config.appUrl && config.appUrl !== '' ? config.appUrl : true;
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Health endpoint — registered BEFORE session middleware ──────────────────
  // This guarantees /health always responds even if session store has issues.
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── Session ─────────────────────────────────────────────────────────────────
  // Use memory store as fallback if DATABASE_URL is missing (prevents crash)
  let sessionStore: session.Store | undefined;
  if (config.databaseUrl) {
    try {
      const PgStore = ConnectPgSimple(session);
      sessionStore = new PgStore({
        conString: config.databaseUrl,
        tableName: 'session',
        createTableIfMissing: true,
      });
    } catch (err) {
      console.error('[SESSION] Failed to create PG session store, falling back to memory store:', (err as Error).message);
      sessionStore = undefined; // will use default memory store
    }
  } else {
    console.warn('[SESSION] DATABASE_URL not set — using in-memory session store (sessions lost on restart)');
  }

  app.use(
    session({
      ...(sessionStore ? { store: sessionStore } : {}),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'ts3bot.sid',
      cookie: {
        httpOnly: true,
        // Only send secure cookies when actually behind HTTPS (Railway)
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  // ─── Static Files ─────────────────────────────────────────────────────────────
  const publicDir = path.join(__dirname, '../../public');
  app.use(express.static(publicDir));

  // ─── Setup API (public — blocked after setup completes) ──────────────────────
  app.use('/api/setup', createSetupRouter(prisma));

  // ─── Protected API Routes ─────────────────────────────────────────────────────
  app.use('/api/auth', createAuthRouter(prisma));
  app.use('/api/status', createStatusRouter(prisma));
  app.use('/api/temp-channels', createTempChannelsRouter(prisma));
  app.use('/api/clock-date', createClockDateRouter());
  app.use('/api/poke', createPokeRouter());
  app.use('/api/logs', createLogsRouter(prisma));
  app.use('/api/settings', createSettingsRouter(prisma));

  // ─── Setup Wizard Page ────────────────────────────────────────────────────────
  app.get('/setup', async (_req: Request, res: Response) => {
    try {
      const complete = await isSetupComplete();
      if (complete) return res.redirect('/login');
    } catch { /* DB not ready yet — show setup page anyway */ }
    res.sendFile(path.join(publicDir, 'pages/setup.html'));
  });

  // ─── Login Page ───────────────────────────────────────────────────────────────
  app.get('/login', requireGuest, (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'pages/login.html'));
  });

  // ─── Protected Panel Pages ────────────────────────────────────────────────────
  const protectedPages = [
    '/dashboard', '/temporary-channels', '/clock-date',
    '/poke-message', '/logs', '/settings',
  ];
  for (const page of protectedPages) {
    app.get(page, requireAuth, (_req: Request, res: Response) => {
      res.sendFile(path.join(publicDir, `pages/${page.slice(1)}.html`));
    });
  }

  // ─── Root redirect ────────────────────────────────────────────────────────────
  app.get('/', async (req: Request, res: Response) => {
    try {
      const complete = await isSetupComplete();
      if (!complete) return res.redirect('/setup');
    } catch { return res.redirect('/setup'); }
    if (req.session?.userId) return res.redirect('/dashboard');
    res.redirect('/login');
  });

  // ─── 404 ──────────────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ─── Global error handler ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[EXPRESS]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
