// 網頁連線到 Supabase 的設定。
// publishable key 本來就是公開的，可以放在這裡並上傳到 GitHub。
// 絕對不要放 secret 金鑰（sb_secret_ 開頭）或 service_role 金鑰：它們會繞過所有安全規則。
window.APP_CONFIG = {
  SUPABASE_URL: "https://cmoxecaubyclpcbizffq.supabase.co",
  // Supabase 後台「Project Settings → API Keys」裡的 publishable key（sb_publishable_ 開頭）
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_c-0Zwi2lsxDYxnOh19ZxoA_SlJdgRzQ",

  // 羽球報名：場數 × 每場人數 = 預設正取名額（每個帳號可在頁面上改成 8／16／24／32／40 人）
  BADMINTON_COURTS: 4,
  BADMINTON_PLAYERS_PER_COURT: 8,

  // 預設報名名單：打開網址（沒有 ?list=）時，一般人直接報名到這份名單。
  // 填主辦人的名單編號（登入後「報名連結」裡 list= 後面那一串）；留空則顯示主辦人登入。
  // 這個編號不是密碼，拿到報名連結的人本來就看得到。
  PUBLIC_LIST_ID: "",
};
