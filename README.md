雲端任務測試
- [報修欄位表（Excel）](%E6%96%87%E4%BB%B6/%E5%A0%B1%E4%BF%AE%E6%AC%84%E4%BD%8D%E8%A1%A8.xlsx)
- [豬豬羽球報名](badminton.html)：一般人用主辦人的報名連結（?list=）免登入報名，只能報名；主辦人登入後才能看名單、刪除、按已繳費、設定正取名額。每個人用 Email 帳號登入，只看得到、改得到自己的名單；正取名額可選 8／16／24／32／40 人（每場 8 人，存在 badminton_settings），程度為 1～10（資料表 badminton_players，需先執行 [supabase/badminton_personal.sql](supabase/badminton_personal.sql)）
- 羽球報名頁是 PWA：手機可「加入主畫面」像 App 一樣開啟（manifest.webmanifest、sw.js、pwa.js、icons/）；名單資料一律即時讀取，不會被快取
