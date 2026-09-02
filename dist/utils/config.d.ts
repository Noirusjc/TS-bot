/**
 * Application configuration.
 *
 * RAILWAY REQUIRED VARIABLES (set in Railway dashboard):
 *   DATABASE_URL   — auto-provided when you link a PostgreSQL service
 *   SESSION_SECRET — set manually (any long random string)
 *
 * All TeamSpeak credentials and bot settings are stored in the database
 * after the first-time setup wizard. They are NOT env vars.
 */
export interface BaseConfig {
    nodeEnv: string;
    port: number;
    appUrl: string;
    databaseUrl: string;
    sessionSecret: string;
}
export interface TSConfig {
    host: string;
    queryPort: number;
    username: string;
    password: string;
    virtualServerId: number;
    botNickname: string;
}
export declare function loadBaseConfig(): BaseConfig;
export declare const config: BaseConfig;
//# sourceMappingURL=config.d.ts.map