-- 仅追加运维查询索引，不更新或删除业务、账号和人工配置。
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
CREATE INDEX "registration_throttles_expires_at_idx" ON "registration_throttles"("expires_at");
CREATE INDEX "operation_logs_method_created_at_idx" ON "operation_logs"("method", "created_at");
