import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { winstonLogger, initDbLogger, dbLog } from './utils/logger';
import { config } from './utils/config';
import { initSettings, ensureDefaultSettings, isSetupComplete, getTSConfig } from './utils/settings';
import { tsManager } from './services/tsConnection';
import { registerTSEvents } from './services/tsEventHandler';
import { initTempChannelService, startCleanupScheduler, stopCleanupScheduler } from './services/tempChannelService';
import { startClockDateService, stopClockDateService } from './services/clockDateService';
import { createApp } from './api/server';

// ─── Startup diagnostics ──────────────────────────────────────────────────────
winstonLogger.info('╔═══════════════════════════════════════╗');
winstonLogger.info('║     TS3 Management Bot — Starting     ║');
winstonLogger.info('╚═══════════════════════════════════════╝');
winstonLogger.info(`[STARTUP] NODE_ENV  : ${process.env.NODE_ENV ?? 'not set'}`);
winstonLogger.info(`[STARTUP] PORT      : ${process.env.PORT ?? 'not set → will use 3000'}`);
winstonLogger.info(`[STARTUP] DB present: ${process.env.DATABASE_URL ? 'yes' : 'NO — missing DATABASE_URL'}`);

const prisma = new PrismaClient({ log: ['error', 'warn'] });

// ─── Graceful shutdown helper ─────────────────────────────────────────────────
function setupShutdownHandlers(closeServer: () => void) {
  async function gracefulShutdown(signal: string) {
    winstonLogger.info(`[APP] ${signal} received — shutting down...`);
    closeServer();
    stopClockDateService();
    stopCleanupScheduler();
    tsManager.destroy();
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    winstonLogger.info('[APP] Shutdown complete.');
    process.exit(0);
  }

  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void gracefulShutdown('SIGINT'); });

  process.on('unhandledRejection', (reason) => {
    winstonLogger.error(`[APP] Unhandled rejection: ${String(reason)}`);
    // Do NOT exit — keep the server alive
  });
  process.on('uncaughtException', (err) => {
    winstonLogger.error(`[APP] Uncaught exception: ${err.message}`);
    // Do NOT exit for non-fatal errors
  });
}

// ─── Background initialisation (runs AFTER HTTP server is already up) ─────────
async function initBackground(): Promise<void> {
  // ── 1. Connect to PostgreSQL ────────────────────────────────────────────────
  try {
    await prisma.$connect();
    winstonLogger.info('[DB] Connected to PostgreSQL');
  } catch (err) {
    winstonLogger.error(`[DB] Failed to connect: ${(err as Error).message}`);
    winstonLogger.warn('[DB] App will continue running — DB may become available later');
    // Don't exit — Railway will restart if truly broken,
    // but a temporary DB hiccup should not kill the process.
    return;
  }

  // ── 2. Boot in-memory modules ───────────────────────────────────────────────
  initDbLogger(prisma);
  initSettings(prisma);
  initTempChannelService(prisma);

  // ── 3. Ensure default settings rows exist ───────────────────────────────────
  try {
    await ensureDefaultSettings();
    winstonLogger.info('[DB] Default settings verified');
  } catch (err) {
    winstonLogger.warn(`[DB] ensureDefaultSettings: ${(err as Error).message}`);
  }

  void dbLog({ eventType: 'APP_STARTED', message: 'Application started', level: 'INFO' });

  // ── 4. Register TS lifecycle hooks ──────────────────────────────────────────
  tsManager.onConnect(async (ts) => {
    try {
      await registerTSEvents(ts);
      await startClockDateService();
      await startCleanupScheduler();
      void dbLog({ eventType: 'BOT_READY', message: 'Bot is fully operational', level: 'INFO' });
    } catch (err) {
      winstonLogger.error(`[TS] Post-connect setup failed: ${(err as Error).message}`);
    }
  });

  tsManager.onDisconnect(() => {
    stopClockDateService();
    stopCleanupScheduler();
  });

  // ── 5. Connect to TeamSpeak if configured ───────────────────────────────────
  let setupComplete = false;
  try {
    setupComplete = await isSetupComplete();
  } catch (err) {
    winstonLogger.warn(`[SETUP] Could not read setup state: ${(err as Error).message}`);
  }

  if (setupComplete) {
    const tsCfg = await getTSConfig().catch(() => null);
    if (tsCfg) {
      winstonLogger.info(`[TS] Connecting to ${tsCfg.host}:${tsCfg.queryPort} ...`);
      tsManager.connect().catch((err) => {
        winstonLogger.warn(`[TS] Initial connect error: ${(err as Error).message}`);
      });
    } else {
      winstonLogger.warn('[TS] Setup complete but no TS config found in DB — reconnect via Settings page');
    }
  } else {
    winstonLogger.info('[SETUP] Not yet configured — open the app and complete the setup wizard');
  }
}

// ─── MAIN: Start HTTP server immediately, then init in background ─────────────
(function start() {
  const port = Number(process.env.PORT) || 3000;
  const host = '0.0.0.0';

  winstonLogger.info(`[HTTP] Binding to ${host}:${port} ...`);

  const app = createApp(prisma);
  const server = app.listen(port, host, () => {
    winstonLogger.info(`[HTTP] Server listening on ${host}:${port}`);
    winstonLogger.info('[READY] Web panel is reachable — GET /health should return 200');
  });

  server.on('error', (err) => {
    winstonLogger.error(`[HTTP] Server error: ${err.message}`);
    process.exit(1);
  });

  setupShutdownHandlers(() => {
    server.close();
  });

  // Background init runs asynchronously — HTTP server is already live
  initBackground().catch((err) => {
    winstonLogger.error(`[STARTUP] Background init error: ${(err as Error).message}`);
    // Keep the server running even if background init fails
  });
})();
