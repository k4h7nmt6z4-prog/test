// 網頁連線到 Supabase 的設定。
// publishable key 本來就是公開的，可以放在這裡並上傳到 GitHub。
// 絕對不要放 secret 金鑰（sb_secret_ 開頭）或 service_role 金鑰：它們會繞過所有安全規則。
window.APP_CONFIG = {
  SUPABASE_URL: "https://cmoxecaubyclpcbizffq.supabase.co",
  // Supabase 後台「Project Settings → API Keys」裡的 publishable key（sb_publishable_ 開頭）
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_c-0Zwi2lsxDYxnOh19ZxoA_SlJdgRzQ",
};
