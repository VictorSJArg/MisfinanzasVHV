-- Durable jobs for exact personal reminder/event scheduling through n8n.

CREATE TABLE "AssistantScheduledAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "provider" TEXT NOT NULL DEFAULT 'N8N',
    "externalJobId" TEXT,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantScheduledAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantScheduledAlert_sourceType_sourceId_version_key" ON "AssistantScheduledAlert"("sourceType", "sourceId", "version");
CREATE INDEX "AssistantScheduledAlert_userId_scheduledFor_idx" ON "AssistantScheduledAlert"("userId", "scheduledFor");
CREATE INDEX "AssistantScheduledAlert_sourceType_sourceId_idx" ON "AssistantScheduledAlert"("sourceType", "sourceId");
CREATE INDEX "AssistantScheduledAlert_status_scheduledFor_idx" ON "AssistantScheduledAlert"("status", "scheduledFor");

ALTER TABLE "AssistantScheduledAlert" ADD CONSTRAINT "AssistantScheduledAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
