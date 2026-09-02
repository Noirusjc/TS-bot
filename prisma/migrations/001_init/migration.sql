-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'EMPTY', 'DELETED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_channel_rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default Rule',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceChannelId" TEXT NOT NULL,
    "parentChannelId" TEXT,
    "channelNamePrefix" TEXT NOT NULL DEFAULT 'Channel',
    "nameSeparator" TEXT NOT NULL DEFAULT ' | ',
    "passwordEnabled" BOOLEAN NOT NULL DEFAULT false,
    "passwordLength" INTEGER NOT NULL DEFAULT 8,
    "passwordCharset" TEXT NOT NULL DEFAULT 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    "maxClients" INTEGER NOT NULL DEFAULT -1,
    "channelGroupId" TEXT,
    "deletionDelay" INTEGER NOT NULL DEFAULT 180,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "temporary_channel_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_channels" (
    "id" SERIAL NOT NULL,
    "tsChannelId" TEXT NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "ownerUid" TEXT NOT NULL,
    "ownerNickname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emptySince" TIMESTAMP(3),
    "deleteAt" TIMESTAMP(3),
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "temporary_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_entries" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "message" TEXT NOT NULL,
    "clientId" TEXT,
    "channelId" TEXT,
    "extra" TEXT,

    CONSTRAINT "log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "temporary_channels_tsChannelId_key" ON "temporary_channels"("tsChannelId");

-- CreateIndex
CREATE INDEX "temporary_channels_status_idx" ON "temporary_channels"("status");

-- CreateIndex
CREATE INDEX "temporary_channels_deleteAt_idx" ON "temporary_channels"("deleteAt");

-- CreateIndex
CREATE INDEX "temporary_channels_tsChannelId_idx" ON "temporary_channels"("tsChannelId");

-- CreateIndex
CREATE INDEX "log_entries_timestamp_idx" ON "log_entries"("timestamp");

-- CreateIndex
CREATE INDEX "log_entries_level_idx" ON "log_entries"("level");

-- CreateIndex
CREATE INDEX "log_entries_eventType_idx" ON "log_entries"("eventType");

-- AddForeignKey
ALTER TABLE "temporary_channels" ADD CONSTRAINT "temporary_channels_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "temporary_channel_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
