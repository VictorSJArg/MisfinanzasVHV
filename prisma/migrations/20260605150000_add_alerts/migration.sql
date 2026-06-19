CREATE TABLE "AlertPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "daysBefore" INTEGER NOT NULL DEFAULT 1,
    "notifyHour" INTEGER NOT NULL DEFAULT 8,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertDispatchLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertDispatchLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertPreference_userId_key" ON "AlertPreference"("userId");
CREATE UNIQUE INDEX "AlertDispatchLog_channel_alertKey_scheduledFor_key" ON "AlertDispatchLog"("channel", "alertKey", "scheduledFor");
CREATE INDEX "AlertDispatchLog_userId_scheduledFor_idx" ON "AlertDispatchLog"("userId", "scheduledFor");

ALTER TABLE "AlertPreference"
ADD CONSTRAINT "AlertPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AlertDispatchLog"
ADD CONSTRAINT "AlertDispatchLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
