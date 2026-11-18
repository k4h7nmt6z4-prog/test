// 羽球報名前端：每個人登入後管理自己的名單。
//
// 資料表：badminton_players（見 supabase/badminton_personal.sql）
//   name        → 名字
//   level       → 程度，數字 1～10（舊資料可能只有文字的 level_note）
//   paid        → 是否已繳費
//   owner_id    → 建立者，由資料庫自動填入目前登入的帳號
//
// 資料庫規則限定每個帳號只能讀寫自己的名單，網頁不需要也不能指定 owner_id。
//
// 兩種身分：
//   主辦人（登入）：看名單、新增、刪除、按已繳費、設定正取名額、收到候補遞補通知
//   一般人（不登入，透過報名連結 ?list=主辦人編號）：只能報名，
//     經由資料庫函式 badminton_public_signup 新增一筆，看不到名單
// 確認動作都在頁面上完成，不用 window.confirm（有些瀏覽器或內嵌視窗會封鎖跳出視窗）。
(function () {
  "use strict";

  var TABLE = "badminton_players";
  var MAX_ROWS = 500;

  var cfg = window.APP_CONFIG || {};
  // 正取名額：每個帳號在頁面上自選（存在 badminton_settings），沒設定時用預設值
  var SETTINGS_TABLE = "badminton_settings";
  var CAPACITY_OPTIONS = [8, 16, 24, 32, 40];
  var perCourt = Number(cfg.BADMINTON_PLAYERS_PER_COURT) || 8;
  var DEFAULT_CAPACITY = (Number(cfg.BADMINTON_COURTS) || 4) * perCourt;
  if (CAPACITY_OPTIONS.indexOf(DEFAULT_CAPACITY) < 0) DEFAULT_CAPACITY = 32;
  var capacity = DEFAULT_CAPACITY;
  var hasSettingsRow = false;
  // 收費與球團帳（存在 badminton_settings）
  var DEFAULT_FEE = 300;
  var money = { fee: DEFAULT_FEE, ball: 0, fund: 0, court: 0, others: [] };
  var financeReady = false;   // 資料庫已有收費欄位（報名費、用球、總餘額）
  var extrasReady = false;    // 資料庫已有場地費、其他減項欄位
  var MAX_OTHERS = 20;

  var $ = function (id) { return document.getElementById(id); };
  var form = $("signupForm");
  var submitBtn = $("submitBtn");
  var refreshBtn = $("refreshBtn");
  var formMessage = $("formMessage");
  var listMessage = $("listMessage");
  var confirmedList = $("confirmedList");
  var waitlist = $("waitlist");
  var waitlistEmpty = $("waitlistEmpty");
  var authCard = $("authCard");
  var authForm = $("authForm");
  var authSubmit = $("authSubmit");
  var authMessage = $("authMessage");
  var authLoading = $("authLoading");
  var appArea = $("appArea");
  var publicCard = $("publicCard");

  // ---- 報名連結的名單編號（?list=…）----
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var LIST_KEY = "badminton-public-list";
  var publicListId = null;
  var DEFAULT_LIST_ID = UUID_RE.test(String(cfg.PUBLIC_LIST_ID || "").trim())
    ? String(cfg.PUBLIC_LIST_ID).trim().toLowerCase() : "";
  (function () {
    var fromUrl = new URLSearchParams(location.search).get("list");
    if (fromUrl && UUID_RE.test(fromUrl)) {
      publicListId = fromUrl.toLowerCase();
      // 記住名單編號：加到主畫面後從圖示打開（網址沒有 ?list=）也能報名
      try { localStorage.setItem(LIST_KEY, publicListId); } catch (e) { /* 記不住也能用連結報名 */ }
    } else if (DEFAULT_LIST_ID) {
      // 直接打開網址：使用 config.js 設定的預設名單
      publicListId = DEFAULT_LIST_ID;
    } else {
      try {
        var saved = localStorage.getItem(LIST_KEY);
        if (saved && UUID_RE.test(saved)) publicListId = saved;
      } catch (e) { /* 忽略 */ }
    }
  })();
  var loginRequested = false;   // 一般人畫面按了「主辦人登入」

  var capacityMessage = $("capacityMessage");

  // 把目前的正取名額顯示到頁首、統計與選項
  function showCapacity() {
    $("courtsText").textContent = String(Math.ceil(capacity / perCourt));
    $("perCourtText").textContent = String(perCourt);
    $("capacityText").textContent = String(capacity);
    $("capacityStat").textContent = String(capacity);
    var radio = document.getElementById("cap-" + capacity);
    if (radio) radio.checked = true;
  }
  showCapacity();

  function show(el, text, kind) {
    el.textContent = text;
    el.className = "message" + (kind ? " " + kind : "");
  }

  // ---- 檢查設定 ----
  var url = (cfg.SUPABASE_URL || "").trim();
  var key = (cfg.SUPABASE_PUBLISHABLE_KEY || "").trim();
  var configError = "";
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    configError = "無法載入 Supabase 程式庫，請檢查網路連線後重新整理。";
  } else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    configError = "config.js 的 Supabase 網址格式不正確。";
  } else if (/^sb_secret_/.test(key)) {
    configError = "config.js 放的是 secret 金鑰，這不安全。請改用 publishable key，並到 Supabase 後台撤銷這把 secret 金鑰。";
  } else if (!key || /請填入/.test(key)) {
    configError = "尚未設定 publishable key，請編輯 config.js。";
  }
  if (configError) {
    show(authLoading, configError, "err");
    return;
  }

  // 保留登入狀態，下次打開不用再登入；
  // 註冊確認信的連結回到這個頁面時，會自動完成登入
  var client = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "badminton-auth" },
  });

  var rows = [];
  var currentUserId = null;

  // 報名日期：2026/11/18（三）13:41（臺北時間）
  var dateParts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "narrow", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  function fmtDate(d) {
    var o = {};
    dateParts.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    var hour = o.hour === "24" ? "00" : o.hour;
    return o.year + "/" + o.month + "/" + o.day + "（" + o.weekday.replace("週", "") + "）" + hour + ":" + o.minute;
  }
  var timeFmt = { format: fmtDate };

  function describeError(err) {
    if (!navigator.onLine) return "目前沒有網路連線，請連上網路後再試一次。";
    if (!err) return "未知錯誤";
    if (err.code === "23514") return "內容不符合規定（例如名字太長、程度不在 1～10）。";
    if (err.code === "42703" || err.code === "PGRST204") return "資料庫還沒有「程度」欄位，請在 Supabase 重新執行 supabase/badminton_personal.sql。";
    if (err.code === "42501") return "沒有權限，請確認已執行 supabase/badminton_personal.sql。";
    if (err.code === "42P01" || err.code === "PGRST205") return "找不到資料表，請先在 Supabase 執行 supabase/badminton_personal.sql。";
    if (err.status === 401 || /JWT|jwt/.test(err.message || "")) return "登入已過期，請重新登入。";
    return err.message || String(err);
  }

  // =====================================================================
  // 登入／註冊
  // =====================================================================
  var authMode = "login";

  function setAuthMode(mode) {
    authMode = mode;
    var signup = mode === "signup";
    $("auth-title").textContent = signup ? "註冊新帳號" : "登入";
    authSubmit.textContent = signup ? "註冊" : "登入";
    $("authPassword").autocomplete = signup ? "new-password" : "current-password";
    $("authSwitchText").textContent = signup ? "已經有帳號？" : "還沒有帳號？";
    $("authSwitch").textContent = signup ? "改用登入" : "註冊新帳號";
    show(authMessage, "", "");
  }

  $("authSwitch").addEventListener("click", function () {
    setAuthMode(authMode === "login" ? "signup" : "login");
  });

  function describeAuthError(err) {
    var m = (err && err.message) || "";
    if (/invalid login credentials/i.test(m)) return "Email 或密碼錯誤。";
    if (/email not confirmed/i.test(m)) return "這個帳號還沒完成 Email 確認，請到信箱點確認連結後再登入。";
    if (/already registered|already been registered/i.test(m)) return "這個 Email 已經註冊過，請改用登入。";
    if (/password should be at least|weak password/i.test(m)) return "密碼太短或太簡單，請至少 6 個字元。";
    // 專案開著「Confirm email」但寄不出確認信（內建寄信服務只寄給組織成員、每小時封數很少）
    if (/not authorized|error sending|sending (confirmation|magic)|smtp/i.test(m) ||
        /email rate limit/i.test(m)) {
      return "確認信寄不出去。請主辦人到 Supabase 的 Authentication → Sign In / Providers → Email，把「Confirm email」關掉後再註冊。";
    }
    if (/rate limit|too many/i.test(m)) return "嘗試次數太多，請稍後再試。";
    if (/signups not allowed|signup is disabled/i.test(m)) return "目前不開放註冊，請聯絡主辦人。";
    if (/invalid email|unable to validate email/i.test(m)) return "Email 格式不正確。";
    if (!navigator.onLine) return "目前沒有網路連線。";
    return m || "未知錯誤";
  }

  authForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("authEmail").value.trim();
    var password = $("authPassword").value;
    if (!email || !password) {
      show(authMessage, "請輸入 Email 和密碼。", "err");
      return;
    }
    if (password.length < 6) {
      show(authMessage, "密碼至少要 6 個字元。", "err");
      return;
    }
    authSubmit.disabled = true;
    authSubmit.textContent = authMode === "signup" ? "註冊中…" : "登入中…";
    show(authMessage, "", "");
    try {
      var res;
      if (authMode === "signup") {
        res = await client.auth.signUp({
          email: email,
          password: password,
          // 確認信的連結回到這個頁面
          options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (res.error) throw res.error;
        if (!res.data.session) {
          // 專案開啟了 Email 確認：要先到信箱點連結
          setAuthMode("login");
          show(authMessage, "註冊成功！請到 " + email + " 的信箱點確認連結，再回來登入。", "ok");
          return;
        }
      } else {
        res = await client.auth.signInWithPassword({ email: email, password: password });
        if (res.error) throw res.error;
      }
      $("authPassword").value = "";
      await applySession(res.data.session);
    } catch (err) {
      show(authMessage, (authMode === "signup" ? "註冊失敗：" : "登入失敗：") + describeAuthError(err), "err");
    } finally {
      authSubmit.disabled = false;
      authSubmit.textContent = authMode === "signup" ? "註冊" : "登入";
    }
  });

  $("logoutBtn").addEventListener("click", async function () {
    try { await client.auth.signOut(); } catch (e) { /* 離線時也照樣清除畫面 */ }
    await applySession(null);
    show(authMessage, "已登出。", "info");
  });

  async function applySession(session) {
    authLoading.hidden = true;
    var userId = session && session.user ? session.user.id : null;
    if (!userId) {
      currentUserId = null;
      rows = [];
      listLoaded = false;
      pendingSnapshot = null;
      promoteDialog.hidden = true;
      capacity = DEFAULT_CAPACITY;
      hasSettingsRow = false;
      money = { fee: DEFAULT_FEE, ball: 0, fund: 0, court: 0, others: [] };
      financeReady = false;
      extrasReady = false;
      showCapacity();
      show(capacityMessage, "", "");
      confirmedList.replaceChildren();
      waitlist.replaceChildren();
      appArea.hidden = true;
      // 有報名連結：顯示公開報名；沒有：顯示主辦人登入
      var isPublic = !!publicListId && !loginRequested;
      publicCard.hidden = !isPublic;
      authCard.hidden = isPublic;
      $("noListNote").hidden = !!publicListId;
      $("headerPublic").hidden = !isPublic;
      $("headerInfo").hidden = isPublic;
      return;
    }
    $("accountEmail").textContent = session.user.email || "";
    authCard.hidden = true;
    publicCard.hidden = true;
    $("headerPublic").hidden = true;
    $("headerInfo").hidden = false;
    appArea.hidden = false;
    // 自己就是預設名單時，直接分享網址即可；否則附上 ?list=
    $("shareLink").value = location.origin + location.pathname +
      (userId === DEFAULT_LIST_ID ? "" : "?list=" + userId);
    show($("shareMessage"), "", "");
    if (userId !== currentUserId) {
      currentUserId = userId;
      rows = [];
      listLoaded = false;
      await loadSettings();
      await loadList();
    }
  }

  // 登入狀態改變（例如登入過期、從確認信連結回來）時同步畫面
  client.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_OUT") applySession(null);
    else if (event === "SIGNED_IN" && session) setTimeout(function () { applySession(session); }, 0);
  });

  // =====================================================================
  // 正取名額設定
  // =====================================================================
  function describeSettingsError(err) {
    if (err && (err.code === "42P01" || err.code === "PGRST205")) {
      return "資料庫還沒有設定資料表，請在 Supabase 重新執行 supabase/badminton_personal.sql。";
    }
    return describeError(err);
  }

  function isMissingColumn(err) { return err && (err.code === "42703" || err.code === "PGRST204"); }

  async function loadSettings() {
    capacity = DEFAULT_CAPACITY;
    hasSettingsRow = false;
    money = { fee: DEFAULT_FEE, ball: 0, fund: 0, court: 0, others: [] };
    financeReady = false;
    extrasReady = false;
    show(capacityMessage, "", "");
    show($("moneyMessage"), "", "");
    try {
      // 依資料庫目前的欄位，由多到少嘗試讀取
      var res = await client.from(SETTINGS_TABLE)
        .select("capacity, fee_per_person, ball_cost, fund_balance, court_cost, other_items").maybeSingle();
      if (!res.error) {
        financeReady = extrasReady = true;
      } else if (isMissingColumn(res.error)) {
        res = await client.from(SETTINGS_TABLE)
          .select("capacity, fee_per_person, ball_cost, fund_balance").maybeSingle();
        if (!res.error) {
          financeReady = true;
          show($("moneyMessage"), "「今日場地費」與「其他」還沒開通，請在 Supabase 執行新增欄位的 SQL。", "err");
        } else if (isMissingColumn(res.error)) {
          // 資料庫還沒加收費欄位：先只讀正取名額
          res = await client.from(SETTINGS_TABLE).select("capacity").maybeSingle();
          show($("moneyMessage"), "收費與球團帳還沒開通，請在 Supabase 重新執行 supabase/badminton_personal.sql。", "err");
        }
      }
      if (res.error) throw res.error;
      if (res.data) {
        hasSettingsRow = true;
        if (CAPACITY_OPTIONS.indexOf(res.data.capacity) >= 0) capacity = res.data.capacity;
        if (financeReady) {
          money.fee = res.data.fee_per_person;
          money.ball = res.data.ball_cost;
          money.fund = res.data.fund_balance;
        }
        if (extrasReady) {
          money.court = res.data.court_cost;
          money.others = cleanOthers(res.data.other_items);
        }
      }
    } catch (err) {
      show(capacityMessage, "無法讀取設定，暫時使用 " + DEFAULT_CAPACITY + " 人。" + describeSettingsError(err), "err");
    }
    showCapacity();
    showMoneyInputs();
  }

  // 儲存設定的部分欄位；第一次新增，之後更新
  async function saveSettings(patch) {
    var cols = Object.keys(patch).join(", ");
    var res;
    if (hasSettingsRow) {
      res = await client.from(SETTINGS_TABLE)
        .update(Object.assign({ updated_at: new Date().toISOString() }, patch))
        .eq("owner_id", currentUserId)
        .select(cols);
    } else {
      // owner_id 由資料庫自動填入目前登入的帳號
      res = await client.from(SETTINGS_TABLE).insert(patch).select(cols);
      if (res.error && res.error.code === "23505") {
        // 已經有設定（例如另一台裝置剛建立）：改成更新
        res = await client.from(SETTINGS_TABLE)
          .update(Object.assign({ updated_at: new Date().toISOString() }, patch))
          .eq("owner_id", currentUserId)
          .select(cols);
      }
    }
    if (res.error) throw res.error;
    if (!res.data || res.data.length !== 1) throw { code: "42501" };
    hasSettingsRow = true;
    return res.data[0];
  }

  async function saveCapacity(next) {
    var prev = capacity;
    capacity = next;
    showCapacity();
    render();
    show(capacityMessage, "儲存中…", "info");
    try {
      await saveSettings({ capacity: next });
      show(capacityMessage, "已改為正取 " + next + " 人（" + Math.ceil(next / perCourt) + " 場）。", "ok");
    } catch (err) {
      capacity = prev;
      showCapacity();
      render();
      show(capacityMessage, "儲存失敗：" + describeSettingsError(err), "err");
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll('input[name="capacity"]'), function (radio) {
    radio.addEventListener("change", function () {
      var next = parseInt(radio.value, 10);
      if (currentUserId && next !== capacity) saveCapacity(next);
    });
  });

  // =====================================================================
  // 收費與球團帳（只有主辦人看得到）
  //   今日應收 = 正取人數 × 每人報名費
  //   今日餘額 = 球團總餘額 + 今日應收 − 今日場地費 − 今日用球 − 其他
  // =====================================================================
  var moneyFmt = new Intl.NumberFormat("zh-TW");
  function nt(n) { return (n < 0 ? "−" : "") + moneyFmt.format(Math.abs(n)) + " 元"; }
  var lastCounts = { confirmed: 0, paid: 0 };

  // 其他減項：只保留名稱 1～30 字、金額 0～1,000,000 的整數
  function cleanOthers(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (it) {
      return it && typeof it.name === "string" && Number.isInteger(it.amount);
    }).slice(0, MAX_OTHERS).map(function (it) {
      return { name: it.name.slice(0, 30), amount: it.amount };
    });
  }
  function othersTotal() {
    return money.others.reduce(function (sum, it) { return sum + it.amount; }, 0);
  }

  function showMoneyInputs() {
    $("feeInput").value = String(money.fee);
    $("courtInput").value = String(money.court);
    $("ballInput").value = String(money.ball);
    $("fundInput").value = String(money.fund);
    ["feeInput", "ballInput", "fundInput", "settleBtn"].forEach(function (id) { $(id).disabled = !financeReady; });
    ["courtInput", "addOtherBtn"].forEach(function (id) { $(id).disabled = !extrasReady; });
    renderOthersEditor();
    renderMoney(lastCounts.confirmed, lastCounts.paid);
  }

  function renderMoney(confirmedCount, paidCount) {
    lastCounts = { confirmed: confirmedCount, paid: paidCount };
    var due = confirmedCount * money.fee;
    var other = othersTotal();
    var balance = money.fund + due - money.court - money.ball - other;
    $("moneyCourt").textContent = "− " + nt(money.court);
    $("moneyOther").textContent = "− " + nt(other);
    $("moneyOtherLabel").textContent = "其他" + (money.others.length ? "（" + money.others.length + " 項）" : "");
    // 其他明細
    var detail = $("moneyOtherDetail");
    detail.replaceChildren();
    money.others.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "sub";
      var dt = document.createElement("dt"); dt.textContent = "・" + (it.name || "（未命名）");
      var dd = document.createElement("dd"); dd.textContent = "− " + nt(it.amount);
      row.appendChild(dt); row.appendChild(dd);
      detail.appendChild(row);
    });
    $("moneyPeople").textContent = confirmedCount + " 人";
    $("moneyFeeEcho").textContent = nt(money.fee);
    $("moneyDue").textContent = nt(due);
    $("moneyDue2").textContent = nt(due);
    $("moneyPaid").textContent = paidCount + " 人 · " + nt(paidCount * money.fee);
    $("moneyBall").textContent = "− " + nt(money.ball);
    $("moneyFund").textContent = nt(money.fund);
    var bal = $("moneyBalance");
    bal.textContent = nt(balance);
    bal.classList.toggle("negative", balance < 0);
    return balance;
  }

  // 輸入框：離開或按 Enter 時儲存
  [["feeInput", "fee_per_person", "fee", 0, 100000, "每人報名費"],
   ["courtInput", "court_cost", "court", 0, 1000000, "今日場地費"],
   ["ballInput", "ball_cost", "ball", 0, 1000000, "今日用球"],
   ["fundInput", "fund_balance", "fund", -100000000, 100000000, "球團總餘額"]].forEach(function (cfgRow) {
    var input = $(cfgRow[0]), col = cfgRow[1], key = cfgRow[2], min = cfgRow[3], max = cfgRow[4], label = cfgRow[5];
    input.addEventListener("change", async function () {
      var msg = $("moneyMessage");
      var v = Number(String(input.value).replace(/[,\s]/g, ""));
      if (!Number.isInteger(v) || v < min || v > max) {
        show(msg, label + "請輸入 " + moneyFmt.format(min) + "～" + moneyFmt.format(max) + " 的整數。", "err");
        input.value = String(money[key]);
        return;
      }
      if (v === money[key]) return;
      var prev = money[key];
      money[key] = v;
      renderMoney(lastCounts.confirmed, lastCounts.paid);
      show(msg, "儲存中…", "info");
      try {
        var patch = {}; patch[col] = v;
        await saveSettings(patch);
        show(msg, "已儲存" + label + "：" + nt(v) + "。", "ok");
      } catch (err) {
        money[key] = prev;
        input.value = String(prev);
        renderMoney(lastCounts.confirmed, lastCounts.paid);
        show(msg, "儲存失敗：" + (isMissingColumn(err)
          ? "收費與球團帳還沒開通，請在 Supabase 重新執行 supabase/badminton_personal.sql。"
          : describeSettingsError(err)), "err");
      }
    });
  });

  // ---- 其他減項（活動、請喝飲料、受傷退費…）----
  // 每筆有名稱與金額；新增、修改、刪除後整份清單一起儲存
  function renderOthersEditor() {
    var box = $("otherList");
    box.replaceChildren();
    money.others.forEach(function (it, idx) {
      var row = document.createElement("div");
      row.className = "other-row";

      var name = document.createElement("input");
      name.type = "text"; name.maxLength = 30; name.placeholder = "名稱，例如：請喝飲料";
      name.value = it.name; name.disabled = !extrasReady;
      name.setAttribute("aria-label", "其他第 " + (idx + 1) + " 項名稱");

      var amount = document.createElement("input");
      amount.type = "number"; amount.inputMode = "numeric"; amount.min = "0"; amount.max = "1000000"; amount.step = "1";
      amount.value = String(it.amount); amount.disabled = !extrasReady;
      amount.setAttribute("aria-label", "其他第 " + (idx + 1) + " 項金額");

      var unit = document.createElement("em"); unit.textContent = "元";

      var del = document.createElement("button");
      del.type = "button"; del.className = "other-del"; del.textContent = "✕"; del.disabled = !extrasReady;
      del.setAttribute("aria-label", "刪除「" + (it.name || "第 " + (idx + 1) + " 項") + "」");

      name.addEventListener("change", function () {
        var v = name.value.trim();
        if (v === it.name) return;
        var next = money.others.slice(); next[idx] = { name: v, amount: it.amount };
        saveOthers(next, "已儲存其他項目名稱。");
      });
      amount.addEventListener("change", function () {
        var v = Number(String(amount.value).replace(/[,\s]/g, ""));
        if (!Number.isInteger(v) || v < 0 || v > 1000000) {
          show($("moneyMessage"), "其他金額請輸入 0～1,000,000 的整數。", "err");
          amount.value = String(it.amount);
          return;
        }
        if (v === it.amount) return;
        var next = money.others.slice(); next[idx] = { name: it.name, amount: v };
        saveOthers(next, "已儲存「" + (it.name || "其他") + "」：" + nt(v) + "。");
      });
      del.addEventListener("click", function () {
        var next = money.others.slice(); next.splice(idx, 1);
        saveOthers(next, "已刪除「" + (it.name || "其他") + "」。");
      });

      var amountWrap = document.createElement("span");
      amountWrap.className = "money-input";
      amountWrap.appendChild(amount); amountWrap.appendChild(unit);
      row.appendChild(name); row.appendChild(amountWrap); row.appendChild(del);
      box.appendChild(row);
    });
    $("addOtherBtn").disabled = !extrasReady || money.others.length >= MAX_OTHERS;
  }

  async function saveOthers(next, okText) {
    var msg = $("moneyMessage");
    var prev = money.others;
    money.others = next;
    renderOthersEditor();
    renderMoney(lastCounts.confirmed, lastCounts.paid);
    show(msg, "儲存中…", "info");
    try {
      await saveSettings({ other_items: next });
      show(msg, okText, "ok");
      return true;
    } catch (err) {
      money.others = prev;
      renderOthersEditor();
      renderMoney(lastCounts.confirmed, lastCounts.paid);
      show(msg, "儲存失敗：" + (isMissingColumn(err)
        ? "「其他」還沒開通，請在 Supabase 執行新增欄位的 SQL。"
        : describeSettingsError(err)), "err");
      return false;
    }
  }

  $("addOtherBtn").addEventListener("click", async function () {
    if (money.others.length >= MAX_OTHERS) {
      show($("moneyMessage"), "其他項目最多 " + MAX_OTHERS + " 筆。", "err");
      return;
    }
    var ok = await saveOthers(money.others.concat([{ name: "", amount: 0 }]), "已新增一筆，請填寫名稱與金額。");
    if (ok) {
      var rowsEl = $("otherList").querySelectorAll(".other-row input[type=text]");
      if (rowsEl.length) rowsEl[rowsEl.length - 1].focus();
    }
  });

  // 按兩次確認的按鈕：第一次按顯示確認文字，5 秒內再按才執行
  function twoStep(btn, confirmText, action) {
    var original = btn.textContent;
    btn.addEventListener("click", function () {
      if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1";
        btn.classList.add("armed");
        btn.textContent = confirmText();
        setTimeout(function () {
          if (btn.dataset.armed === "1" && !btn.disabled) {
            btn.dataset.armed = "";
            btn.classList.remove("armed");
            btn.textContent = original;
          }
        }, 5000);
        return;
      }
      btn.dataset.armed = "";
      btn.classList.remove("armed");
      btn.textContent = original;
      action();
    });
  }

  // 結算今日：今日餘額 → 新的球團總餘額，今日用球歸零
  twoStep($("settleBtn"), function () {
    return "確定把 " + nt(renderMoney(lastCounts.confirmed, lastCounts.paid)) + " 存為球團總餘額？";
  }, async function () {
    var msg = $("moneyMessage");
    var newFund = renderMoney(lastCounts.confirmed, lastCounts.paid);
    var prev = { fund: money.fund, ball: money.ball, court: money.court, others: money.others };
    $("settleBtn").disabled = true;
    show(msg, "結算中…", "info");
    try {
      var patch = { fund_balance: newFund, ball_cost: 0 };
      if (extrasReady) { patch.court_cost = 0; patch.other_items = []; }
      await saveSettings(patch);
      money.fund = newFund;
      money.ball = 0;
      if (extrasReady) { money.court = 0; money.others = []; }
      showMoneyInputs();
      show(msg, "已結算：球團總餘額為 " + nt(newFund) + "，今日場地費、用球、其他已歸零。下一次開放報名前，請按下方「清除全部名單」，今日應收才會歸零。", "ok");
    } catch (err) {
      money.fund = prev.fund; money.ball = prev.ball; money.court = prev.court; money.others = prev.others;
      showMoneyInputs();
      show(msg, "結算失敗：" + (isMissingColumn(err)
        ? "收費與球團帳還沒開通，請在 Supabase 重新執行 supabase/badminton_personal.sql。"
        : describeSettingsError(err)), "err");
    } finally {
      $("settleBtn").disabled = !financeReady;
    }
  });

  // 重新開放報名：一鍵清除自己名單上的所有人（資料庫規則只允許刪除自己的名單）
  twoStep($("clearAllBtn"), function () {
    return "確定清除全部 " + rows.length + " 人？無法復原";
  }, async function () {
    var msg = $("clearMessage");
    if (!rows.length) { show(msg, "名單已經是空的。", "info"); return; }
    $("clearAllBtn").disabled = true;
    show(msg, "清除中…", "info");
    try {
      var res = await client.from(TABLE).delete().eq("owner_id", currentUserId).select("id");
      if (res.error) throw res.error;
      var n = res.data ? res.data.length : 0;
      await loadList();
      show(msg, "已清除 " + n + " 人，可以重新開放報名了。", "ok");
    } catch (err) {
      show(msg, "清除失敗：" + describeError(err), "err");
    } finally {
      $("clearAllBtn").disabled = false;
    }
  });

  // =====================================================================
  // 名單
  // =====================================================================
  function renderPlayer(r, label) {
    // 一律用 textContent 放入資料，避免輸入內容被當成 HTML 執行
    var li = document.createElement("li");

    var top = document.createElement("div");
    top.className = "player-top";

    var order = document.createElement("span");
    order.className = "player-order";
    order.textContent = label;
    top.appendChild(order);

    var name = document.createElement("span");
    name.className = "player-name";
    name.textContent = r.name;
    top.appendChild(name);

    // 繳費狀態是按鈕，點一下就切換
    var paid = document.createElement("button");
    paid.type = "button";
    paid.className = "badge toggle " + (r.paid ? "paid" : "unpaid");
    paid.textContent = r.paid ? "已繳費" : "未繳費";
    paid.setAttribute("aria-pressed", r.paid ? "true" : "false");
    paid.setAttribute("aria-label", r.name + "：" + paid.textContent + "，點選切換");
    paid.addEventListener("click", function () { togglePaid(r, paid); });
    top.appendChild(paid);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "刪除";
    del.setAttribute("aria-label", "刪除「" + r.name + "」");
    del.addEventListener("click", function () { deletePlayer(r, del); });
    top.appendChild(del);
    li.appendChild(top);

    var meta = document.createElement("div");
    meta.className = "item-meta";
    var note = r.level != null ? "程度：" + r.level
      : (r.level_note && r.level_note.trim() ? "程度：" + r.level_note.trim() : "程度：未填");
    meta.textContent = note + " · 報名 " + timeFmt.format(new Date(r.created_at));
    li.appendChild(meta);
    return li;
  }

  function render() {
    var confirmed = rows.slice(0, capacity);
    var waiting = rows.slice(capacity);

    confirmedList.replaceChildren();
    confirmed.forEach(function (r, i) {
      confirmedList.appendChild(renderPlayer(r, "第 " + (i + 1) + " 位"));
    });
    waitlist.replaceChildren();
    waiting.forEach(function (r, i) {
      waitlist.appendChild(renderPlayer(r, "候補 " + (i + 1)));
    });

    $("confirmedCount").textContent = String(confirmed.length);
    $("waitlistCount").textContent = String(waiting.length);
    $("totalCount").textContent = String(rows.length);
    $("paidCount").textContent = String(rows.filter(function (r) { return r.paid; }).length);

    waitlistEmpty.hidden = waiting.length > 0;
    if (!rows.length) show(listMessage, "名單還是空的，從上方新增第一位吧。", "info");
    else show(listMessage, "", "");

    renderMoney(confirmed.length, rows.filter(function (r) { return r.paid; }).length);
    checkPromotions(confirmed, waiting);
  }

  // =====================================================================
  // 候補遞補通知
  // - 記住「上次確認時」的候補名單（存在這台裝置，依帳號分開）。
  // - 之後若其中有人變成正取（有人被刪除、正取名額增加），就跳出通知，
  //   按「確認 OK」後才更新紀錄；沒按就關掉頁面，下次打開仍會通知。
  // =====================================================================
  var listLoaded = false;
  var promoteDialog = $("promoteDialog");
  var pendingSnapshot = null;

  function snapshotKey() { return "badminton-waitlist-" + currentUserId; }

  function readSnapshot() {
    try {
      var raw = localStorage.getItem(snapshotKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeSnapshot(waitIds) {
    try { localStorage.setItem(snapshotKey(), JSON.stringify({ wait: waitIds })); } catch (e) { /* 無法記住時只會少一次通知 */ }
  }

  function checkPromotions(confirmed, waiting) {
    if (!listLoaded || !currentUserId) return;
    var waitIds = waiting.map(function (r) { return r.id; });
    var snap = readSnapshot();
    var prevWait = snap && Array.isArray(snap.wait) ? snap.wait : null;

    var promoted = [];
    if (prevWait) {
      confirmed.forEach(function (r, i) {
        if (prevWait.indexOf(r.id) >= 0) promoted.push({ name: r.name, pos: i + 1 });
      });
    }

    if (!promoted.length) {
      // 沒有新的遞補：直接更新紀錄，並關閉可能還開著的通知
      writeSnapshot(waitIds);
      pendingSnapshot = null;
      promoteDialog.hidden = true;
      return;
    }

    // 有人遞補：先不更新紀錄，等管理員按「確認 OK」
    pendingSnapshot = waitIds;
    var list = $("promoteList");
    list.replaceChildren();
    promoted.forEach(function (p) {
      var li = document.createElement("li");
      var strong = document.createElement("strong");
      strong.textContent = p.name;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(" → 正取第 " + p.pos + " 位"));
      list.appendChild(li);
    });
    $("promoteText").textContent = "以下 " + promoted.length + " 位已從候補遞補為正取：";
    if (promoteDialog.hidden) {
      promoteDialog.hidden = false;
      $("promoteOk").focus();
    }
  }

  $("promoteOk").addEventListener("click", function () {
    if (pendingSnapshot) writeSnapshot(pendingSnapshot);
    pendingSnapshot = null;
    promoteDialog.hidden = true;
  });

  async function loadList() {
    if (!currentUserId) return false;
    refreshBtn.disabled = true;
    show(listMessage, "載入中…", "info");
    try {
      // 依加入時間由早到晚排序：前 capacity 名正取，其餘候補
      // （資料庫規則只會回傳自己的名單）
      var res = await client
        .from(TABLE)
        .select("id, created_at, name, level, level_note, paid")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(MAX_ROWS);
      if (res.error) throw res.error;
      rows = res.data;
      listLoaded = true;
      render();
      return true;
    } catch (err) {
      showListMessage("名單載入失敗：" + describeError(err), "err");
      return false;
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // 名單訊息顯示後捲到畫面上，避免按鈕在下方時看不到
  function showListMessage(text, kind) {
    show(listMessage, text, kind);
    if (text) listMessage.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // =====================================================================
  // 新增
  // =====================================================================
  var dupConfirmName = "";
  $("name").addEventListener("input", function () {
    if (dupConfirmName) {
      dupConfirmName = "";
      submitBtn.textContent = "送出報名";
      show(formMessage, "", "");
    }
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("name").value.trim();
    var level = parseInt($("level").value, 10);
    var payChoice = form.querySelector('input[name="pay"]:checked');
    var paid = payChoice ? payChoice.value === "已繳費" : false;

    if (!name) {
      show(formMessage, "請填寫名字。", "err");
      return;
    }
    if (!(level >= 1 && level <= 10)) {
      show(formMessage, "請選擇程度（1～10）。", "err");
      return;
    }
    // 同名時在頁面上確認：再按一次「送出報名」才送出
    var dup = rows.some(function (r) { return r.name.trim() === name; });
    if (dup && dupConfirmName !== name) {
      dupConfirmName = name;
      submitBtn.textContent = "再按一次確認送出";
      show(formMessage, "名單上已經有「" + name + "」。確定要再加入一次，請再按一次送出。", "err");
      return;
    }
    dupConfirmName = "";

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    show(formMessage, "", "");
    try {
      // owner_id 由資料庫自動填入目前登入的帳號
      var res = await client.from(TABLE).insert({
        name: name,
        level: level,
        paid: paid,
      });
      if (res.error) throw res.error;

      form.reset();
      var ok = await loadList();
      var pos = -1;
      for (var i = rows.length - 1; i >= 0; i--) {
        if (rows[i].name.trim() === name) { pos = i; break; }
      }
      var payText = paid ? "已繳費" : "未繳費";
      if (!ok || pos < 0) {
        show(formMessage, "已加入名單！", "ok");
      } else if (pos < capacity) {
        show(formMessage, "已加入！「" + name + "」是正取第 " + (pos + 1) + " 位（" + payText + "）。", "ok");
      } else {
        show(formMessage, "正取已額滿，「" + name + "」排在候補第 " + (pos - capacity + 1) + " 位（" + payText + "）。", "ok");
      }
    } catch (err) {
      show(formMessage, "新增失敗：" + describeError(err), "err");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出報名";
    }
  });

  refreshBtn.addEventListener("click", loadList);

  // 「＋ 新增人員」：跳到上方的表單
  $("addBtn").addEventListener("click", function () {
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    $("name").focus({ preventScroll: true });
  });

  // =====================================================================
  // 切換繳費狀態
  // =====================================================================
  async function togglePaid(r, btn) {
    var next = !r.paid;
    btn.disabled = true;
    btn.textContent = "更新中…";
    try {
      // 加上 select 才能確認真的改到一筆
      var res = await client
        .from(TABLE)
        .update({ paid: next })
        .eq("id", r.id)
        .select("id, paid");
      if (res.error) throw res.error;
      if (!res.data || res.data.length !== 1) throw { code: "42501" };
      r.paid = res.data[0].paid;
      render();
      show(listMessage, "已將「" + r.name + "」改為" + (r.paid ? "已繳費" : "未繳費") + "。", "ok");
    } catch (err) {
      render();
      showListMessage("更新失敗：" + describeError(err), "err");
    }
  }

  // =====================================================================
  // 刪除：第一次按變成「確定刪除？」，4 秒內再按一次才刪除
  // =====================================================================
  async function deletePlayer(r, btn) {
    if (btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.classList.add("armed");
      btn.textContent = "確定刪除？";
      btn.setAttribute("aria-label", "再按一次刪除「" + r.name + "」");
      setTimeout(function () {
        if (btn.isConnected && btn.dataset.armed === "1" && !btn.disabled) {
          btn.dataset.armed = "";
          btn.classList.remove("armed");
          btn.textContent = "刪除";
          btn.setAttribute("aria-label", "刪除「" + r.name + "」");
        }
      }, 4000);
      return;
    }
    btn.disabled = true;
    btn.textContent = "刪除中…";
    try {
      var res = await client
        .from(TABLE)
        .delete()
        .eq("id", r.id)
        .select("id");
      if (res.error) throw res.error;
      if (!res.data || res.data.length !== 1) throw { code: "42501" };
      await loadList();
      showListMessage("已刪除「" + r.name + "」。", "ok");
    } catch (err) {
      btn.disabled = false;
      btn.dataset.armed = "";
      btn.classList.remove("armed");
      btn.textContent = "刪除";
      showListMessage("刪除失敗：" + describeError(err), "err");
    }
  }

  // =====================================================================
  // 公開報名（不用登入）
  // =====================================================================
  var publicForm = $("publicForm");
  var publicSubmit = $("publicSubmit");

  // 送出按鈕是圖片：送出中把圖片調暗並顯示「送出中…」，不要改掉按鈕內容
  function setPublicBusy(busy) {
    publicSubmit.disabled = busy;
    publicSubmit.querySelector(".submit-busy").hidden = !busy;
    publicSubmit.setAttribute("aria-label", busy ? "送出中" : "送出報名");
  }
  var publicMessage = $("publicMessage");

  function describePublicError(err) {
    var m = (err && err.message) || "";
    if (err && (err.code === "PGRST202" || err.code === "42883")) {
      return "報名功能還沒開通，請主辦人在 Supabase 重新執行 supabase/badminton_personal.sql。";
    }
    if (err && err.code === "P0002") return "找不到這份報名名單，請向主辦人確認報名連結。";
    if (err && (err.code === "P0001" || err.code === "22023")) return m;
    return describeError(err);
  }

  publicForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("publicName").value.trim();
    var level = parseInt($("publicLevel").value, 10);
    if (!name) { show(publicMessage, "請填寫名字。", "err"); return; }
    if (!(level >= 1 && level <= 10)) { show(publicMessage, "請選擇程度（1～10）。", "err"); return; }
    if (!publicListId) { show(publicMessage, "沒有報名連結，請向主辦人索取。", "err"); return; }

    setPublicBusy(true);
    show(publicMessage, "", "");
    try {
      var res = await client.rpc("badminton_public_signup", {
        p_list: publicListId,
        p_name: name,
        p_level: level,
      });
      if (res.error) throw res.error;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      var when = "報名時間：" + fmtDate(new Date()) + "。";
      publicForm.reset();
      if (!row) {
        show(publicMessage, "報名成功！" + when, "ok");
      } else if (row.out_position <= row.out_capacity) {
        show(publicMessage, "報名成功！「" + name + "」是正取第 " + row.out_position + " 位。" + when, "ok");
      } else {
        show(publicMessage, "報名成功！正取已額滿，「" + name + "」排在候補第 " +
          (row.out_position - row.out_capacity) + " 位。" + when, "ok");
      }
    } catch (err) {
      show(publicMessage, "報名失敗：" + describePublicError(err), "err");
    } finally {
      setPublicBusy(false);
    }
  });

  $("showLogin").addEventListener("click", function () {
    loginRequested = true;
    publicCard.hidden = true;
    authCard.hidden = false;
    $("headerPublic").hidden = true;
    $("headerInfo").hidden = false;
    $("authEmail").focus();
  });

  // ---- 主辦人：複製報名連結 ----
  $("copyShare").addEventListener("click", async function () {
    var input = $("shareLink");
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(input.value);
        ok = true;
      }
    } catch (e) { /* 改用選取文字 */ }
    if (!ok) {
      input.focus();
      input.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    }
    show($("shareMessage"), ok ? "已複製，可以貼到 LINE 或群組。" : "請長按連結自行複製。", ok ? "ok" : "info");
  });

  // =====================================================================
  // 啟動：先確認是否已登入
  // =====================================================================
  client.auth.getSession().then(function (res) {
    return applySession(res.data && res.data.session);
  }).catch(function () {
    return applySession(null);
  });
})();
