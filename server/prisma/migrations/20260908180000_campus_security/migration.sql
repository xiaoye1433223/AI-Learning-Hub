-- 保留账号、密码、角色、人工配置及 public 的社区语义；门户授权默认关闭。
ALTER TABLE "users"
  ADD COLUMN "mfa_secret_encrypted" TEXT,
  ADD COLUMN "mfa_enabled_at" TIMESTAMP(3),
  ADD COLUMN "mfa_last_time_step" INTEGER,
  ADD COLUMN "mfa_challenge_hash" TEXT,
  ADD COLUMN "mfa_recovery_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "email_verification_tokens"
  ADD COLUMN "new_email" TEXT,
  ADD COLUMN "previous_email" TEXT;
ALTER TABLE "refresh_tokens"
  ADD COLUMN "client" TEXT NOT NULL DEFAULT 'student',
  ADD COLUMN "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "device" TEXT NOT NULL DEFAULT '未知设备',
  ADD COLUMN "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- 历史会话无法可靠确定前后台来源。部署后重新登录，不修改账号密码。
UPDATE "refresh_tokens" SET "revoked_at" = CURRENT_TIMESTAMP WHERE "revoked_at" IS NULL;
ALTER TABLE "community_posts" ADD COLUMN "portal_consent" BOOLEAN NOT NULL DEFAULT false;
