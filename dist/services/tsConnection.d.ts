import { TeamSpeak } from 'ts3-nodejs-library';
import { TSConnectionStatus } from '../types';
import { TSConfig } from '../utils/config';
type TSEventHandler = (teamspeak: TeamSpeak) => void;
export declare class TSConnectionManager {
    private ts;
    private status;
    private currentConfig;
    private reconnectAttempt;
    private reconnecting;
    private destroyed;
    private autoReconnect;
    private readonly onConnectHandlers;
    private readonly onDisconnectHandlers;
    private keepAliveInterval;
    getStatus(): TSConnectionStatus;
    getClient(): TeamSpeak | null;
    onConnect(handler: TSEventHandler): void;
    onDisconnect(handler: () => void): void;
    /**
     * Connect using config from the database.
     * If no config is saved yet, sets status to not_configured and returns.
     */
    connect(): Promise<void>;
    /**
     * Reconfigure and reconnect with new credentials.
     * Called after setup wizard or when credentials change in admin panel.
     */
    reconfigure(cfg: TSConfig): Promise<void>;
    private _connectWithConfig;
    private _scheduleReconnect;
    private _startKeepAlive;
    private _stopKeepAlive;
    /**
     * Safe command executor — queues the command, returns null on any failure.
     */
    run<T>(fn: (ts: TeamSpeak) => Promise<T>): Promise<T | null>;
    /**
     * One-shot test: connect, run version(), disconnect. Does NOT affect the
     * persistent connection. Used by the setup wizard and settings page.
     */
    static testConnection(cfg: TSConfig): Promise<{
        success: boolean;
        message: string;
        version?: unknown;
    }>;
    destroy(): void;
}
export declare const tsManager: TSConnectionManager;
export {};
//# sourceMappingURL=tsConnection.d.ts.map