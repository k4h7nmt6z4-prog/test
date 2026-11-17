// 羽球報名前端：每個人登入後管理自己的名單。
//
// 資料表：badminton_players（見 supabase/badminton_personal.sql）
//   name        → 名字
//   level_note  → 程度備註（選填）
//   paid        → 是否已繳費
//   owner_id    → 建立者，由資料庫自動填入目前登入的帳號
//
// 資料庫規則限定每個帳號只能讀寫自己的名單，網頁不需要也不能指定 owner_id。
// 確認動作都在頁面上完成，不用 window.confirm（有些瀏覽器或內嵌視窗會封鎖跳出視窗）。
(function () {
  "use strict";

  var TABLE = "badminton_players";
  var MAX_ROWS = 500;

  var cfg = window.APP_CONFIG || {};
  var courts = Number(cfg.BADMINTON_COURTS) || 2;
  var perCourt = Number(cfg.BADMINTON_PLAYERS_PER_COURT) || 8;
  var capacity = courts * perCourt;

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

  $("courtsText").textContent = String(courts);
  $("perCourtText").textContent = String(perCourt);
  $("capacityText").textContent = String(capacity);
  $("capacityStat").textContent = String(capacity);

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

  var timeFmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function describeError(err) {
    if (!navigator.onLine) return "目前沒有網路連線，請連上網路後再試一次。";
    if (!err) return "未知錯誤";
    if (err.code === "23514") return "內容不符合規定（例如名字太長）。";
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
      confirmedList.replaceChildren();
      waitlist.replaceChildren();
      appArea.hidden = true;
      authCard.hidden = false;
      return;
    }
    $("accountEmail").textContent = session.user.email || "";
    authCard.hidden = true;
    appArea.hidden = false;
    if (userId !== currentUserId) {
      currentUserId = userId;
      rows = [];
      await loadList();
    }
  }

  // 登入狀態改變（例如登入過期、從確認信連結回來）時同步畫面
  client.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_OUT") applySession(null);
    else if (event === "SIGNED_IN" && session) setTimeout(function () { applySession(session); }, 0);
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
    var note = r.level_note && r.level_note.trim() ? "程度：" + r.level_note.trim() : "程度：未填";
    meta.textContent = note + " · 加入 " + timeFmt.format(new Date(r.created_at));
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
  }

  async function loadList() {
    if (!currentUserId) return false;
    refreshBtn.disabled = true;
    show(listMessage, "載入中…", "info");
    try {
      // 依加入時間由早到晚排序：前 capacity 名正取，其餘候補
      // （資料庫規則只會回傳自己的名單）
      var res = await client
        .from(TABLE)
        .select("id, created_at, name, level_note, paid")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(MAX_ROWS);
      if (res.error) throw res.error;
      rows = res.data;
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
    var note = $("level_note").value.trim();
    var payChoice = form.querySelector('input[name="pay"]:checked');
    var paid = payChoice ? payChoice.value === "已繳費" : false;

    if (!name) {
      show(formMessage, "請填寫名字。", "err");
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
        level_note: note || null,
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
  // 啟動：先確認是否已登入
  // =====================================================================
  client.auth.getSession().then(function (res) {
    return applySession(res.data && res.data.session);
  }).catch(function () {
    return applySession(null);
  });
})();
