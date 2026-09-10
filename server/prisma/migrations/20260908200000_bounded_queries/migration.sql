-- 一级评论与回复按创建时间和主键翻页；父项计数由数据库按外键索引聚合。
CREATE INDEX "community_comments_post_id_parent_id_created_at_id_idx"
  ON "community_comments"("post_id", "parent_id", "created_at", "id");
CREATE INDEX "community_comments_parent_id_idx"
  ON "community_comments"("parent_id");

-- 后台可见性直接以关联复核记录执行EXISTS，保留从未投稿的私人草稿边界。
ALTER TABLE "content_reviews" ADD COLUMN "post_id" TEXT;
UPDATE "content_reviews" review SET "post_id" = review."target_id"
FROM "community_posts" post WHERE review."target_type" = 'post' AND review."target_id" = post."id";
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_post_target_check"
  CHECK ("post_id" IS NULL OR ("target_type" = 'post' AND "target_id" = "post_id"));
CREATE INDEX "content_reviews_post_id_idx" ON "content_reviews"("post_id");

CREATE INDEX "activity_events_event_type_target_id_created_at_idx"
  ON "activity_events"("event_type", "target_id", "created_at");
CREATE INDEX "resource_views_created_at_resource_id_idx" ON "resource_views"("created_at", "resource_id");
