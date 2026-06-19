-- Personal assistant MVP: contacts, reminders, tasks, events, outbound messages and audit log.

CREATE TABLE "PersonalContact" (
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

CREATE TABLE "PersonalReminder" (
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

CREATE TABLE "PersonalTask" (
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

CREATE TABLE "PersonalEvent" (
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

CREATE TABLE "OutboundMessage" (
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

CREATE TABLE "AssistantActionLog" (
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

CREATE UNIQUE INDEX "PersonalContact_userId_phone_key" ON "PersonalContact"("userId", "phone");
CREATE INDEX "PersonalContact_userId_name_idx" ON "PersonalContact"("userId", "name");
CREATE INDEX "PersonalReminder_userId_remindAt_idx" ON "PersonalReminder"("userId", "remindAt");
CREATE INDEX "PersonalReminder_userId_status_idx" ON "PersonalReminder"("userId", "status");
CREATE INDEX "PersonalTask_userId_dueAt_idx" ON "PersonalTask"("userId", "dueAt");
CREATE INDEX "PersonalTask_userId_status_idx" ON "PersonalTask"("userId", "status");
CREATE INDEX "PersonalEvent_userId_startsAt_idx" ON "PersonalEvent"("userId", "startsAt");
CREATE INDEX "PersonalEvent_userId_status_idx" ON "PersonalEvent"("userId", "status");
CREATE INDEX "OutboundMessage_userId_scheduledAt_idx" ON "OutboundMessage"("userId", "scheduledAt");
CREATE INDEX "OutboundMessage_userId_status_idx" ON "OutboundMessage"("userId", "status");
CREATE INDEX "AssistantActionLog_userId_createdAt_idx" ON "AssistantActionLog"("userId", "createdAt");
CREATE INDEX "AssistantActionLog_userId_action_idx" ON "AssistantActionLog"("userId", "action");

ALTER TABLE "PersonalContact" ADD CONSTRAINT "PersonalContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalReminder" ADD CONSTRAINT "PersonalReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalEvent" ADD CONSTRAINT "PersonalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PersonalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistantActionLog" ADD CONSTRAINT "AssistantActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
