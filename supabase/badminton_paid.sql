-- =====================================================================
-- 羽球報名：讓網頁直接點選「已繳費／未繳費」，並刪除管理員設定
--
-- 本檔請在 Supabase 的 SQL Editor 整份貼上，按 Run 執行一次。
-- 重複執行也不會出錯。
--
-- 執行後：
-- - 任何人都能在羽球報名頁點選切換繳費狀態（沒有登入、沒有核對）。
-- - 只能改「羽球報名」資料的 status，而且只能是「待處理」或「已完成」；
--   報修資料、名字、程度備註都不能改，也不能刪除任何資料。
-- - 繳費狀態以 status 為準：「已完成」＝已繳費，「待處理」＝未繳費。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 一、刪除管理員設定（來自 badminton_admin.sql）
-- - 先刪除列在管理員名單裡的登入帳號，再刪除名單資料表與相關規則。
-- - 收回登入角色（authenticated）的所有權限，回到只有訪客能讀取與新增。
-- - 如果 Authentication → Users 還有其他當初建立的帳號，請在後台手動刪除。
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.badminton_admins') is not null then
    delete from auth.users where id in (select user_id from public.badminton_admins);
  end if;
end $$;

drop policy if exists repair_requests_update_badminton_paid on public.repair_requests;
drop policy if exists repair_requests_select_authenticated  on public.repair_requests;
drop policy if exists repair_requests_insert_authenticated  on public.repair_requests;

revoke all on table public.repair_requests from authenticated;

drop table if exists public.badminton_admins;


-- ---------------------------------------------------------------------
-- 二、把舊的「已繳費｜」「未繳費｜」標記轉成 status
-- - 之前的版本把繳費狀態寫在 description 開頭，現在改用 status。
-- - 轉換後去掉開頭標記，只留下程度備註。
-- ---------------------------------------------------------------------
update public.repair_requests
set
  status = case
    when description like '已繳費｜%' then '已完成'
    else '待處理'
  end,
  description = regexp_replace(description, '^(已繳費|未繳費)｜', '')
where location = '羽球報名'
  and description ~ '^(已繳費|未繳費)｜';


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT
-- - 訪客（anon）只多一個權限：修改 status 這一個欄位。
-- - 名字、地點、類別、說明等其他欄位仍然不能修改；仍然不給 DELETE。
-- ---------------------------------------------------------------------
grant update (status) on table public.repair_requests to anon;


-- ---------------------------------------------------------------------
-- 第 2 層：RLS
-- - 只能修改地點為「羽球報名」的資料，報修資料完全不受影響。
-- - 修改後的 status 只能是「待處理」（未繳費）或「已完成」（已繳費）。
-- ---------------------------------------------------------------------
drop policy if exists repair_requests_update_badminton_paid_anon on public.repair_requests;
create policy repair_requests_update_badminton_paid_anon
  on public.repair_requests
  for update
  to anon
  using (location = '羽球報名')
  with check (location = '羽球報名' and status in ('待處理', '已完成'));


-- ---------------------------------------------------------------------
-- 第 3 層：CHECK
-- - 沿用 repair_requests 原有限制：status 只能是 待處理／處理中／已完成，
--   其他欄位的長度與選項限制不變。
-- ---------------------------------------------------------------------
