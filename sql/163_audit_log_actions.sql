-- ============================================================
-- 163. 帳號異動紀錄新增兩種動作
-- ------------------------------------------------------------
-- password_change：教職員自己改密碼（app/api/account/change-password 一直想寫這種紀錄，
--                  但舊的檢查只允許三種動作，寫入一直默默失敗）
-- mfa_reset：管理者協助重設某人的雙重驗證（app/api/admin/reset-mfa，資安檢測報告 #8）
-- 可重複執行。回復：把檢查改回只有 role_change／password_reset／email_change。
-- ============================================================
alter table public.account_audit_log drop constraint if exists account_audit_log_action_check;
alter table public.account_audit_log add constraint account_audit_log_action_check
  check (action = any (array['role_change', 'password_reset', 'email_change', 'password_change', 'mfa_reset']::text[]));
