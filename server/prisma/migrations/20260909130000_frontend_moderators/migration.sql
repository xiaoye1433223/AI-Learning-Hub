CREATE TYPE "ModeratorScope" AS ENUM ('community', 'tutorials');
CREATE TABLE "frontend_moderator_grants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scope" "ModeratorScope" NOT NULL,
  "can_delete" BOOLEAN NOT NULL DEFAULT false,
  "can_mute" BOOLEAN NOT NULL DEFAULT false,
  "can_ban" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "granted_by_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "frontend_moderator_grants_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "frontend_moderator_grants_user_id_scope_key" ON "frontend_moderator_grants"("user_id", "scope");
