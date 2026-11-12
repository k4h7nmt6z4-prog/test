-- =====================================================================
-- 羽球報名：Supabase 建表 SQL
-- 資料表：public.badminton_signups
--
-- 本檔只是設計稿，請在 Supabase 的 SQL Editor 確認內容後再手動執行。
--
-- 【目前未使用】網頁現在把羽球報名存在報修資料表 repair_requests
-- （地點欄位固定為「羽球報名」），不需要執行本檔。
-- 若日後想把羽球報名獨立成一張表，再執行本檔並修改 badminton.js。
-- 正取／候補不存在資料庫裡，而是依報名先後順序在網頁上計算：
-- 前 16 名（2 場 × 每場 8 人）為正取，其餘為候補。
-- 管理員在後台刪除某位正取者後，候補會自動依序遞補。
--
-- 安全設計分三層：
--   1. GRANT：決定 anon 角色「能碰哪些資料表與欄位」
--   2. RLS  ：決定 anon 角色「能讀寫哪些資料列」
--   3. CHECK：不論誰寫入，都限制欄位值與文字長度
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表，並加上 CHECK 限制（第 3 層）
-- - id、created_at 由資料庫自動產生，報名順序以 created_at 為準。
-- - paid（是否已繳費）預設為 false，只有管理員能在後台改成 true。
-- - 文字欄位先去掉頭尾空白再計算長度。
-- ---------------------------------------------------------------------
create table if not exists public.badminton_signups (
  -- 主鍵：自動產生 UUID
  id          uuid        primary key default gen_random_uuid(),

  -- 報名時間：寫入時自動記錄，決定正取與候補的順序
  created_at  timestamptz not null default now(),

  -- 名字：1～30 字
  name        text        not null
    constraint badminton_signups_name_len
      check (char_length(btrim(name)) between 1 and 30),

  -- 程度備註：選填，最多 100 字（例如：初學、會打雙打、中階）
  level_note  text
    constraint badminton_signups_level_note_len
      check (level_note is null or char_length(level_note) <= 100),

  -- 是否已繳費：預設未繳費
  paid        boolean     not null default false
);

comment on table public.badminton_signups is '羽球報名（前 16 名正取，其餘候補）';

-- 依報名時間排序查詢時使用
create index if not exists badminton_signups_created_at_idx
  on public.badminton_signups (created_at, id);


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- - 先收回所有角色對這張表的權限，從乾淨的狀態開始。
-- - anon 只能讀取整張表。
-- - anon 只能寫入 name、level_note 兩個欄位；
--   id、created_at、paid 不開放，所以一律使用預設值，
--   報名者無法自己把繳費狀態設成「已繳費」，也無法竄改報名順序。
-- - 不給 UPDATE、DELETE、TRUNCATE。
-- ---------------------------------------------------------------------
revoke all on table public.badminton_signups from public, anon, authenticated;

grant select on table public.badminton_signups to anon;

grant insert (name, level_note)
  on table public.badminton_signups to anon;


-- ---------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- - 讀取：任何人（anon）都能看到報名名單。
-- - 新增：任何人都能報名，但 paid 必須是 false。
--   即使日後 paid 欄位的 INSERT 權限被誤開，這條政策仍會擋下。
-- - 沒有 UPDATE、DELETE 政策，anon 無法修改或刪除任何報名。
--   管理員改繳費狀態、刪除報名，請在 Supabase 後台 Table Editor 操作。
-- ---------------------------------------------------------------------
alter table public.badminton_signups enable row level security;

drop policy if exists badminton_signups_select_anon on public.badminton_signups;
create policy badminton_signups_select_anon
  on public.badminton_signups
  for select
  to anon
  using (true);

drop policy if exists badminton_signups_insert_anon on public.badminton_signups;
create policy badminton_signups_insert_anon
  on public.badminton_signups
  for insert
  to anon
  with check (paid = false);
