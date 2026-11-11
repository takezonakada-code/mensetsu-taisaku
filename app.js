(function () {
  "use strict";

  var DATA = window.INTERVIEW_DATA || { companies: [] };
  var STORE_KEY = "mensetsu-taisaku:v1";
  var app = document.getElementById("app");

  /* ---------- 保存 ---------- */
  var state = load();
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var s = JSON.parse(raw); if (s && s.answers) return s; }
    } catch (e) {}
    return { answers: {}, updatedAt: null };
  }
  function persist() {
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  function getAns(ck, qid) { return (state.answers[ck] && state.answers[ck][qid]) || ""; }
  function setAns(ck, qid, text) {
    if (!state.answers[ck]) state.answers[ck] = {};
    if (text && text.trim()) state.answers[ck][qid] = text; else delete state.answers[ck][qid];
    return persist();
  }

  /* ---------- データ ---------- */
  function company(key) { for (var i = 0; i < DATA.companies.length; i++) if (DATA.companies[i].key === key) return DATA.companies[i]; return null; }
  function allQs(co) {
    var out = [];
    co.items.forEach(function (it) { it.questions.forEach(function (q) { out.push({ item: it, q: q }); }); });
    return out;
  }
  function stats(co) {
    var all = allQs(co), done = 0, must = 0, mustDone = 0;
    all.forEach(function (x) {
      var a = !!getAns(co.key, x.q.id);
      if (a) done++;
      if (x.q.must) { must++; if (a) mustDone++; }
    });
    return { total: all.length, done: done, must: must, mustDone: mustDone };
  }
  function queue(co, mode) {
    var all = allQs(co);
    if (mode === "must") return all.filter(function (x) { return x.q.must; });
    if (mode === "rest") return all.filter(function (x) { return !getAns(co.key, x.q.id); });
    if (mode.indexOf("row-") === 0) { var r = +mode.slice(4); return all.filter(function (x) { return x.item.row === r; }); }
    return all;
  }

  /* ---------- 小物 ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>'
  };
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }
  function bar(title, sub, backHref) {
    return '<header class="bar">' +
      (backHref ? '<a class="icon-btn" href="' + backHref + '" aria-label="戻る">' + ICON.back + "</a>" : "") +
      "<h1>" + esc(title) + (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + "</h1></header>";
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  /* ---------- 画面：ホーム ---------- */
  function viewHome() {
    var html = bar("面接準備", "模擬面接までにシートのC列・D列を埋める") + "<main>";
    html += '<p class="lead">会社を選んで、質問に声か文字で答えてください。答えは自動でこの端末に保存されます。最後に「回答を送る」から左腕たけちゃんに渡すと、シートの形に整えて書き込みます。</p>';
    html += '<div class="list">';
    DATA.companies.forEach(function (co) {
      var s = stats(co);
      html += '<a class="card" href="#/c/' + co.key + '" style="text-decoration:none;color:inherit;display:block">' +
        '<div class="co-head"><span class="co-name">' + esc(co.name) + '</span><span class="co-pos">' + esc(co.position) + "</span></div>" +
        '<p class="co-tag">' + esc(co.tagline || "") + "</p>" +
        '<div class="meter"><i style="width:' + pct(s.done, s.total) + '%"></i></div>' +
        '<div class="meter-row"><span>必須 <b>' + s.mustDone + "</b> / " + s.must + "</span><span>全体 <b>" + s.done + "</b> / " + s.total + "</span></div></a>";
    });
    html += "</div>";
    html += '<div class="footer-actions"><a class="btn primary" href="#/send" style="text-decoration:none">' + ICON.send + "回答を送る</a></div>";
    html += "</main>";
    app.innerHTML = html;
  }

  /* ---------- 画面：会社 ---------- */
  function viewCompany(key) {
    var co = company(key); if (!co) return go("#/");
    var s = stats(co);
    var html = bar(co.name, co.position, "#/") + "<main>";

    html += '<details class="card points"><summary>この会社が見ているポイント' + ICON.chev + '</summary><div class="body">';
    if (co.lookFor && co.lookFor.length) {
      html += "<h3>面接で見ていること</h3><dl>";
      co.lookFor.forEach(function (p) { html += "<dt>" + esc(p.label) + "</dt><dd>" + esc(p.detail) + "</dd>"; });
      html += "</dl>";
    }
    [["求める人物像", co.persona], ["業務内容", co.work], ["内定事例・評価される人", co.cases], ["面接で使う言葉", co.keywords]].forEach(function (sec) {
      if (sec[1] && sec[1].length) {
        html += "<h3>" + sec[0] + "</h3><ul>" + sec[1].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      }
    });
    html += "</div></details>";

    var mustLeft = s.must - s.mustDone, restLeft = s.total - s.done;
    html += '<div class="stack">';
    if (mustLeft > 0) html += '<a class="btn primary" style="text-decoration:none" href="#/q/' + key + '/must/' + firstUnanswered(co, "must") + '">必須の質問から答える（残り ' + mustLeft + "）</a>";
    else if (restLeft > 0) html += '<a class="btn primary" style="text-decoration:none" href="#/q/' + key + '/rest/0">残りの質問に答える（' + restLeft + "）</a>";
    else html += '<a class="btn primary" style="text-decoration:none" href="#/send">' + ICON.send + "回答を送る</a>";
    html += "</div>";

    html += '<p class="section-label">シートの項目</p><div class="items">';
    co.items.forEach(function (it) {
      var n = it.questions.length, d = it.questions.filter(function (q) { return !!getAns(key, q.id); }).length;
      var cls = d === 0 ? "" : d === n ? "done" : "part";
      html += '<a class="item" style="text-decoration:none;color:inherit" href="#/q/' + key + "/row-" + it.row + '/0">' +
        '<span class="no">' + it.row + '</span><span class="ttl">' + esc(it.title) + '</span>' +
        '<span class="cnt"><span class="dot ' + cls + '"></span>' + d + "/" + n + "</span></a>";
    });
    html += "</div></main>";
    app.innerHTML = html;
  }
  function firstUnanswered(co, mode) {
    var q = queue(co, mode);
    for (var i = 0; i < q.length; i++) if (!getAns(co.key, q[i].q.id)) return i;
    return 0;
  }

  /* ---------- 画面：質問 ---------- */
  var rec = null;
  function viewQuestion(key, mode, idx) {
    var co = company(key); if (!co) return go("#/");
    var list = queue(co, mode);
    if (mode === "rest" && !list.length) list = [];
    if (!list.length || idx >= list.length) return viewFinished(co, mode);
    idx = Math.max(0, idx);
    var cur = list[idx], it = cur.item, q = cur.q;
    var colLabel = q.col === "D" ? "D列 深掘り" : "C列 回答";
    var modeLabel = mode === "must" ? "必須の質問" : mode === "rest" ? "残りの質問" : "項目 " + it.row;

    document.body.classList.add("q-screen");
    var html = bar(co.name + "｜" + modeLabel, (idx + 1) + " / " + list.length, "#/c/" + key);
    html += '<div class="q-progress"><i style="transform:scaleX(' + ((idx + 1) / list.length) + ')"></i></div><main>';
    html += '<p class="q-ctx"><b>' + it.row + "　" + esc(it.title) + "</b></p>";
    html += '<div class="badges"><span class="tag">' + colLabel + "</span>" + (q.must ? '<span class="tag must">必須</span>' : "") + "</div>";
    html += '<h2 class="q-text">' + esc(q.q) + "</h2>";
    if (it.intent) html += '<p class="intent">' + esc(it.intent) + "</p>";
    if (q.hint) html += '<details class="hint"><summary>答え方のヒント</summary><p>' + esc(q.hint) + "</p></details>";
    var others = othersForRow(key, it.row);
    if (others.length) {
      html += '<details class="hint"><summary>他社の同じ項目で答えた内容（' + others.length + "件）</summary>";
      others.forEach(function (o, i) {
        html += '<p><b>' + esc(o.co) + "｜" + esc(o.q) + "</b><br>" + esc(o.a) + '<br><button class="text-btn" data-reuse="' + i + '">この回答を下に追加</button></p>';
      });
      html += "</details>";
    }
    html += '<textarea class="answer" id="answer" placeholder="ここに入力、または下のマイクで話す" rows="6">' + esc(getAns(key, q.id)) + "</textarea>";
    html += '<div class="interim" id="interim" aria-live="polite"></div><div class="saved" id="saved"></div>';
    html += "</main>";

    var hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    html += '<div class="dock"><div class="dock-inner">' +
      '<button class="btn" id="prev"' + (idx === 0 ? " disabled" : "") + ">前へ</button>" +
      '<div class="mic-wrap"><button class="mic" id="mic" aria-label="音声で入力"' + (hasSR ? "" : " disabled") + ">" + ICON.mic + '</button><span class="mic-label" id="micLabel">' + (hasSR ? "話す" : "音声は非対応") + "</span></div>" +
      '<button class="btn primary" id="next">' + (idx === list.length - 1 ? "終える" : "次へ") + "</button>" +
      "</div></div>";
    app.innerHTML = html;

    var ta = document.getElementById("answer"), savedEl = document.getElementById("saved");
    autoGrow(ta);
    var saveTimer;
    function save() {
      var ok = setAns(key, q.id, ta.value);
      savedEl.textContent = ok ? "保存しました" : "保存できませんでした（プライベートブラウズでは保存されません）";
    }
    ta.addEventListener("input", function () { autoGrow(ta); clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); });

    function move(to) { stopRec(); save(); go("#/q/" + key + "/" + mode + "/" + to); }
    document.getElementById("prev").onclick = function () { move(idx - 1); };
    document.getElementById("next").onclick = function () { move(idx + 1); };

    Array.prototype.forEach.call(app.querySelectorAll("[data-reuse]"), function (b) {
      b.onclick = function () {
        var o = others[+b.getAttribute("data-reuse")];
        ta.value = ta.value ? ta.value.replace(/\s+$/, "") + "\n" + o.a : o.a;
        autoGrow(ta); save(); toast("追加しました");
      };
    });

    if (hasSR) setupMic(ta, save);
  }
  function othersForRow(key, row) {
    var out = [];
    DATA.companies.forEach(function (co) {
      if (co.key === key) return;
      co.items.forEach(function (it) {
        if (it.row !== row) return;
        it.questions.forEach(function (q) { var a = getAns(co.key, q.id); if (a) out.push({ co: co.name, q: q.q, a: a.trim() }); });
      });
    });
    return out;
  }
  function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = Math.max(200, ta.scrollHeight + 2) + "px"; }

  function setupMic(ta, save) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = document.getElementById("mic"), label = document.getElementById("micLabel"), interimEl = document.getElementById("interim");
    var wanted = false, base = "", sessionFinal = "";

    function joinText(a, b) { if (!a) return b; if (!b) return a; return /[\s\n]$/.test(a) ? a + b : a + "\n" + b; }
    function startSession() {
      var r = new SR();
      r.lang = "ja-JP"; r.continuous = true; r.interimResults = true;
      sessionFinal = "";
      r.onresult = function (e) {
        var fin = "", inter = "";
        for (var i = 0; i < e.results.length; i++) {
          var t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += t; else inter += t;
        }
        sessionFinal = fin;
        ta.value = joinText(base, sessionFinal);
        interimEl.textContent = inter;
        autoGrow(ta);
        save();
      };
      r.onerror = function (e) {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          wanted = false; toast("マイクの使用が許可されていません");
        }
      };
      r.onend = function () {
        base = joinText(base, sessionFinal); sessionFinal = "";
        interimEl.textContent = "";
        if (wanted) { try { rec = startSession(); } catch (err) { setOff(); } } else setOff();
      };
      r.start();
      return r;
    }
    function setOn() { btn.classList.add("on"); btn.innerHTML = ICON.stop; btn.setAttribute("aria-label", "音声入力を止める"); label.textContent = "聞いています"; ta.classList.add("listening"); }
    function setOff() { wanted = false; btn.classList.remove("on"); btn.innerHTML = ICON.mic; btn.setAttribute("aria-label", "音声で入力"); label.textContent = "話す"; ta.classList.remove("listening"); interimEl.textContent = ""; rec = null; save(); }

    btn.onclick = function () {
      if (wanted) { wanted = false; if (rec) rec.stop(); else setOff(); return; }
      ta.blur();
      base = ta.value; wanted = true;
      try { rec = startSession(); setOn(); } catch (err) { setOff(); toast("音声入力を開始できませんでした"); }
    };
  }
  function stopRec() { if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} rec = null; } }

  function viewFinished(co, mode) {
    document.body.classList.remove("q-screen");
    var s = stats(co);
    var html = bar(co.name, co.position, "#/c/" + co.key) + "<main>";
    html += '<div class="done-box"><h2>' + (mode === "must" ? "必須の質問はここまでです" : "この範囲の質問はここまでです") + "</h2>" +
      "<p>必須 " + s.mustDone + " / " + s.must + "　全体 " + s.done + " / " + s.total + "</p></div>";
    html += '<div class="stack">';
    if (s.done < s.total) html += '<a class="btn primary" style="text-decoration:none" href="#/q/' + co.key + '/rest/0">残りの質問に答える（' + (s.total - s.done) + "）</a>";
    html += '<a class="btn" style="text-decoration:none" href="#/send">' + ICON.send + "回答を送る</a>";
    html += '<a class="btn" style="text-decoration:none" href="#/">会社の一覧へ</a></div></main>';
    app.innerHTML = html;
  }

  /* ---------- 画面：送る ---------- */
  var sendSel = "all";
  function buildText(sel) {
    var lines = [];
    var d = new Date();
    lines.push("【面接シート回答】" + d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate() + " " + d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"));
    lines.push("※左腕たけちゃんへ：この回答を元に、各社タブのC列（回答①）とD列（深掘り）を書いてください");
    DATA.companies.forEach(function (co) {
      if (sel !== "all" && sel !== co.key) return;
      var any = false, block = [];
      block.push(""); block.push("■ " + co.name + "（" + co.position + "）");
      co.items.forEach(function (it) {
        var qs = it.questions.filter(function (q) { return !!getAns(co.key, q.id); });
        if (!qs.length) return;
        any = true;
        block.push(""); block.push("▼ 行" + it.row + " " + it.title);
        qs.forEach(function (q) {
          block.push("[" + q.col + "列] Q. " + q.q);
          block.push("A. " + getAns(co.key, q.id).trim());
        });
      });
      if (any) lines = lines.concat(block);
    });
    return lines.join("\n");
  }
  function countAnswered(sel) {
    var n = 0;
    DATA.companies.forEach(function (co) { if (sel === "all" || sel === co.key) n += stats(co).done; });
    return n;
  }
  function viewSend() {
    document.body.classList.remove("q-screen");
    var html = bar("回答を送る", "コピーか共有で、左腕たけちゃんとのチャットに貼る", "#/") + "<main>";
    html += '<div class="seg" role="group" aria-label="送る範囲">';
    html += '<button data-sel="all" aria-pressed="' + (sendSel === "all") + '">すべて</button>';
    DATA.companies.forEach(function (co) { html += '<button data-sel="' + co.key + '" aria-pressed="' + (sendSel === co.key) + '">' + esc(co.name) + "</button>"; });
    html += "</div>";
    var n = countAnswered(sendSel);
    if (!n) html += '<p class="empty">まだ回答がありません</p>';
    else html += '<div class="preview" id="preview">' + esc(buildText(sendSel)) + "</div>";
    html += '<div class="stack">' +
      '<button class="btn primary" id="copy"' + (n ? "" : " disabled") + ">" + ICON.copy + "コピーする（" + n + "件）</button>" +
      (navigator.share ? '<button class="btn" id="share"' + (n ? "" : " disabled") + ">" + ICON.send + "共有する</button>" : "") +
      '<button class="btn" id="dl"' + (n ? "" : " disabled") + ">" + ICON.file + "ファイルに保存</button></div>";
    html += '<p class="note">回答はこの端末のブラウザにだけ保存されていて、どこにも送信されません。別の端末に移すときは、保存したファイルを「回答を読み込む」で開いてください。</p>';
    html += '<button class="text-btn" id="import">回答を読み込む</button><input type="file" id="importFile" accept=".json,application/json" hidden>';
    html += "</main>";
    app.innerHTML = html;

    Array.prototype.forEach.call(app.querySelectorAll(".seg button"), function (b) {
      b.onclick = function () { sendSel = b.getAttribute("data-sel"); viewSend(); };
    });
    var txt = function () { return buildText(sendSel); };
    var c = document.getElementById("copy");
    if (c) c.onclick = function () { copyText(txt()); };
    var sh = document.getElementById("share");
    if (sh) sh.onclick = function () { navigator.share({ text: txt() }).catch(function () {}); };
    document.getElementById("dl").onclick = function () {
      var payload = { app: "mensetsu-taisaku", version: 1, exportedAt: new Date().toISOString(), answers: state.answers, text: buildText("all") };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "mensetsu-answers-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    var fi = document.getElementById("importFile");
    document.getElementById("import").onclick = function () { fi.click(); };
    fi.onchange = function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var p = JSON.parse(rd.result);
          if (!p.answers) throw new Error();
          Object.keys(p.answers).forEach(function (ck) {
            if (!state.answers[ck]) state.answers[ck] = {};
            Object.keys(p.answers[ck]).forEach(function (qid) { if (!state.answers[ck][qid]) state.answers[ck][qid] = p.answers[ck][qid]; });
          });
          persist(); toast("読み込みました"); viewSend();
        } catch (e) { toast("このファイルは読み込めません"); }
      };
      rd.readAsText(f);
    };
  }
  function copyText(t) {
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      ta.remove(); toast(ok ? "コピーしました" : "コピーできませんでした");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast("コピーしました"); }, fallback);
    else fallback();
  }

  /* ---------- ルーター ---------- */
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function route() {
    stopRec();
    document.body.classList.remove("q-screen");
    var p = (location.hash || "#/").slice(2).split("/");
    if (p[0] === "c" && p[1]) viewCompany(p[1]);
    else if (p[0] === "q" && p[1]) viewQuestion(p[1], p[2] || "all", parseInt(p[3] || "0", 10) || 0);
    else if (p[0] === "send") viewSend();
    else viewHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();
})();
