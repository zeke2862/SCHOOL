-- ============================================================
-- 120. 站內通知同步寄信（導師／教務人員不用登入也會收到提醒）
-- ------------------------------------------------------------
-- 每一則寫進 staff_notifications 的通知，都會在 email_outbox 排一封信給對應的教職員（登入信箱）：
--   * 信件只寫「您有一則新的○○通知，請登入系統查看」，不放學生姓名、電話等個資（個資留在系統裡）。
--   * 同一個人、同一類別，10 分鐘內還沒寄出的只留一封（例如一次發 20 則考場通知，不會寄 20 封）。
--   * 「代理通知」已經由代理人設定流程自己寄信，這裡略過避免重複。
--   * 教職員可以在「帳號設定」關閉自己的信件通知（app_users.email_notifications）。
-- 真正寄出由伺服器處理（見 lib/outbox.ts：登入時、新申請送出時、每日排程都會補寄）。可重複執行。
-- ============================================================
alter table public.app_users add column if not exists email_notifications boolean not null default true;

create or replace function public.enqueue_notification_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_subject text;
begin
  if new.category = '代理通知' then return new; end if;
  select t.app_user_id into v_uid from teachers t where t.id = new.teacher_id;
  if v_uid is null then return new; end if;
  if not coalesce((select u.email_notifications from app_users u where u.id = v_uid), true) then return new; end if;
  v_subject := '【校務系統】您有新的「' || new.category || '」通知';
  if exists (select 1 from email_outbox o where o.to_user_id = v_uid and o.sent_at is null and o.subject = v_subject
               and o.created_at > now() - interval '10 minutes') then
    return new;
  end if;
  -- 寄信排程出任何問題都不能影響通知本身寫入
  begin
    insert into email_outbox (to_user_id, subject, body)
    values (v_uid, v_subject, '您好，系統有一則新的「' || new.category || '」通知需要您查看。' || E'\n\n' || '為了保護個人資料，詳細內容不寫在信裡，請登入校務行政系統，到「通知」查看並處理。');
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_enqueue_notification_email on public.staff_notifications;
create trigger trg_enqueue_notification_email after insert on public.staff_notifications
  for each row execute function public.enqueue_notification_email();

notify pgrst, 'reload schema';
