ALTER TABLE "ChatRequest" ADD COLUMN "feature" TEXT NOT NULL DEFAULT 'CHAT', ADD COLUMN "result" JSONB;
ALTER TABLE "ChatMessage" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
CREATE TABLE "AIConfiguration" ("id" TEXT NOT NULL DEFAULT 'main', "version" INTEGER NOT NULL DEFAULT 1, "config" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AIConfiguration_pkey" PRIMARY KEY ("id"));
CREATE TABLE "MediaAsset" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"));
CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");
CREATE INDEX "MediaAsset_requestId_idx" ON "MediaAsset"("requestId");
