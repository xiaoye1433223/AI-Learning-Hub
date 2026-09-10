-- 仅在 NAS 从备份恢复的隔离库运行；不保存行内容或凭据，只比较旧列指纹。
\set ON_ERROR_STOP on
DO $$
DECLARE
  item RECORD;
  column_list TEXT;
  row_count BIGINT;
  digest TEXT;
BEGIN
  IF current_database() <> 'campus_security_upgrade' THEN
    RAISE EXCEPTION '仅允许 campus_security_upgrade 隔离库';
  END IF;
  IF to_regclass('public._campus_upgrade_fingerprints') IS NULL THEN
    CREATE TABLE _campus_upgrade_fingerprints (table_name TEXT PRIMARY KEY, column_list TEXT NOT NULL, row_count BIGINT NOT NULL, digest TEXT);
    FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', '_campus_upgrade_fingerprints') ORDER BY tablename LOOP
      SELECT string_agg(format('%I', column_name), ',' ORDER BY ordinal_position)
        INTO column_list FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = item.tablename
          AND NOT (item.tablename = 'refresh_tokens' AND column_name = 'revoked_at');
      EXECUTE format('SELECT count(*), md5(string_agg(h, '''' ORDER BY h)) FROM (SELECT md5(row_to_json(x)::text) h FROM (SELECT %s FROM %I) x) hashes', column_list, item.tablename) INTO row_count, digest;
      INSERT INTO _campus_upgrade_fingerprints VALUES (item.tablename, column_list, row_count, digest);
    END LOOP;
    CREATE TABLE _campus_previous_revocations AS SELECT id, revoked_at FROM refresh_tokens WHERE revoked_at IS NOT NULL;
    RAISE NOTICE '旧表指纹已保存；未保存原始账号或内容';
  ELSE
    FOR item IN SELECT * FROM _campus_upgrade_fingerprints ORDER BY table_name LOOP
      EXECUTE format('SELECT count(*), md5(string_agg(h, '''' ORDER BY h)) FROM (SELECT md5(row_to_json(x)::text) h FROM (SELECT %s FROM %I) x) hashes', item.column_list, item.table_name) INTO row_count, digest;
      IF row_count <> item.row_count OR digest IS DISTINCT FROM item.digest THEN
        RAISE EXCEPTION '旧行保护失败：表 %', item.table_name;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL) OR EXISTS (
      SELECT 1 FROM _campus_previous_revocations old LEFT JOIN refresh_tokens current ON old.id = current.id
      WHERE current.id IS NULL OR old.revoked_at IS DISTINCT FROM current.revoked_at
    ) THEN RAISE EXCEPTION '旧会话撤销迁移不符合约定'; END IF;
    IF EXISTS (SELECT 1 FROM community_posts WHERE portal_consent) THEN
      RAISE EXCEPTION '旧投稿未经授权投影到门户';
    END IF;
    RAISE NOTICE '全部旧表行数和旧列指纹保持；旧会话按约定撤销；门户默认未授权';
  END IF;
END $$;
