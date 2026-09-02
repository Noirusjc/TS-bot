import { TeamSpeak, QueryProtocol } from 'ts3-nodejs-library';
import { dbLog, winstonLogger } from '../utils/logger';
import { exponentialBackoff } from '../utils/helpers';
import { TSConnectionStatus } from '../types';
import { TSConfig } from '../utils/config';
import { getTSConfig } from '../utils/settings';
import { tsQueue } from './tsQueue';

type TSEventHandler = (teamspeak: TeamSpeak) => void;

export class TSConnectionManager {
  private ts: TeamSpeak | null = null;
  private status: TSConnectionStatus = 'not_configured';
  private currentConfig: TSConfig | null = null;
  private reconnectAttempt = 0;
  private reconnecting = false;
  private destroyed = false;
  private autoReconnect = true;
  private readonly onConnectHandlers: TSEventHandler[] = [];
  private readonly onDisconnectHandlers: (() => void)[] = [];
  private keepAliveInterval: NodeJS.Timeout | null = null;

  getStatus(): TSConnectionStatus {
    return this.status;
  }

  getClient(): TeamSpeak | null {
    return this.ts;
  }

  onConnect(handler: TSEventHandler): void {
    this.onConnectHandlers.push(handler);
  }

  onDisconnect(handler: () => void): void {
    this.onDisconnectHandlers.push(handler);
  }

  /**
   * Connect using config from the database.
   * If no config is saved yet, sets status to not_configured and returns.
   */
  async connect(): Promise<void> {
    if (this.destroyed) return;

    // Load TS config from DB (set during setup wizard)
    const cfg = await getTSConfig().catch(() => null);
    if (!cfg) {
      this.status = 'not_configured';
      winstonLogger.info('[TS] TeamSpeak not configured yet — waiting for setup wizard.');
      return;
    }

    this.currentConfig = cfg;
    await this._connectWithConfig(cfg);
  }

  /**
   * Reconfigure and reconnect with new credentials.
   * Called after setup wizard or when credentials change in admin panel.
   */
  async reconfigure(cfg: TSConfig): Promise<void> {
    winstonLogger.info('[TS] Reconfiguring connection...');
    this.autoReconnect = false;

    // Tear down existing connection
    this._stopKeepAlive();
    if (this.ts) {
      try { this.ts.forceQuit(); } catch { /* ignore */ }
      this.ts = null;
    }
    tsQueue.clearQueue();

    this.currentConfig = cfg;
    this.reconnectAttempt = 0;
    this.autoReconnect = true;
    this.destroyed = false;

    await this._connectWithConfig(cfg);
  }

  private async _connectWithConfig(cfg: TSConfig): Promise<void> {
    this.status = 'connecting';

    try {
      winstonLogger.info(`[TS] Connecting to ${cfg.host}:${cfg.queryPort} ...`);

      const ts = await TeamSpeak.connect({
        host: cfg.host,
        queryport: cfg.queryPort,
        serverport: 9987,
        username: cfg.username,
        password: cfg.password,
        nickname: cfg.botNickname,
        protocol: QueryProtocol.RAW,
        readyTimeout: 15000,
        keepAlive: true,
        keepAliveTimeout: 250,
      });

      this.ts = ts;
      this.status = 'connected';
      this.reconnectAttempt = 0;

      void dbLog({
        eventType: 'TS_CONNECTED',
        message: `Connected to TeamSpeak server ${cfg.host}:${cfg.queryPort}`,
        level: 'INFO',
      });

      ts.on('close', async () => {
        if (this.destroyed || !this.autoReconnect) return;
        winstonLogger.warn('[TS] Connection closed.');
        void dbLog({ eventType: 'TS_DISCONNECTED', message: 'TeamSpeak connection closed', level: 'WARN' });
        this.status = 'disconnected';
        this._stopKeepAlive();
        this.onDisconnectHandlers.forEach((h) => h());
        this._scheduleReconnect();
      });

      ts.on('error', (err: Error) => {
        winstonLogger.error(`[TS] Error: ${err.message}`);
        void dbLog({ eventType: 'TS_ERROR', message: `TeamSpeak error: ${err.message}`, level: 'ERROR' });
      });

      this._startKeepAlive();

      for (const handler of this.onConnectHandlers) {
        try { handler(ts); } catch (err) {
          winstonLogger.error(`[TS] onConnect handler error: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      winstonLogger.error(`[TS] Connection failed: ${msg}`);
      void dbLog({ eventType: 'TS_CONNECT_FAILED', message: `Connection failed: ${msg}`, level: 'ERROR' });
      this.status = 'disconnected';
      if (this.autoReconnect) this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    if (this.destroyed || this.reconnecting || !this.autoReconnect) return;
    this.reconnecting = true;
    this.status = 'reconnecting';
    const delay = exponentialBackoff(this.reconnectAttempt++, 3000, 120000);

    winstonLogger.info(`[TS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})...`);
    void dbLog({
      eventType: 'TS_RECONNECT',
      message: `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})`,
      level: 'WARN',
    });

    setTimeout(async () => {
      this.reconnecting = false;
      if (this.ts) {
        try { this.ts.forceQuit(); } catch { /* ignore */ }
        this.ts = null;
      }
      tsQueue.clearQueue();
      if (this.currentConfig) {
        await this._connectWithConfig(this.currentConfig);
      }
    }, delay);
  }

  private _startKeepAlive(): void {
    this._stopKeepAlive();
    this.keepAliveInterval = setInterval(async () => {
      if (!this.ts || this.status !== 'connected') return;
      try {
        await tsQueue.enqueue(() => this.ts!.version());
      } catch { /* connection will close and trigger reconnect */ }
    }, 4 * 60 * 1000);
  }

  private _stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Safe command executor — queues the command, returns null on any failure.
   */
  async run<T>(fn: (ts: TeamSpeak) => Promise<T>): Promise<T | null> {
    if (!this.ts || this.status !== 'connected') return null;
    const ts = this.ts;
    return tsQueue.enqueue(() => fn(ts)).catch((err: Error) => {
      winstonLogger.warn(`[TS] Command failed: ${err.message}`);
      return null;
    });
  }

  /**
   * One-shot test: connect, run version(), disconnect. Does NOT affect the
   * persistent connection. Used by the setup wizard and settings page.
   */
  static async testConnection(cfg: TSConfig): Promise<{ success: boolean; message: string; version?: unknown }> {
    let ts: TeamSpeak | null = null;
    try {
      ts = await TeamSpeak.connect({
        host: cfg.host,
        queryport: cfg.queryPort,
        serverport: 9987,
        username: cfg.username,
        password: cfg.password,
        nickname: 'TS3-Bot-Test',
        protocol: QueryProtocol.RAW,
        readyTimeout: 10000,
        keepAlive: false,
      });
      const version = await ts.version();
      return { success: true, message: 'Connection successful', version };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    } finally {
      if (ts) { try { ts.forceQuit(); } catch { /* ignore */ } }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.autoReconnect = false;
    this._stopKeepAlive();
    if (this.ts) {
      try { this.ts.forceQuit(); } catch { /* ignore */ }
      this.ts = null;
    }
  }
}

export const tsManager = new TSConnectionManager();
