-- 由数据库管理账号运行一次。仅创建本项目只读备份角色，不改现有应用账号。
-- psql -v app_owner=<现有迁移对象所有者> -f backup-role.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aihub_backup') THEN
    CREATE ROLE aihub_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO aihub_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO aihub_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO aihub_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA public GRANT SELECT ON TABLES TO aihub_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA public GRANT SELECT ON SEQUENCES TO aihub_backup;
ALTER ROLE aihub_backup SET default_transaction_read_only=on;
COMMIT;
-- 使用 psql 的 \password aihub_backup 在 TTY 设置密码，不将明文放入 SQL、命令参数或日志。
