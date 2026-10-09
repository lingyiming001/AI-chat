ALTER TABLE "User" ADD COLUMN "adminUsername" TEXT;
CREATE UNIQUE INDEX "User_adminUsername_key" ON "User"("adminUsername");
