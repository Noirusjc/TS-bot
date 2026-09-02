"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tsManager = exports.TSConnectionManager = void 0;
const ts3_nodejs_library_1 = require("ts3-nodejs-library");
const logger_1 = require("../utils/logger");
const helpers_1 = require("../utils/helpers");
const settings_1 = require("../utils/settings");
const tsQueue_1 = require("./tsQueue");
class TSConnectionManager {
    constructor() {
        this.ts = null;
        this.status = 'not_configured';
        this.currentConfig = null;
        this.reconnectAttempt = 0;
        this.reconnecting = false;
        this.destroyed = false;
        this.autoReconnect = true;
        this.onConnectHandlers = [];
        this.onDisconnectHandlers = [];
        this.keepAliveInterval = null;
    }
    getStatus() {
        return this.status;
    }
    getClient() {
        return this.ts;
    }
    onConnect(handler) {
        this.onConnectHandlers.push(handler);
    }
    onDisconnect(handler) {
        this.onDisconnectHandlers.push(handler);
    }
    /**
     * Connect using config from the database.
     * If no config is saved yet, sets status to not_configured and returns.
     */
    async connect() {
        if (this.destroyed)
            return;
        // Load TS config from DB (set during setup wizard)
        const cfg = await (0, settings_1.getTSConfig)().catch(() => null);
        if (!cfg) {
            this.status = 'not_configured';
            logger_1.winstonLogger.info('[TS] TeamSpeak not configured yet — waiting for setup wizard.');
            return;
        }
        this.currentConfig = cfg;
        await this._connectWithConfig(cfg);
    }
    /**
     * Reconfigure and reconnect with new credentials.
     * Called after setup wizard or when credentials change in admin panel.
     */
    async reconfigure(cfg) {
        logger_1.winstonLogger.info('[TS] Reconfiguring connection...');
        this.autoReconnect = false;
        // Tear down existing connection
        this._stopKeepAlive();
        if (this.ts) {
            try {
                this.ts.forceQuit();
            }
            catch { /* ignore */ }
            this.ts = null;
        }
        tsQueue_1.tsQueue.clearQueue();
        this.currentConfig = cfg;
        this.reconnectAttempt = 0;
        this.autoReconnect = true;
        this.destroyed = false;
        await this._connectWithConfig(cfg);
    }
    async _connectWithConfig(cfg) {
        this.status = 'connecting';
        try {
            logger_1.winstonLogger.info(`[TS] Connecting to ${cfg.host}:${cfg.queryPort} ...`);
            const ts = await ts3_nodejs_library_1.TeamSpeak.connect({
                host: cfg.host,
                queryport: cfg.queryPort,
                serverport: 9987,
                username: cfg.username,
                password: cfg.password,
                nickname: cfg.botNickname,
                protocol: ts3_nodejs_library_1.QueryProtocol.RAW,
                readyTimeout: 15000,
                keepAlive: true,
                keepAliveTimeout: 250,
            });
            this.ts = ts;
            this.status = 'connected';
            this.reconnectAttempt = 0;
            void (0, logger_1.dbLog)({
                eventType: 'TS_CONNECTED',
                message: `Connected to TeamSpeak server ${cfg.host}:${cfg.queryPort}`,
                level: 'INFO',
            });
            ts.on('close', async () => {
                if (this.destroyed || !this.autoReconnect)
                    return;
                logger_1.winstonLogger.warn('[TS] Connection closed.');
                void (0, logger_1.dbLog)({ eventType: 'TS_DISCONNECTED', message: 'TeamSpeak connection closed', level: 'WARN' });
                this.status = 'disconnected';
                this._stopKeepAlive();
                this.onDisconnectHandlers.forEach((h) => h());
                this._scheduleReconnect();
            });
            ts.on('error', (err) => {
                logger_1.winstonLogger.error(`[TS] Error: ${err.message}`);
                void (0, logger_1.dbLog)({ eventType: 'TS_ERROR', message: `TeamSpeak error: ${err.message}`, level: 'ERROR' });
            });
            this._startKeepAlive();
            for (const handler of this.onConnectHandlers) {
                try {
                    handler(ts);
                }
                catch (err) {
                    logger_1.winstonLogger.error(`[TS] onConnect handler error: ${err.message}`);
                }
            }
        }
        catch (err) {
            const msg = err.message;
            logger_1.winstonLogger.error(`[TS] Connection failed: ${msg}`);
            void (0, logger_1.dbLog)({ eventType: 'TS_CONNECT_FAILED', message: `Connection failed: ${msg}`, level: 'ERROR' });
            this.status = 'disconnected';
            if (this.autoReconnect)
                this._scheduleReconnect();
        }
    }
    _scheduleReconnect() {
        if (this.destroyed || this.reconnecting || !this.autoReconnect)
            return;
        this.reconnecting = true;
        this.status = 'reconnecting';
        const delay = (0, helpers_1.exponentialBackoff)(this.reconnectAttempt++, 3000, 120000);
        logger_1.winstonLogger.info(`[TS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})...`);
        void (0, logger_1.dbLog)({
            eventType: 'TS_RECONNECT',
            message: `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})`,
            level: 'WARN',
        });
        setTimeout(async () => {
            this.reconnecting = false;
            if (this.ts) {
                try {
                    this.ts.forceQuit();
                }
                catch { /* ignore */ }
                this.ts = null;
            }
            tsQueue_1.tsQueue.clearQueue();
            if (this.currentConfig) {
                await this._connectWithConfig(this.currentConfig);
            }
        }, delay);
    }
    _startKeepAlive() {
        this._stopKeepAlive();
        this.keepAliveInterval = setInterval(async () => {
            if (!this.ts || this.status !== 'connected')
                return;
            try {
                await tsQueue_1.tsQueue.enqueue(() => this.ts.version());
            }
            catch { /* connection will close and trigger reconnect */ }
        }, 4 * 60 * 1000);
    }
    _stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }
    /**
     * Safe command executor — queues the command, returns null on any failure.
     */
    async run(fn) {
        if (!this.ts || this.status !== 'connected')
            return null;
        const ts = this.ts;
        return tsQueue_1.tsQueue.enqueue(() => fn(ts)).catch((err) => {
            logger_1.winstonLogger.warn(`[TS] Command failed: ${err.message}`);
            return null;
        });
    }
    /**
     * One-shot test: connect, run version(), disconnect. Does NOT affect the
     * persistent connection. Used by the setup wizard and settings page.
     */
    static async testConnection(cfg) {
        let ts = null;
        try {
            ts = await ts3_nodejs_library_1.TeamSpeak.connect({
                host: cfg.host,
                queryport: cfg.queryPort,
                serverport: 9987,
                username: cfg.username,
                password: cfg.password,
                nickname: 'TS3-Bot-Test',
                protocol: ts3_nodejs_library_1.QueryProtocol.RAW,
                readyTimeout: 10000,
                keepAlive: false,
            });
            const version = await ts.version();
            return { success: true, message: 'Connection successful', version };
        }
        catch (err) {
            return { success: false, message: err.message };
        }
        finally {
            if (ts) {
                try {
                    ts.forceQuit();
                }
                catch { /* ignore */ }
            }
        }
    }
    destroy() {
        this.destroyed = true;
        this.autoReconnect = false;
        this._stopKeepAlive();
        if (this.ts) {
            try {
                this.ts.forceQuit();
            }
            catch { /* ignore */ }
            this.ts = null;
        }
    }
}
exports.TSConnectionManager = TSConnectionManager;
exports.tsManager = new TSConnectionManager();
//# sourceMappingURL=tsConnection.js.map