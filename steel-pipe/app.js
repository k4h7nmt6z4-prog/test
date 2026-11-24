// 鐵管計算：圓管、方管、矩形管的每米重、單支重、總重與總價。
// 純前端計算，資料只存在這台裝置（localStorage），不連線任何伺服器。
(function () {
  "use strict";

  var STORE_KEY = "steel-pipe-calc-v1";
  var $ = function (id) { return document.getElementById(id); };

  // 常用尺寸（公釐）。圓管為 JIS 配管外徑；方管、矩形管為常見規格。
  var PRESETS = {
    round: [
      ["4 分（1/2 吋）21.7", 21.7], ["6 分（3/4 吋）27.2", 27.2], ["1 吋 34.0", 34.0],
      ["1¼ 吋 42.7", 42.7], ["1½ 吋 48.6", 48.6], ["2 吋 60.5", 60.5],
      ["2½ 吋 76.3", 76.3], ["3 吋 89.1", 89.1], ["4 吋 114.3", 114.3],
      ["5 吋 139.8", 139.8], ["6 吋 165.2", 165.2],
    ],
    square: [
      ["19 × 19", [19, 19]], ["25 × 25", [25, 25]], ["30 × 30", [30, 30]], ["38 × 38", [38, 38]],
      ["40 × 40", [40, 40]], ["50 × 50", [50, 50]], ["60 × 60", [60, 60]], ["75 × 75", [75, 75]],
      ["100 × 100", [100, 100]], ["125 × 125", [125, 125]], ["150 × 150", [150, 150]],
    ],
    rect: [
      ["40 × 20", [40, 20]], ["50 × 25", [50, 25]], ["60 × 30", [60, 30]], ["75 × 45", [75, 45]],
      ["100 × 50", [100, 50]], ["125 × 75", [125, 75]], ["150 × 50", [150, 50]], ["150 × 100", [150, 100]],
      ["200 × 100", [200, 100]],
    ],
  };
  var SHAPE_NAME = { round: "圓管", square: "方管", rect: "矩形管" };

  var state = load();

  function newItem() {
    return { shape: "round", d: "48.6", h: "", t: "2.3", len: "6", pcs: "1" };
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.items) && s.items.length) return s;
    } catch (e) { /* 讀不到就用預設值 */ }
    return { material: "7.85", price: "", items: [newItem()] };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 存不了也能計算 */ }
  }

  // ---- 計算 ----
  function num(v) {
    var n = parseFloat(String(v).replace(/,/g, ""));
    return isFinite(n) ? n : NaN;
  }
  // 每米重（公斤／公尺）；資料不完整或不合理時回傳錯誤訊息
  function kgPerMeter(it, rho) {
    var d = num(it.d), h = it.shape === "rect" ? num(it.h) : d, t = num(it.t);
    if (!(d > 0) || !(t > 0) || !(h > 0)) return { err: "" };
    if (it.shape === "round") {
      if (t * 2 >= d) return { err: "厚度必須小於外徑的一半。" };
      return { v: Math.PI * t * (d - t) * rho / 1000 };
    }
    if (t * 2 >= Math.min(d, h)) return { err: "厚度必須小於邊長的一半。" };
    return { v: (2 * t * (d + h) - 4 * t * t) * rho / 1000 };
  }

  var f2 = new Intl.NumberFormat("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var f3 = new Intl.NumberFormat("zh-TW", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  var f0 = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
  var f1 = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 });

  function sizeText(it) {
    if (it.shape === "round") return "Ø" + it.d + " × " + it.t + "t";
    var h = it.shape === "rect" ? it.h : it.d;
    return it.d + " × " + h + " × " + it.t + "t";
  }

  // ---- 畫面 ----
  var itemsBox = $("items");
  var tpl = $("itemTpl");

  function renderAll() {
    $("material").value = state.material;
    $("price").value = state.price;
    itemsBox.replaceChildren();
    state.items.forEach(function (it, idx) { itemsBox.appendChild(buildItem(it, idx)); });
    recalc();
  }

  function buildItem(it, idx) {
    var el = tpl.content.firstElementChild.cloneNode(true);
    var q = function (sel) { return el.querySelector(sel); };
    q(".item-title").textContent = "規格 " + (idx + 1);

    function applyShapeUI() {
      el.querySelectorAll(".shape button").forEach(function (b) {
        var on = b.dataset.shape === it.shape;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      q(".lbl-d").textContent = it.shape === "round" ? "外徑（mm）" : (it.shape === "square" ? "邊長（mm）" : "寬（mm）");
      q(".f-h").hidden = it.shape !== "rect";
      // 常用尺寸選單
      var sel = q(".preset");
      sel.replaceChildren();
      var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "自行輸入"; sel.appendChild(o0);
      PRESETS[it.shape].forEach(function (p, i) {
        var o = document.createElement("option"); o.value = String(i); o.textContent = p[0]; sel.appendChild(o);
      });
      sel.value = matchPreset(it);
    }
    function matchPreset(x) {
      var list = PRESETS[x.shape];
      for (var i = 0; i < list.length; i++) {
        var v = list[i][1];
        if (x.shape === "round" ? num(x.d) === v
          : num(x.d) === v[0] && (x.shape === "square" || num(x.h) === v[1])) return String(i);
      }
      return "";
    }

    el.querySelectorAll(".shape button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (it.shape === b.dataset.shape) return;
        it.shape = b.dataset.shape;
        var p = PRESETS[it.shape][it.shape === "round" ? 4 : 5] || PRESETS[it.shape][0];
        if (it.shape === "round") { it.d = String(p[1]); it.h = ""; }
        else { it.d = String(p[1][0]); it.h = it.shape === "rect" ? String(p[1][1]) : ""; }
        fill(); applyShapeUI(); save(); recalc();
      });
    });

    q(".preset").addEventListener("change", function (e) {
      if (e.target.value === "") return;
      var p = PRESETS[it.shape][+e.target.value][1];
      if (it.shape === "round") it.d = String(p);
      else { it.d = String(p[0]); it.h = it.shape === "rect" ? String(p[1]) : ""; }
      fill(); save(); recalc();
    });

    [["in-d", "d"], ["in-h", "h"], ["in-t", "t"], ["in-len", "len"], ["in-pcs", "pcs"]].forEach(function (m) {
      q("." + m[0]).addEventListener("input", function (e) {
        it[m[1]] = e.target.value;
        if (m[1] === "d" || m[1] === "h") q(".preset").value = matchPreset(it);
        save(); recalc();
      });
    });

    q(".del").addEventListener("click", function () {
      if (state.items.length === 1) { state.items[0] = newItem(); }
      else { state.items.splice(state.items.indexOf(it), 1); }
      save(); renderAll();
    });

    function fill() {
      q(".in-d").value = it.d; q(".in-h").value = it.h; q(".in-t").value = it.t;
      q(".in-len").value = it.len; q(".in-pcs").value = it.pcs;
    }
    fill(); applyShapeUI();
    el._item = it;
    return el;
  }

  var lastTotals = null;
  function recalc() {
    var rho = num(state.material) || 7.85;
    var price = num(state.price);
    var hasPrice = price >= 0 && state.price !== "";
    var tPcs = 0, tLen = 0, tKg = 0, allOk = true;

    itemsBox.querySelectorAll(".item").forEach(function (el) {
      var it = el._item;
      var q = function (sel) { return el.querySelector(sel); };
      var r = kgPerMeter(it, rho);
      var len = num(it.len), pcs = num(it.pcs);
      var err = q(".item-err");
      var lenErr = !(len > 0) && it.len !== "" ? "長度要大於 0。" : "";
      var pcsErr = !(Number.isInteger(pcs) && pcs >= 0) && it.pcs !== "" ? "支數請輸入整數。" : "";
      var msg = r.err || lenErr || pcsErr;
      err.textContent = msg; err.hidden = !msg;

      if (r.v === undefined || !(len > 0) || !(Number.isInteger(pcs) && pcs >= 0)) {
        q(".r-kgm").textContent = r.v === undefined ? "–" : f3.format(r.v) + " kg/m";
        q(".r-pc").textContent = q(".r-kg").textContent = q(".r-price").textContent = "–";
        allOk = false;
        return;
      }
      var pc = r.v * len, kg = pc * pcs;
      q(".r-kgm").textContent = f3.format(r.v) + " kg/m";
      q(".r-pc").textContent = f2.format(pc) + " kg";
      q(".r-kg").textContent = f2.format(kg) + " kg";
      q(".r-price").textContent = hasPrice ? f0.format(Math.round(kg * price)) + " 元" : "請填單價";
      tPcs += pcs; tLen += len * pcs; tKg += kg;
    });

    $("totalPcs").textContent = f0.format(tPcs) + " 支";
    $("totalLen").textContent = f1.format(tLen) + " 公尺";
    $("totalKg").textContent = f2.format(tKg) + " 公斤";
    $("totalPrice").textContent = hasPrice ? f0.format(Math.round(tKg * price)) + " 元" : "請先填單價";
    lastTotals = { pcs: tPcs, len: tLen, kg: tKg, price: hasPrice ? price : null, rho: rho, ok: allOk };
  }

  // ---- 共用設定 ----
  $("material").addEventListener("change", function (e) { state.material = e.target.value; save(); recalc(); });
  $("price").addEventListener("input", function (e) { state.price = e.target.value; save(); recalc(); });

  $("addBtn").addEventListener("click", function () {
    var last = state.items[state.items.length - 1];
    // 新規格沿用上一個的形狀、厚度與長度，比較好填
    var it = newItem();
    if (last) { it.shape = last.shape; it.d = last.d; it.h = last.h; it.t = last.t; it.len = last.len; }
    state.items.push(it);
    save(); renderAll();
    var cards = itemsBox.querySelectorAll(".item");
    cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // 全部清除：按兩次確認（不用跳出視窗）
  var clearBtn = $("clearBtn"), clearTimer = null;
  clearBtn.addEventListener("click", function () {
    if (clearBtn.dataset.armed !== "1") {
      clearBtn.dataset.armed = "1"; clearBtn.textContent = "確定全部清除？";
      clearBtn.classList.add("armed");
      clearTimer = setTimeout(function () {
        clearBtn.dataset.armed = ""; clearBtn.textContent = "全部清除"; clearBtn.classList.remove("armed");
      }, 4000);
      return;
    }
    clearTimeout(clearTimer);
    clearBtn.dataset.armed = ""; clearBtn.textContent = "全部清除"; clearBtn.classList.remove("armed");
    state = { material: state.material, price: state.price, items: [newItem()] };
    save(); renderAll();
    showMsg("已清除所有規格。");
  });

  // 複製結果：可以貼到 LINE
  $("copyBtn").addEventListener("click", async function () {
    recalc();
    var rho = num(state.material) || 7.85, price = num(state.price), hasPrice = state.price !== "" && price >= 0;
    var matName = $("material").selectedOptions[0].textContent;
    var lines = ["【鐵管計算】", "材質：" + matName + (hasPrice ? "　單價：" + f1.format(price) + " 元/kg" : "")];
    state.items.forEach(function (it, i) {
      var r = kgPerMeter(it, rho), len = num(it.len), pcs = num(it.pcs);
      if (r.v === undefined || !(len > 0) || !(pcs >= 0)) return;
      var kg = r.v * len * pcs;
      lines.push((i + 1) + ". " + SHAPE_NAME[it.shape] + " " + sizeText(it) + "　" + f1.format(len) + "m × " + pcs + " 支　" +
        f2.format(kg) + " kg" + (hasPrice ? "　" + f0.format(Math.round(kg * price)) + " 元" : ""));
    });
    lines.push("合計：" + f0.format(lastTotals.pcs) + " 支、" + f2.format(lastTotals.kg) + " 公斤" +
      (hasPrice ? "、" + f0.format(Math.round(lastTotals.kg * price)) + " 元" : ""));
    var text = lines.join("\n");
    var ok = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { /* 改用備用方法 */ }
    if (!ok) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
    }
    showMsg(ok ? "已複製，可以貼到 LINE。" : "無法自動複製，請手動截圖。", !ok);
  });

  function showMsg(text, isErr) {
    var m = $("msg");
    m.textContent = text;
    m.className = "msg" + (isErr ? " err" : " ok");
  }

  renderAll();
})();
