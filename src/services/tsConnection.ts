import { TeamSpeak, QueryProtocol } from 'ts3-nodejs-library';
import { dbLog, winstonLogger } from '../utils/logger';
import { exponentialBackoff } from '../utils/helpers';
import { TSConnectionStatus } from '../types';
import { TSConfig } from '../utils/config';
import { getTSConfig } from '../utils/settings';
import { tsQueue } from './tsQueue';

/**
 * How virtual server auto-detection works:
 *
 * The ts3-nodejs-library provides `useByPort(gamePort, nickname)` which
 * connects to ServerQuery and selects the virtual server running on the
 * given game port automatically. No manual virtual server ID is required.
 *
 * For multi-server hosts: each virtual server runs on a different game port
 * (e.g. 9987, 9988, 9989). The user provides the port of their server and
 * we select the correct one. If no server is running on that port, the
 * library throws and we return a clear error.
 *
 * For the test connection we also call serverIdGetByPort() to return the
 * detected virtual server ID and server name to the caller, which is then
 * stored in the database for diagnostics (but NOT required by the user).
 */

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

  getStatus(): TSConnectionStatus { return this.status; }
  getClient(): TeamSpeak | null   { return this.ts; }

  onConnect(handler: TSEventHandler): void  { this.onConnectHandlers.push(handler); }
  onDisconnect(handler: () => void): void   { this.onDisconnectHandlers.push(handler); }

  /** Load config from DB and connect. */
  async connect(): Promise<void> {
    if (this.destroyed) return;
    const cfg = await getTSConfig().catch(() => null);
    if (!cfg) {
      this.status = 'not_configured';
      winstonLogger.info('[TS] Not configured yet — waiting for setup wizard.');
      return;
    }
    this.currentConfig = cfg;
    await this._connectWithConfig(cfg);
  }

  /** Tear down and reconnect with new credentials. */
  async reconfigure(cfg: TSConfig): Promise<void> {
    winstonLogger.info('[TS] Reconfiguring connection...');
    this.autoReconnect = false;
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
      winstonLogger.info(`[TS] Connecting to ${cfg.host}:${cfg.queryPort} | game port: ${cfg.serverPort} ...`);

      // ── Connect to ServerQuery and auto-select virtual server by game port.
      // useByPort(gamePort, nickname) handles everything:
      //   1. Connects to ServerQuery
      //   2. Sends "use port=<gamePort>" to select the virtual server
      //   3. Sets the bot nickname on that virtual server
      // No manual virtual server ID needed.
      const ts = await TeamSpeak.connect({
        host:             cfg.host,
        queryport:        cfg.queryPort,
        serverport:       cfg.serverPort,   // ← library selects VS by this port
        username:         cfg.username,
        password:         cfg.password,
        nickname:         cfg.botNickname,
        protocol:         QueryProtocol.RAW,
        readyTimeout:     15000,
        keepAlive:        true,
        keepAliveTimeout: 250,
      });

      this.ts = ts;
      this.status = 'connected';
      this.reconnectAttempt = 0;

      // Log the detected virtual server name for diagnostics
      ts.serverInfo().then((info) => {
        const name = (info as unknown as Record<string, string>)?.virtualserverName ?? 'Unknown';
        winstonLogger.info(`[TS] Connected to virtual server: "${name}" (port ${cfg.serverPort})`);
        void dbLog({
          eventType: 'TS_CONNECTED',
          message: `Connected to "${name}" on ${cfg.host}:${cfg.serverPort} via query port ${cfg.queryPort}`,
          level: 'INFO',
        });
      }).catch(() => {
        void dbLog({
          eventType: 'TS_CONNECTED',
          message: `Connected to ${cfg.host}:${cfg.serverPort} via query port ${cfg.queryPort}`,
          level: 'INFO',
        });
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
      if (this.ts) { try { this.ts.forceQuit(); } catch { /* ignore */ } this.ts = null; }
      tsQueue.clearQueue();
      if (this.currentConfig) await this._connectWithConfig(this.currentConfig);
    }, delay);
  }

  private _startKeepAlive(): void {
    this._stopKeepAlive();
    this.keepAliveInterval = setInterval(async () => {
      if (!this.ts || this.status !== 'connected') return;
      try { await tsQueue.enqueue(() => this.ts!.version()); } catch { /* reconnect handles it */ }
    }, 4 * 60 * 1000);
  }

  private _stopKeepAlive(): void {
    if (this.keepAliveInterval) { clearInterval(this.keepAliveInterval); this.keepAliveInterval = null; }
  }

  /** Safe command executor — returns null on any failure. */
  async run<T>(fn: (ts: TeamSpeak) => Promise<T>): Promise<T | null> {
    if (!this.ts || this.status !== 'connected') return null;
    const ts = this.ts;
    return tsQueue.enqueue(() => fn(ts)).catch((err: Error) => {
      winstonLogger.warn(`[TS] Command failed: ${err.message}`);
      return null;
    });
  }

  /**
   * One-shot connection test — auto-detects virtual server by game port.
   * Returns server name + detected VS ID for display. Does not affect the
   * persistent connection.
   */
  static async testConnection(cfg: TSConfig): Promise<{
    success: boolean;
    message: string;
    serverName?: string;
    detectedVirtualServerId?: number;
    version?: unknown;
  }> {
    let ts: TeamSpeak | null = null;
    try {
      // TeamSpeak.connect with serverport selects the virtual server automatically
      ts = await TeamSpeak.connect({
        host:         cfg.host,
        queryport:    cfg.queryPort,
        serverport:   cfg.serverPort,
        username:     cfg.username,
        password:     cfg.password,
        nickname:     'TS3-Bot-Test',
        protocol:     QueryProtocol.RAW,
        readyTimeout: 10000,
        keepAlive:    false,
      });

      // Get version and server info for confirmation
      const [version, info] = await Promise.all([
        ts.version(),
        ts.serverInfo().catch(() => null),
      ]);

      const infoMap = info as unknown as Record<string, string> | null;
      const serverName = infoMap?.virtualserverName ?? 'Unknown';

      // Also retrieve the virtual server ID for informational purposes
      let detectedVirtualServerId: number | undefined;
      try {
        const portResult = await ts.serverIdGetByPort(cfg.serverPort);
        detectedVirtualServerId = parseInt(portResult.serverId, 10) || undefined;
      } catch { /* non-critical */ }

      return {
        success: true,
        message: `Connected to "${serverName}"`,
        serverName,
        detectedVirtualServerId,
        version,
      };
    } catch (err) {
      const msg = (err as Error).message;
      // Provide helpful hints for common errors
      const hint = msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('timeout')
        ? ` — Check that port ${cfg.serverPort} is the correct game port and that the ServerQuery credentials are valid.`
        : '';
      return { success: false, message: msg + hint };
    } finally {
      if (ts) { try { ts.forceQuit(); } catch { /* ignore */ } }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.autoReconnect = false;
    this._stopKeepAlive();
    if (this.ts) { try { this.ts.forceQuit(); } catch { /* ignore */ } this.ts = null; }
  }
}

export const tsManager = new TSConnectionManager();
