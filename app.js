// 報修登記前端：新增報修、顯示最近 20 筆。
(function () {
  "use strict";

  var TABLE = "repair_requests";
  var LIST_LIMIT = 20;

  var form = document.getElementById("repairForm");
  var submitBtn = document.getElementById("submitBtn");
  var refreshBtn = document.getElementById("refreshBtn");
  var formMessage = document.getElementById("formMessage");
  var listMessage = document.getElementById("listMessage");
  var list = document.getElementById("requestList");
  var desc = document.getElementById("description");
  var descCount = document.getElementById("descCount");

  function show(el, text, kind) {
    el.textContent = text;
    el.className = "message" + (kind ? " " + kind : "");
  }

  desc.addEventListener("input", function () {
    descCount.textContent = String(desc.value.length);
  });

  // ---- 檢查設定 ----
  var cfg = window.APP_CONFIG || {};
  var url = (cfg.SUPABASE_URL || "").trim();
  var key = (cfg.SUPABASE_PUBLISHABLE_KEY || "").trim();
  var configError = "";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    configError = "無法載入 Supabase 程式庫，請檢查網路連線後重新整理。";
  } else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    configError = "config.js 的 Supabase 網址格式不正確。";
  } else if (/^sb_secret_/.test(key)) {
    // 防呆：secret 金鑰絕不能放在前端
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

  var client = window.supabase.createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 清單 ----
  var timeFmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function badge(text, cls) {
    var span = document.createElement("span");
    span.className = "badge" + (cls ? " " + cls : "");
    span.textContent = text;
    return span;
  }

  function renderItem(r) {
    // 一律用 textContent 放入資料，避免使用者輸入的內容被當成 HTML 執行
    var li = document.createElement("li");

    var top = document.createElement("div");
    top.className = "item-top";
    top.appendChild(badge(r.category));
    top.appendChild(badge("緊急：" + r.urgency, "urg-" + r.urgency));
    top.appendChild(badge(r.status, "status"));
    li.appendChild(top);

    var p = document.createElement("p");
    p.className = "item-desc";
    p.textContent = r.description;
    li.appendChild(p);

    var meta = document.createElement("div");
    meta.className = "item-meta";
    var when = r.created_at ? timeFmt.format(new Date(r.created_at)) : "";
    meta.textContent = r.reporter_name + " · " + r.location + (when ? " · " + when : "");
    li.appendChild(meta);

    return li;
  }

  async function loadList() {
    refreshBtn.disabled = true;
    show(listMessage, "載入中…", "info");
    try {
      var res = await client
        .from(TABLE)
        .select("id, created_at, reporter_name, location, category, description, urgency, status")
        // 排除羽球報名（badminton.js 把報名存在同一張表，地點固定為「羽球報名」）
        .neq("location", "羽球報名")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (res.error) throw res.error;

      list.replaceChildren();
      if (!res.data.length) {
        show(listMessage, "目前還沒有報修紀錄。", "info");
      } else {
        res.data.forEach(function (r) { list.appendChild(renderItem(r)); });
        show(listMessage, "", "");
      }
    } catch (err) {
      show(listMessage, "清單載入失敗：" + describeError(err), "err");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function describeError(err) {
    if (!err) return "未知錯誤";
    if (err.code === "23514") return "內容不符合規定（例如字數過長或選項不正確）。";
    if (err.code === "42501") return "沒有權限，請確認資料庫的權限與安全規則已設定。";
    if (err.code === "42P01" || err.code === "PGRST205") return "找不到資料表，請確認已執行 supabase/schema.sql。";
    return err.message || String(err);
  }

  // ---- 送出 ----
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var fd = new FormData(form);
    var row = {
      reporter_name: String(fd.get("reporter_name") || "").trim(),
      location: String(fd.get("location") || "").trim(),
      category: String(fd.get("category") || ""),
      description: String(fd.get("description") || "").trim(),
      urgency: String(fd.get("urgency") || "中"),
      // 不送 status：由資料庫預設為「待處理」
    };

    var missing = [];
    if (!row.reporter_name) missing.push("報修人");
    if (!row.location) missing.push("地點或部門");
    if (!row.category) missing.push("類別");
    if (!row.description) missing.push("問題說明");
    if (missing.length) {
      show(formMessage, "請填寫：" + missing.join("、"), "err");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    show(formMessage, "", "");
    try {
      // 不要求回傳新資料列，只需要 INSERT 權限
      var res = await client.from(TABLE).insert(row);
      if (res.error) throw res.error;

      show(formMessage, "已送出報修，謝謝！", "ok");
      form.reset();
      descCount.textContent = "0";
      loadList();
    } catch (err) {
      show(formMessage, "送出失敗：" + describeError(err), "err");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出報修";
    }
  });

  refreshBtn.addEventListener("click", loadList);
  loadList();
})();
