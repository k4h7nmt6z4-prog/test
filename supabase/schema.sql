-- =====================================================================
-- 報修登記系統：Supabase 建表 SQL
-- 資料表：public.repair_requests
--
-- 本檔只是設計稿，請在 Supabase 的 SQL Editor 確認內容後再手動執行。
-- 安全設計分三層：
--   1. GRANT：決定 anon 角色「能碰哪些資料表與欄位」
--   2. RLS  ：決定 anon 角色「能讀寫哪些資料列」
--   3. CHECK：不論誰寫入，都限制欄位值與文字長度
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表，並加上 CHECK 限制（第 3 層）
-- - id、created_at 由資料庫自動產生，前端不需要也不能填。
-- - 文字欄位先去掉頭尾空白再計算長度，避免只填空白字元。
-- - category、urgency、status 只接受固定選項。
-- ---------------------------------------------------------------------
create table if not exists public.repair_requests (
  -- 主鍵：自動產生 UUID
  id            uuid        primary key default gen_random_uuid(),

  -- 建立時間：寫入時自動記錄，含時區
  created_at    timestamptz not null default now(),

  -- 報修人姓名：1～50 字
  reporter_name text        not null
    constraint repair_requests_reporter_name_len
      check (char_length(btrim(reporter_name)) between 1 and 50),

  -- 地點或部門：1～100 字
  location      text        not null
    constraint repair_requests_location_len
      check (char_length(btrim(location)) between 1 and 100),

  -- 類別：只能是 設備／網路／環境／其他
  category      text        not null
    constraint repair_requests_category_values
      check (category in ('設備', '網路', '環境', '其他')),

  -- 問題說明：1～1000 字
  description   text        not null
    constraint repair_requests_description_len
      check (char_length(btrim(description)) between 1 and 1000),

  -- 緊急程度：只能是 低／中／高，預設「中」
  urgency       text        not null default '中'
    constraint repair_requests_urgency_values
      check (urgency in ('低', '中', '高')),

  -- 處理狀態：只能是 待處理／處理中／已完成，預設「待處理」
  status        text        not null default '待處理'
    constraint repair_requests_status_values
      check (status in ('待處理', '處理中', '已完成'))
);

comment on table public.repair_requests is '報修登記（示範用，資料皆為虛構）';


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- - 先收回所有角色對這張表的權限，確保從乾淨的狀態開始。
--   （authenticated 也一併收回：本次示範不做登入，不需要它。）
-- - anon 只能讀取整張表。
-- - anon 只能在「新增時需要填的欄位」寫入；
--   id、created_at、status 不開放，所以一律使用預設值，
--   新報修的狀態必定是「待處理」。
-- - 不給 UPDATE、DELETE、TRUNCATE，anon 無法修改或刪除任何資料。
-- ---------------------------------------------------------------------
revoke all on table public.repair_requests from public, anon, authenticated;

grant select on table public.repair_requests to anon;

grant insert (reporter_name, location, category, description, urgency)
  on table public.repair_requests to anon;


-- ---------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- - 啟用 RLS 後，沒有符合政策的操作一律被拒絕。
-- - 讀取：任何人（anon）都能看到全部清單。
-- - 新增：任何人都能新增，但 status 必須是「待處理」。
--   即使日後有人誤把 status 欄位的 INSERT 權限開放出去，
--   這條政策仍會擋下其他狀態值。
-- - 沒有 UPDATE、DELETE 政策，所以即使權限被誤開，RLS 仍會拒絕。
-- ---------------------------------------------------------------------
alter table public.repair_requests enable row level security;

drop policy if exists repair_requests_select_anon on public.repair_requests;
create policy repair_requests_select_anon
  on public.repair_requests
  for select
  to anon
  using (true);

drop policy if exists repair_requests_insert_anon on public.repair_requests;
create policy repair_requests_insert_anon
  on public.repair_requests
  for insert
  to anon
  with check (status = '待處理');
