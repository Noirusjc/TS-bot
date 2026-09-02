/**
 * Base config: only the two hard requirements for Railway deployment.
 * DATABASE_URL  — provided by Railway PostgreSQL service variable
 * SESSION_SECRET — set by the user in Railway environment variables
 *
 * TeamSpeak credentials are stored in the database after setup wizard
 * and loaded dynamically at runtime. They are NOT required as env vars.
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