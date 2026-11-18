-- =====================================================================
-- 羽球報名：每個人登入後各自一份名單
-- 資料表：public.badminton_players
--
-- 本檔請在 Supabase 的 SQL Editor 整份貼上，按 Run 執行一次。
-- 重複執行也不會出錯。
--
-- 設計：
-- - 每一筆名單都記錄建立者（owner_id），預設為目前登入的帳號。
-- - 每個人只能讀取、新增、修改、刪除自己的名單；看不到別人的資料。
-- - 沒有登入的訪客完全不能讀寫這張表。
--
-- 舊的共用名單（存在 repair_requests、地點為「羽球報名」）會保留，
-- 但新版網頁不再使用；本檔會收回訪客修改與刪除報修資料表的權限。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表，並加上 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
create table if not exists public.badminton_players (
  -- 主鍵：自動產生 UUID
  id          uuid        primary key default gen_random_uuid(),

  -- 建立者：預設為目前登入的帳號；帳號刪除時一併刪除他的名單
  owner_id    uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,

  -- 加入時間：決定正取與候補的順序
  created_at  timestamptz not null default now(),

  -- 名字：1～30 字
  name        text        not null
    constraint badminton_players_name_len
      check (char_length(btrim(name)) between 1 and 30),

  -- 程度備註：選填，最多 100 字
  level_note  text
    constraint badminton_players_level_note_len
      check (level_note is null or char_length(level_note) <= 100),

  -- 是否已繳費
  paid        boolean     not null default false
);

comment on table public.badminton_players is '羽球報名名單（每個帳號各自一份）';

-- 程度：數字 1～10（選填，舊資料可能沒有）
-- 已存在的資料表也會補上這個欄位；重複執行不會出錯
alter table public.badminton_players
  add column if not exists level smallint
    constraint badminton_players_level_range
      check (level between 1 and 10);

-- 舊資料：程度備註剛好是 1～10 的數字時，轉存到 level
update public.badminton_players
set level = btrim(level_note)::smallint
where level is null
  and btrim(level_note) ~ '^(10|[1-9])$';

-- level_note（文字程度備註）保留給舊資料顯示，新版網頁不再寫入

-- 依建立者與加入時間查詢時使用
create index if not exists badminton_players_owner_created_idx
  on public.badminton_players (owner_id, created_at, id);


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT
-- - 先收回所有權限，訪客（anon）完全不能使用這張表。
-- - 登入的人（authenticated）可以：讀取、刪除、
--   新增時填寫名字／程度（1～10）／是否已繳費、修改是否已繳費。
-- - id、owner_id、created_at 不開放填寫或修改，一律使用預設值。
-- ---------------------------------------------------------------------
revoke all on table public.badminton_players from public, anon, authenticated;

grant select, delete on table public.badminton_players to authenticated;
grant insert (name, level, paid) on table public.badminton_players to authenticated;
grant update (paid) on table public.badminton_players to authenticated;


-- ---------------------------------------------------------------------
-- 第 2 層：RLS
-- - 每個動作都限定 owner_id 必須等於目前登入的帳號。
-- ---------------------------------------------------------------------
alter table public.badminton_players enable row level security;

drop policy if exists badminton_players_select_own on public.badminton_players;
create policy badminton_players_select_own
  on public.badminton_players for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists badminton_players_insert_own on public.badminton_players;
create policy badminton_players_insert_own
  on public.badminton_players for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists badminton_players_update_own on public.badminton_players;
create policy badminton_players_update_own
  on public.badminton_players for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists badminton_players_delete_own on public.badminton_players;
create policy badminton_players_delete_own
  on public.badminton_players for delete to authenticated
  using (owner_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 個人設定：正取名額（8／16／24／32／40 人，每場 8 人）
-- - 每個帳號最多一筆，owner_id 就是主鍵；沒有設定時網頁預設 32 人。
-- - 只能讀取、新增、修改自己的設定；訪客完全不能使用。
-- ---------------------------------------------------------------------
create table if not exists public.badminton_settings (
  owner_id    uuid        primary key default auth.uid()
                          references auth.users (id) on delete cascade,
  capacity    smallint    not null default 32
    constraint badminton_settings_capacity_values
      check (capacity in (8, 16, 24, 32, 40)),
  updated_at  timestamptz not null default now()
);

comment on table public.badminton_settings is '羽球報名個人設定（正取名額）';

revoke all on table public.badminton_settings from public, anon, authenticated;
grant select on table public.badminton_settings to authenticated;
grant insert (capacity) on table public.badminton_settings to authenticated;
grant update (capacity, updated_at) on table public.badminton_settings to authenticated;

alter table public.badminton_settings enable row level security;

drop policy if exists badminton_settings_select_own on public.badminton_settings;
create policy badminton_settings_select_own
  on public.badminton_settings for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists badminton_settings_insert_own on public.badminton_settings;
create policy badminton_settings_insert_own
  on public.badminton_settings for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists badminton_settings_update_own on public.badminton_settings;
create policy badminton_settings_update_own
  on public.badminton_settings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 收回舊版共用名單開放給訪客的權限
-- - 舊版網頁讓任何人修改繳費狀態、刪除報名；新版不再需要。
-- - 報修頁的讀取與新增權限不變。
-- ---------------------------------------------------------------------
drop policy if exists repair_requests_update_badminton_paid_anon on public.repair_requests;
drop policy if exists repair_requests_delete_badminton_anon on public.repair_requests;
revoke update, delete on table public.repair_requests from anon;
