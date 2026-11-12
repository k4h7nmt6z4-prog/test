// 羽球報名前端：報名、正取／候補名單、人數與繳費統計。
//
// 資料沿用報修資料表 repair_requests（不需另外建表），欄位對應如下：
//   reporter_name  → 名字
//   description    → 程度備註（沒填時存「未填」，因為這欄必填）
//   location       → 固定為「羽球報名」，用來和一般報修資料區分
//   category       → 固定為「其他」
//   status         → 「已完成」代表已繳費，其他狀態都算未繳費
//                     （管理員在 Supabase 後台把 status 改成「已完成」）
(function () {
  "use strict";

  var TABLE = "repair_requests";
  var MARK_LOCATION = "羽球報名";
  var MARK_CATEGORY = "其他";
  var NOTE_EMPTY = "未填";
  var PAID_STATUS = "已完成";
  var MAX_ROWS = 200;

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
    show(formMessage, configError, "err");
    show(listMessage, configError, "err");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    return;
  }

  // 保留登入狀態，管理員重新整理頁面後不用再登入
  var client = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "badminton-admin-auth" },
  });

  var rows = [];
  var isAdmin = false;

  var timeFmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function describeError(err) {
    if (!err) return "未知錯誤";
    if (err.code === "23514") return "內容不符合規定（例如名字太長）。";
    if (err.code === "42501") return "沒有權限，請確認資料庫的權限與安全規則已設定。";
    if (err.code === "42P01" || err.code === "PGRST205") return "找不到資料表，請確認已執行 supabase/schema.sql。";
    return err.message || String(err);
  }

  // ---- 名單 ----
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

    // 管理員看到的是可點選的按鈕，其他人只看到標籤
    var paid = document.createElement(isAdmin ? "button" : "span");
    paid.className = "badge " + (r.paid ? "paid" : "unpaid");
    paid.textContent = r.paid ? "已繳費" : "未繳費";
    if (isAdmin) {
      paid.type = "button";
      paid.classList.add("toggle");
      paid.setAttribute("aria-pressed", r.paid ? "true" : "false");
      paid.setAttribute("aria-label", r.name + "：" + paid.textContent + "，點選切換");
      paid.addEventListener("click", function () { togglePaid(r, paid); });
    }
    top.appendChild(paid);
    li.appendChild(top);

    var meta = document.createElement("div");
    meta.className = "item-meta";
    var note = r.level_note && r.level_note.trim() ? "程度：" + r.level_note.trim() : "程度：未填";
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
    if (!rows.length) show(listMessage, "目前還沒有人報名。", "info");
    else show(listMessage, "", "");
  }

  async function loadList() {
    refreshBtn.disabled = true;
    show(listMessage, "載入中…", "info");
    try {
      // 依報名時間由早到晚排序：前 capacity 名正取，其餘候補
      var res = await client
        .from(TABLE)
        .select("id, created_at, reporter_name, description, status")
        .eq("location", MARK_LOCATION)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(MAX_ROWS);
      if (res.error) throw res.error;
      // 轉成羽球報名用的欄位
      rows = res.data.map(function (r) {
        return {
          id: r.id,
          created_at: r.created_at,
          name: r.reporter_name,
          level_note: r.description === NOTE_EMPTY ? null : r.description,
          paid: r.status === PAID_STATUS,
        };
      });
      render();
      return true;
    } catch (err) {
      show(listMessage, "名單載入失敗：" + describeError(err), "err");
      return false;
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // ---- 報名 ----
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("name").value.trim();
    var note = $("level_note").value.trim();

    if (!name) {
      show(formMessage, "請填寫名字。", "err");
      return;
    }
    var dup = rows.some(function (r) { return r.name.trim() === name; });
    if (dup && !window.confirm("名單上已經有「" + name + "」，確定要再報名一次嗎？")) {
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    show(formMessage, "", "");
    try {
      // 不送 status：由資料庫預設為「待處理」，也就是未繳費
      var res = await client.from(TABLE).insert({
        reporter_name: name,
        location: MARK_LOCATION,
        category: MARK_CATEGORY,
        description: note || NOTE_EMPTY,
      });
      if (res.error) throw res.error;

      form.reset();
      var ok = await loadList();
      var pos = -1;
      for (var i = rows.length - 1; i >= 0; i--) {
        if (rows[i].name.trim() === name) { pos = i; break; }
      }
      if (!ok || pos < 0) {
        show(formMessage, "已送出報名！", "ok");
      } else if (pos < capacity) {
        show(formMessage, "報名成功！你是正取第 " + (pos + 1) + " 位。", "ok");
      } else {
        show(formMessage, "正取已額滿，你排在候補第 " + (pos - capacity + 1) + " 位。", "ok");
      }
    } catch (err) {
      show(formMessage, "報名失敗：" + describeError(err), "err");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出報名";
    }
  });

  refreshBtn.addEventListener("click", loadList);

  // ---- 管理員：切換繳費狀態 ----
  async function togglePaid(r, btn) {
    var next = !r.paid;
    btn.disabled = true;
    btn.textContent = "更新中…";
    try {
      // 加上 select 才能確認真的改到一筆；權限不足時資料庫會回傳 0 筆
      var res = await client
        .from(TABLE)
        .update({ status: next ? PAID_STATUS : "待處理" })
        .eq("id", r.id)
        .eq("location", MARK_LOCATION)
        .select("id, status");
      if (res.error) throw res.error;
      if (!res.data || res.data.length !== 1) {
        throw { message: "沒有修改權限，請確認這個帳號已設為管理員。" };
      }
      r.paid = res.data[0].status === PAID_STATUS;
      render();
      show(listMessage, "已將「" + r.name + "」改為" + (r.paid ? "已繳費" : "未繳費") + "。", "ok");
    } catch (err) {
      render();
      show(listMessage, "更新失敗：" + describeError(err), "err");
    }
  }

  // ---- 管理員：登入／登出 ----
  var loginForm = $("loginForm");
  var loginBtn = $("loginBtn");
  var adminPanel = $("adminPanel");
  var adminMessage = $("adminMessage");

  async function applySession(session) {
    var wasAdmin = isAdmin;
    isAdmin = false;
    if (session && session.user) {
      var res = await client
        .from("badminton_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      isAdmin = !res.error && !!res.data;
      loginForm.hidden = true;
      adminPanel.hidden = false;
      $("adminWho").textContent = "已登入：" + (session.user.email || "") +
        (isAdmin ? "（管理員）" : "");
      if (!isAdmin) {
        var why = res.error && (res.error.code === "42P01" || res.error.code === "PGRST205")
          ? "尚未執行 supabase/badminton_admin.sql。"
          : "這個帳號不是管理員，無法修改繳費狀態。";
        show(adminMessage, why, "err");
      } else {
        show(adminMessage, "可以點選名單上的「已繳費／未繳費」切換。", "ok");
        $("adminBox").open = true;
      }
    } else {
      loginForm.hidden = false;
      adminPanel.hidden = true;
    }
    if (wasAdmin !== isAdmin && rows.length) render();
  }

  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("adminEmail").value.trim();
    var password = $("adminPassword").value;
    if (!email || !password) {
      show(adminMessage, "請輸入 Email 和密碼。", "err");
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = "登入中…";
    show(adminMessage, "", "");
    try {
      var res = await client.auth.signInWithPassword({ email: email, password: password });
      if (res.error) {
        var msg = /invalid login credentials/i.test(res.error.message) ? "Email 或密碼錯誤。"
          : /email not confirmed/i.test(res.error.message) ? "這個帳號的 Email 尚未確認。"
          : res.error.message;
        show(adminMessage, "登入失敗：" + msg, "err");
        return;
      }
      $("adminPassword").value = "";
      await applySession(res.data.session);
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "登入";
    }
  });

  $("logoutBtn").addEventListener("click", async function () {
    await client.auth.signOut();
    show(adminMessage, "已登出。", "info");
    await applySession(null);
  });

  // 先確認是否已經登入，再載入名單
  client.auth.getSession().then(function (res) {
    return applySession(res.data && res.data.session);
  }).catch(function () {
    return applySession(null);
  }).then(loadList);
})();
