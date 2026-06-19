/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();
const { Client } = require('pg');

const sql = `
CREATE TABLE IF NOT EXISTS "AlertPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "phone" TEXT,
  "daysBefore" INTEGER NOT NULL DEFAULT 1,
  "alertWindowDays" INTEGER NOT NULL DEFAULT 30,
  "notifyHour" INTEGER NOT NULL DEFAULT 8,
  "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertDispatchLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "alertKey" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertDispatchLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertDismissal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "alertKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertDismissal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertExclusion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertExclusion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PersonalContact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "alias" TEXT,
  "relation" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PersonalReminder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "remindAt" TIMESTAMP(3) NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "recurrence" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PersonalTask" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3),
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "tags" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PersonalEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "participants" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OutboundMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contactId" TEXT,
  "phone" TEXT NOT NULL,
  "contactName" TEXT,
  "text" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantActionLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'APP',
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "summary" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantActionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AlertPreference_userId_key" ON "AlertPreference"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "AlertDispatchLog_channel_alertKey_scheduledFor_key" ON "AlertDispatchLog"("channel", "alertKey", "scheduledFor");
CREATE INDEX IF NOT EXISTS "AlertDispatchLog_userId_scheduledFor_idx" ON "AlertDispatchLog"("userId", "scheduledFor");
CREATE UNIQUE INDEX IF NOT EXISTS "AlertDismissal_userId_alertKey_key" ON "AlertDismissal"("userId", "alertKey");
CREATE INDEX IF NOT EXISTS "AlertDismissal_userId_dueDate_idx" ON "AlertDismissal"("userId", "dueDate");
CREATE UNIQUE INDEX IF NOT EXISTS "AlertExclusion_userId_categoryId_description_key" ON "AlertExclusion"("userId", "categoryId", "description");
CREATE INDEX IF NOT EXISTS "AlertExclusion_userId_categoryId_idx" ON "AlertExclusion"("userId", "categoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalContact_userId_phone_key" ON "PersonalContact"("userId", "phone");
CREATE INDEX IF NOT EXISTS "PersonalContact_userId_name_idx" ON "PersonalContact"("userId", "name");
CREATE INDEX IF NOT EXISTS "PersonalReminder_userId_remindAt_idx" ON "PersonalReminder"("userId", "remindAt");
CREATE INDEX IF NOT EXISTS "PersonalReminder_userId_status_idx" ON "PersonalReminder"("userId", "status");
CREATE INDEX IF NOT EXISTS "PersonalTask_userId_dueAt_idx" ON "PersonalTask"("userId", "dueAt");
CREATE INDEX IF NOT EXISTS "PersonalTask_userId_status_idx" ON "PersonalTask"("userId", "status");
CREATE INDEX IF NOT EXISTS "PersonalEvent_userId_startsAt_idx" ON "PersonalEvent"("userId", "startsAt");
CREATE INDEX IF NOT EXISTS "PersonalEvent_userId_status_idx" ON "PersonalEvent"("userId", "status");
CREATE INDEX IF NOT EXISTS "OutboundMessage_userId_scheduledAt_idx" ON "OutboundMessage"("userId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "OutboundMessage_userId_status_idx" ON "OutboundMessage"("userId", "status");
CREATE INDEX IF NOT EXISTS "AssistantActionLog_userId_createdAt_idx" ON "AssistantActionLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantActionLog_userId_action_idx" ON "AssistantActionLog"("userId", "action");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AlertPreference_userId_fkey') THEN
    ALTER TABLE "AlertPreference" ADD CONSTRAINT "AlertPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AlertDispatchLog_userId_fkey') THEN
    ALTER TABLE "AlertDispatchLog" ADD CONSTRAINT "AlertDispatchLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AlertDismissal_userId_fkey') THEN
    ALTER TABLE "AlertDismissal" ADD CONSTRAINT "AlertDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AlertExclusion_userId_fkey') THEN
    ALTER TABLE "AlertExclusion" ADD CONSTRAINT "AlertExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonalContact_userId_fkey') THEN
    ALTER TABLE "PersonalContact" ADD CONSTRAINT "PersonalContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonalReminder_userId_fkey') THEN
    ALTER TABLE "PersonalReminder" ADD CONSTRAINT "PersonalReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonalTask_userId_fkey') THEN
    ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonalEvent_userId_fkey') THEN
    ALTER TABLE "PersonalEvent" ADD CONSTRAINT "PersonalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutboundMessage_userId_fkey') THEN
    ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutboundMessage_contactId_fkey') THEN
    ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PersonalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantActionLog_userId_fkey') THEN
    ALTER TABLE "AssistantActionLog" ADD CONSTRAINT "AssistantActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
`;

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or DIRECT_URL is required.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'AlertPreference',
          'AlertDispatchLog',
          'AlertDismissal',
          'AlertExclusion',
          'PersonalContact',
          'PersonalReminder',
          'PersonalTask',
          'PersonalEvent',
          'OutboundMessage',
          'AssistantActionLog'
        )
      ORDER BY table_name
    `);
    console.log('Schema applied. Tables present:');
    for (const row of result.rows) {
      console.log(`- ${row.table_name}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
