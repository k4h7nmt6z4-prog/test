-- =====================================================================
-- 羽球報名：管理員在網頁上切換「已繳費／未繳費」
--
-- 本檔請在 Supabase 的 SQL Editor 手動執行一次。
-- 執行前要先完成：
--   Authentication → Users → Add user → Create new user
--   輸入管理員的 Email 與密碼，並勾選 Auto Confirm User。
-- 執行後，再執行本檔最下方「設定管理員」那一行（要換成你的 Email）。
--
-- 設計：
-- - 羽球報名存在 repair_requests，地點固定為「羽球報名」；
--   status「已完成」代表已繳費，「待處理」代表未繳費。
-- - 只有列在 badminton_admins 的登入帳號可以修改 status，
--   而且只能改羽球報名的資料、只能改成「待處理」或「已完成」。
-- - 未登入的訪客（anon）權限完全不變：只能讀取與新增，不能修改。
-- - 管理員名單只存在資料庫裡，不放進 GitHub，避免公開 Email。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 管理員名單
-- - 只記錄 Supabase 登入帳號的 user_id；帳號被刪除時自動移除。
-- - 登入者只能查到「自己是不是管理員」，看不到其他管理員。
-- - 網頁上無法新增或移除管理員，只能在 SQL Editor 操作。
-- ---------------------------------------------------------------------
create table if not exists public.badminton_admins (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.badminton_admins is '羽球報名管理員（可在網頁上切換繳費狀態）';

revoke all on table public.badminton_admins from public, anon, authenticated;
grant select on table public.badminton_admins to authenticated;

alter table public.badminton_admins enable row level security;

drop policy if exists badminton_admins_select_self on public.badminton_admins;
create policy badminton_admins_select_self
  on public.badminton_admins
  for select
  to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT（登入後的角色 authenticated）
-- - 管理員登入後，網頁改用 authenticated 角色連線，
--   所以要給它和訪客相同的讀取、新增權限，名單和報名才會正常。
-- - 另外只開放修改 status 這一個欄位；不給 DELETE。
-- ---------------------------------------------------------------------
grant select on table public.repair_requests to authenticated;

grant insert (reporter_name, location, category, description, urgency)
  on table public.repair_requests to authenticated;

grant update (status) on table public.repair_requests to authenticated;


-- ---------------------------------------------------------------------
-- 第 2 層：RLS（登入後的角色 authenticated）
-- - 讀取：和訪客一樣可以看全部。
-- - 新增：和訪客一樣，status 必須是「待處理」。
-- - 修改：必須是管理員，而且只能改「羽球報名」的資料，
--   改完的 status 只能是「待處理」或「已完成」。
--   即使有人自行註冊帳號，不在管理員名單裡就無法修改。
-- ---------------------------------------------------------------------
drop policy if exists repair_requests_select_authenticated on public.repair_requests;
create policy repair_requests_select_authenticated
  on public.repair_requests
  for select
  to authenticated
  using (true);

drop policy if exists repair_requests_insert_authenticated on public.repair_requests;
create policy repair_requests_insert_authenticated
  on public.repair_requests
  for insert
  to authenticated
  with check (status = '待處理');

drop policy if exists repair_requests_update_badminton_paid on public.repair_requests;
create policy repair_requests_update_badminton_paid
  on public.repair_requests
  for update
  to authenticated
  using (
    location = '羽球報名'
    and exists (select 1 from public.badminton_admins a where a.user_id = auth.uid())
  )
  with check (
    location = '羽球報名'
    and status in ('待處理', '已完成')
    and exists (select 1 from public.badminton_admins a where a.user_id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 設定管理員（第 3 層 CHECK 沿用 repair_requests 原有的限制）
-- 把下面的 Email 換成你在 Authentication 建立的管理員帳號，再執行這一行。
-- 執行結果顯示 INSERT 0 1 代表成功；INSERT 0 0 代表找不到這個 Email。
-- 這行請勿把真實 Email 存回 GitHub。
-- ---------------------------------------------------------------------
-- insert into public.badminton_admins (user_id)
--   select id from auth.users where email = '換成你的 Email'
--   on conflict do nothing;
