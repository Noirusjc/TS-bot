import { TeamSpeak } from 'ts3-nodejs-library';
import { TSConnectionStatus } from '../types';
import { TSConfig } from '../utils/config';
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
    /** Load config from DB and connect. */
    connect(): Promise<void>;
    /** Tear down and reconnect with new credentials. */
    reconfigure(cfg: TSConfig): Promise<void>;
    private _connectWithConfig;
    private _scheduleReconnect;
    private _startKeepAlive;
    private _stopKeepAlive;
    /** Safe command executor — returns null on any failure. */
    run<T>(fn: (ts: TeamSpeak) => Promise<T>): Promise<T | null>;
    /**
     * One-shot connection test — auto-detects virtual server by game port.
     * Returns server name + detected VS ID for display. Does not affect the
     * persistent connection.
     */
    static testConnection(cfg: TSConfig): Promise<{
        success: boolean;
        message: string;
        serverName?: string;
        detectedVirtualServerId?: number;
        version?: unknown;
    }>;
    destroy(): void;
}
export declare const tsManager: TSConnectionManager;
export {};
//# sourceMappingURL=tsConnection.d.ts.map