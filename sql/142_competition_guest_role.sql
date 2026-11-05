-- 142: 賽事訪客角色（外聘評審/裁判專用，只能使用賽事功能）
-- 這一支【要單獨先跑，跑完再跑 143】：
--   PostgreSQL 規定 ALTER TYPE ... ADD VALUE 新增的值，同一個交易(transaction)內不能馬上使用。
-- 可重複執行。
alter type public.user_role add value if not exists 'competition_guest';
