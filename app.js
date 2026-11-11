(function () {
  "use strict";

  var DATA = window.INTERVIEW_DATA || { companies: [] };
  var STORE_KEY = "mensetsu-taisaku:v1";
  var CONN_KEY = "mensetsu-taisaku:conn";
  var app = document.getElementById("app");

  /* ---------- 保存 ---------- */
  var state = load();
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var s = JSON.parse(raw); if (s && s.answers) { s.synced = s.synced || {}; return s; } }
    } catch (e) {}
    return { answers: {}, synced: {}, updatedAt: null };
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
  function cellKey(ck, row, col) { return ck + ":" + col + row; }
  function isConfirmed(ck, qid) {
    var a = getAns(ck, qid);
    return !!a && !!state.confirmed && !!state.confirmed[ck] && state.confirmed[ck][qid] === a;
  }
  function setConfirmed(ck, qid) {
    if (!state.confirmed) state.confirmed = {};
    if (!state.confirmed[ck]) state.confirmed[ck] = {};
    state.confirmed[ck][qid] = getAns(ck, qid);
    persist();
  }
  var editing = {};

  var conn = loadConn();

  /* ---------- AI：その人のOpenAI APIキー（この端末にだけ保存）→ なければシート側のClaude ---------- */
  var OA_KEY = "mensetsu-taisaku:openai";
  var OA_DEFAULT_MODEL = "gpt-5.6-sol";
  function loadOa() { try { return JSON.parse(localStorage.getItem(OA_KEY) || "null"); } catch (e) { return null; } }
  function saveOa(v) { try { if (v) localStorage.setItem(OA_KEY, JSON.stringify(v)); else localStorage.removeItem(OA_KEY); } catch (e) {} }
  function aiReady() { var o = loadOa(); return !!(o && o.key) || !!conn; }

  function polishPrompt(p) {
    var co = p.co, lines = [];
    lines.push("あなたは転職の面接対策のコーチです。候補者が声で話した回答を、面接でそのまま話せる文章に整えます。");
    lines.push("");
    lines.push("# 受ける会社：" + co.name + "（" + co.position + "）");
    if (co.tagline) lines.push(co.tagline);
    if (co.lookFor && co.lookFor.length) { lines.push("", "## 面接で見ているポイント"); co.lookFor.forEach(function (x) { lines.push("- " + x.label + "：" + x.detail); }); }
    [["求める人物像", co.persona], ["業務内容", co.work], ["内定事例・評価される人", co.cases], ["会社の言葉", co.keywords]].forEach(function (s) {
      if (s[1] && s[1].length) { lines.push("", "## " + s[0]); s[1].forEach(function (x) { lines.push("- " + x); }); }
    });
    lines.push("", "# 整え方",
      "- 候補者が話した事実だけを使う。経験・数字・固有名詞を足したり盛ったりしない。足りない要素があれば、文章の最後に【足すと良いこと】として短く挙げる",
      "- 話した具体的な場面・言葉・細部は削らずに残す。話が前後したり言い直したりしていても、文脈をつないで一本の筋の通った答えにする。音声の誤変換は文脈から正しい言葉に直す",
      "- 答えは「質問」とシートの「項目」に対する答えになっていること",
      "- 上の「求める人物像」「面接で見ているポイント」に沿うよう、どの事実を前に出すか・どう言葉にするかを選ぶ",
      "- 結論から話す。です・ます調の話し言葉で、声に出して自然な長さにする",
      "- 数字は、何と比べてどうか（何人中・平均と比べて）が伝わる形にする。比較がなければ【足すと良いこと】に回す",
      "- 経験 → そう思った理由（感情）→ これからどうしたいか、がつながるようにする",
      "- 出力は整えた文章と【足すと良いこと】だけ。前置きや解説は書かない");
    var user = "面接シートの項目：" + p.itemTitle + "\n質問：" + p.question + "\n" +
      (p.context ? "この項目ですでに答えている結論：" + p.context + "\n" : "") +
      (p.col === "C" ? "この答えはシートのC列（結論）に入ります。2〜3文で、聞かれたことに一言で答える形にしてください。"
                     : "この答えはシートのD列（深掘り）に入ります。場面 → 自分の行動 → 結果 → 学び の流れで、面接官に深掘られた時にそのまま話せる形にしてください。") +
      "\n\n候補者が話した内容（音声の文字起こし。誤変換を含む）：\n" + p.text;
    return { system: lines.join("\n"), user: user };
  }
  function callOpenAI(o, system, user) {
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + o.key },
      body: JSON.stringify({ model: o.model || OA_DEFAULT_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }] })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) { var e = new Error((b.error && b.error.code) || ("http-" + r.status)); e.status = r.status; e.detail = b.error && b.error.message; throw e; }
        var t = b.choices && b.choices[0] && b.choices[0].message && b.choices[0].message.content;
        if (!t) throw new Error("empty");
        return String(t).trim();
      });
    });
  }
  function polishText(p) {
    var o = loadOa();
    if (o && o.key) { var pr = polishPrompt(p); return callOpenAI(o, pr.system, pr.user); }
    return fetch(conn.url, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: conn.token, action: "polish", company: p.co.key, row: p.row, col: p.col, itemTitle: p.itemTitle, question: p.question, context: p.context, text: p.text })
    }).then(function (r) { return r.json(); }).then(function (res) { if (!res.ok) throw new Error(res.error || "failed"); return res.text; });
  }
  function aiErrorText(m, detail) {
    if (m === "no-key") return "シート側のAIのキーがまだ設定されていません";
    if (m === "invalid_api_key" || m === "http-401") return "OpenAIのAPIキーが正しくありません。コピーが途中で切れていないか確認して、入れ直してください";
    if (m === "insufficient_quota" || /credit|billing|quota/i.test(detail || "")) return "OpenAIのAPIの残高がありません。platform.openai.com の Billing で支払い方法とクレジットを入れてください（ChatGPTの月額プランとは別です）";
    if (m === "http-429" || m === "rate_limit_exceeded") return "OpenAIが混み合っています。少し待ってからもう一度押してください";
    if (m === "model_not_found" || m === "http-404" || (m === "http-400" && /model/i.test(detail || ""))) return "選んだモデルがこのアカウントでは使えません。モデルを別のものに変えて、もう一度試してください";
    if (m === "Load failed" || m === "Failed to fetch" || m === "NetworkError when attempting to fetch resource.") return "OpenAIにつながりませんでした。電波を確認するか、LINEの中ではなくSafariやChromeでこのページを開いて試してください";
    return "整えられませんでした" + (detail ? "（" + detail + "）" : "") + "。もう一度押してください";
  }
  var OA_MODELS = [
    ["gpt-5.6-sol", "GPT-5.6 Sol（いちばん賢い・おすすめ）"],
    ["gpt-5.6-terra", "GPT-5.6 Terra（バランス）"],
    ["gpt-5.6-luna", "GPT-5.6 Luna（速くて安い）"],
    ["gpt-5.1", "GPT-5.1（上が使えない時）"],
    ["gpt-4.1", "GPT-4.1（上が使えない時）"]
  ];

  /* ---------- 画面：設定（OpenAI APIキー） ---------- */
  function viewSettings() {
    var o = loadOa() || {};
    var html = bar("AIの設定", "", "#/") + "<main>";
    html += '<p class="lead">自分のOpenAIアカウントのAPIキーを入れると、この端末の「AIが面接用に整えた文章」が自分のGPTで動きます。キーはこの端末のブラウザにだけ保存され、サイトやほかの人には送られません。利用料は自分のOpenAIアカウントに請求されます。</p>';
    html += '<label class="field"><span>OpenAIのAPIキー</span><input id="oaKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-で始まるキー" value="' + esc(o.key || "") + '"></label>';
    var curModel = o.model || OA_DEFAULT_MODEL;
    var known = OA_MODELS.some(function (x) { return x[0] === curModel; });
    html += '<label class="field"><span>モデル</span><select id="oaModel">' +
      OA_MODELS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === curModel ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("") +
      (known ? "" : '<option value="' + esc(curModel) + '" selected>' + esc(curModel) + "</option>") +
      "</select></label>";
    html += '<div class="stack"><button class="btn primary" id="oaSave">保存して確かめる</button>' +
      (o.key ? '<button class="btn" id="oaDel">キーを削除する</button>' : "") + "</div>";
    html += '<p class="note" id="oaMsg">' + (o.key ? "キーが入っています" : "") + "</p>";
    html += '<p class="note">APIキーは platform.openai.com の「API keys」で作れます。ChatGPTの月額プランとは別に、API用の支払い設定が必要です。共用の端末では入れないでください。</p>';
    html += "</main>";
    app.innerHTML = html;
    var msg = document.getElementById("oaMsg");
    document.getElementById("oaSave").onclick = function () {
      var k = document.getElementById("oaKey").value.trim(), m = document.getElementById("oaModel").value.trim() || OA_DEFAULT_MODEL;
      if (!k) { msg.textContent = "キーを入れてください"; return; }
      var b = this; b.disabled = true; b.textContent = "確かめています";
      callOpenAI({ key: k, model: m }, "短く答えてください。", "「OK」とだけ返してください。").then(function () {
        saveOa({ key: k, model: m }); msg.textContent = "つながりました。AIの欄が自分のGPTで動きます"; msg.className = "note ok";
      }, function (err) {
        msg.textContent = aiErrorText(String(err.message || ""), err.detail); msg.className = "note err";
      }).then(function () { b.disabled = false; b.textContent = "保存して確かめる"; });
    };
    var d = document.getElementById("oaDel");
    if (d) d.onclick = function () { saveOa(null); viewSettings(); toast("キーを削除しました"); };
  }
  function loadConn() { try { return JSON.parse(localStorage.getItem(CONN_KEY) || "null"); } catch (e) { return null; } }
  function saveConn(c) { conn = c; try { localStorage.setItem(CONN_KEY, JSON.stringify(c)); } catch (e) {} }

  /* ---------- データ ---------- */
  function company(key) { for (var i = 0; i < DATA.companies.length; i++) if (DATA.companies[i].key === key) return DATA.companies[i]; return null; }
  function baseQs(co) { var o = []; co.items.forEach(function (it) { it.questions.forEach(function (q) { o.push({ item: it, q: q, drill: false }); }); }); return o; }
  function drillQs(co) { var o = []; co.items.forEach(function (it) { (it.drill || []).forEach(function (q) { o.push({ item: it, q: q, drill: true }); }); }); return o; }
  function stats(co) {
    var b = baseQs(co), d = drillQs(co), s = { total: b.length + d.length, done: 0, must: 0, mustDone: 0, core: 0, coreDone: 0 };
    b.concat(d).forEach(function (x) {
      var a = !!getAns(co.key, x.q.id);
      if (a) s.done++;
      if (!x.drill && x.q.must) { s.must++; if (a) s.mustDone++; }
      if (x.drill && x.q.core) { s.core++; if (a) s.coreDone++; }
    });
    return s;
  }
  function queue(co, mode) {
    if (mode === "must") return baseQs(co).filter(function (x) { return x.q.must; });
    if (mode === "core") return drillQs(co).filter(function (x) { return x.q.core; });
    if (mode === "rest") return baseQs(co).concat(drillQs(co)).filter(function (x) { return !getAns(co.key, x.q.id); });
    if (mode.indexOf("row-") === 0) {
      var r = +mode.slice(4);
      return baseQs(co).filter(function (x) { return x.item.row === r; }).concat(drillQs(co).filter(function (x) { return x.item.row === r; }));
    }
    return baseQs(co).concat(drillQs(co));
  }
  function colOf(x) { return x.drill ? "D" : x.q.col; }

  /* ---------- シートのセルの中身を組み立てる ---------- */
  function cellText(co, row, col) {
    var it = null; co.items.forEach(function (i) { if (i.row === row) it = i; });
    if (!it) return "";
    var parts = [];
    var list = it.questions.map(function (q) { return { q: q, drill: false }; }).concat((it.drill || []).map(function (q) { return { q: q, drill: true }; }));
    list.forEach(function (x) {
      var c = x.drill ? "D" : x.q.col;
      if (c !== col) return;
      var a = getAns(co.key, x.q.id).trim();
      if (!a) return;
      if (col === "C") parts.push(a);
      else parts.push((x.drill ? "【深掘り】" : "") + "Q. " + x.q.q + "\n" + a);
    });
    return parts.join(col === "C" ? "\n" : "\n\n");
  }
  function isSynced(co, row, col) { return state.synced[cellKey(co.key, row, col)] === cellText(co, row, col); }

  function pushCells(cells) {
    if (!conn || !conn.url) return Promise.reject(new Error("no-conn"));
    return fetch(conn.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: conn.token, cells: cells })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.error || "failed");
      cells.forEach(function (c) { state.synced[cellKey(c.company, c.row, c.col)] = c.text; });
      persist();
      return res;
    });
  }
  function pushCell(co, row, col) {
    return pushCells([{ company: co.key, row: row, col: col, text: cellText(co, row, col) }]);
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
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/></svg>'
  };
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }
  function bar(title, sub, backHref, right) {
    return '<header class="bar">' +
      (backHref ? '<a class="icon-btn" href="' + backHref + '" aria-label="戻る">' + ICON.back + "</a>" : "") +
      "<h1>" + esc(title) + (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + "</h1>" + (right || "") + "</header>";
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function fmtSec(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  /* ---------- 画面：ホーム ---------- */
  function viewHome() {
    var html = bar("面接準備", "模擬面接までにシートのC列・D列を埋める", "", '<a class="skip" href="#/settings">AIの設定</a>') + "<main>";
    html += '<p class="lead">会社を選び、質問に声か文字で答えてください。話し終えると、AIがその会社の求める人物像に沿って面接用の文章に整えます。答えはこの端末に保存されます。</p>';
    if (!aiReady()) html += '<p class="warn">AIで整えるには、右上の「AIの設定」でOpenAIのAPIキーを入れてください。</p>';
    html += '<div class="list">';
    DATA.companies.forEach(function (co) {
      var s = stats(co);
      html += '<a class="card" href="#/c/' + co.key + '">' +
        '<div class="co-head"><span class="co-name">' + esc(co.name) + '</span><span class="co-pos">' + esc(co.position) + "</span></div>" +
        '<p class="co-tag">' + esc(co.tagline || "") + "</p>" +
        '<div class="meter"><i style="width:' + pct(s.done, s.total) + '%"></i></div>' +
        '<div class="meter-row"><span>必須 <b>' + s.mustDone + "</b> / " + s.must + "</span><span>深掘り <b>" + s.coreDone + "</b> / " + s.core + "</span><span>全体 <b>" + s.done + "</b> / " + s.total + "</span></div></a>";
    });
    html += "</div>";
    html += '<div class="footer-actions"><a class="btn" href="#/send">' + ICON.send + "回答をまとめてコピー</a></div>";
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
      if (sec[1] && sec[1].length) html += "<h3>" + sec[0] + "</h3><ul>" + sec[1].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    });
    html += "</div></details>";

    var mustLeft = s.must - s.mustDone, coreLeft = s.core - s.coreDone;
    html += '<div class="stack">';
    html += '<a class="btn primary" href="#/q/' + key + "/must/" + firstUnanswered(co, "must") + '">' + (mustLeft > 0 ? "必須の質問に答える（残り " + mustLeft + "）" : "必須の質問を見直す") + "</a>";
    if (s.core) html += '<a class="btn" href="#/q/' + key + "/core/" + firstUnanswered(co, "core") + '">' + (coreLeft > 0 ? "深掘りを練習する（残り " + coreLeft + "）" : "深掘りをもう一度練習する") + "</a>";
    html += "</div>";

    html += '<p class="section-label">シートの項目</p><div class="items">';
    co.items.forEach(function (it) {
      var all = it.questions.concat(it.drill || []);
      var n = all.length, d = all.filter(function (q) { return !!getAns(key, q.id); }).length;
      var cls = d === 0 ? "" : d === n ? "done" : "part";
      var syncC = cellText(co, it.row, "C") || cellText(co, it.row, "D");
      var synced = syncC && isSynced(co, it.row, "C") && isSynced(co, it.row, "D");
      html += '<a class="item" href="#/q/' + key + "/row-" + it.row + "/" + firstUnanswered(co, "row-" + it.row) + '">' +
        '<span class="no">' + it.row + '</span><span class="ttl">' + esc(it.title) + (synced ? '<span class="sync-note">シートに反映済み</span>' : "") + "</span>" +
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
    if (!list.length || idx >= list.length) return viewFinished(co, mode);
    idx = Math.max(0, idx);
    var cur = list[idx], it = cur.item, q = cur.q, col = colOf(cur);
    var modeLabel = mode === "must" ? "必須の質問" : mode === "core" ? "深掘り練習" : mode === "rest" ? "残りの質問" : "項目 " + it.row;
    var cellCol = col === "D" ? "D列（深掘り）" : "C列（回答）";

    document.body.classList.add("q-screen");
    var skip = '<button class="skip" id="skip">' + (idx === list.length - 1 ? "終える" : "飛ばす") + "</button>";
    var html = bar(co.name + "｜" + modeLabel, (idx + 1) + " / " + list.length, "#/c/" + key, skip);
    html += '<div class="q-progress"><i style="transform:scaleX(' + ((idx + 1) / list.length) + ')"></i></div><main>';
    html += '<p class="q-ctx"><b>' + it.row + "　" + esc(it.title) + "</b>　→ " + cellCol + "</p>";
    var tags = [];
    if (cur.drill) tags.push('<span class="tag drill">面接官の深掘り' + (q.type ? "・" + esc(q.type) : "") + "</span>");
    if (!cur.drill && q.must) tags.push('<span class="tag must">必須</span>');
    if (cur.drill && q.core) tags.push('<span class="tag must">コア</span>');
    if (cur.drill && q.sec) tags.push('<span class="tag">目安 ' + q.sec + "秒</span>");
    if (tags.length) html += '<div class="badges">' + tags.join("") + "</div>";
    html += '<h2 class="q-text">' + esc(cur.drill ? "「" + q.q + "」" : q.q) + "</h2>";
    var aim = cur.drill ? q.aim : it.intent;
    if (aim) html += '<p class="intent">' + (cur.drill ? "面接官のねらい：" : "") + esc(aim) + "</p>";
    var help = cur.drill ? q.good : q.hint;
    if (help) html += '<details class="hint"><summary>' + (cur.drill ? "いい答えに入れるもの" : "答え方のヒント") + "</summary><p>" + esc(help) + "</p></details>";
    if (cur.drill) {
      var cAns = cellText(co, it.row, "C");
      if (cAns) html += '<details class="hint"><summary>この項目で答えた結論（C列）</summary><p>' + esc(cAns) + "</p></details>";
    }
    var others = othersForRow(key, it.row);
    if (others.length && !cur.drill) {
      html += '<details class="hint"><summary>他社の同じ項目で答えた内容（' + others.length + "件）</summary>";
      others.forEach(function (o, i) {
        html += "<p><b>" + esc(o.co) + "｜" + esc(o.q) + "</b><br>" + esc(o.a) + '<br><button class="text-btn" data-reuse="' + i + '">この回答を下に追加</button></p>';
      });
      html += "</details>";
    }
    var ek = key + ":" + q.id;
    var locked = isConfirmed(key, q.id) && !editing[ek];
    html += '<textarea class="answer' + (locked ? " locked" : "") + '" id="answer" placeholder="ここに入力、または下のマイクで話す" rows="6"' + (locked ? " readonly" : "") + ">" + esc(getAns(key, q.id)) + "</textarea>";
    html += '<div class="interim" id="interim" aria-live="polite"></div>';
    html += '<div class="status-row"><span id="timer" class="timer"></span><span id="saved" class="saved"></span></div>';
    if (!locked) {
      var aiPrev = getAi(key, q.id);
      html += '<section class="ai" id="ai">' +
        '<div class="ai-head"><span class="ai-title">AIが面接用に整えた文章</span>' +
        '<button class="text-btn" id="aiRun"' + (aiReady() ? "" : " disabled") + ">" + (aiPrev ? "整え直す" : "整える") + "</button></div>" +
        '<div class="ai-body" id="aiBody">' + (aiPrev ? esc(aiPrev.out) : '<span class="ai-empty">' + (aiReady() ? "話し終えると、" + esc(co.name) + "の求める人物像と面接で見ているポイントに沿って、この質問への答えに整えます" : 'AIを使うには、<a href="#/settings">設定</a>でOpenAIのAPIキーを入れてください') + "</span>") + "</div>" +
        '<div class="ai-actions" id="aiActions"' + (aiPrev ? "" : " hidden") + '><button class="btn" id="aiUse">この文章を使う</button></div>' +
        (getRaw(key, q.id) ? '<button class="text-btn" id="rawBack">自分が話した内容に戻す</button>' : "") +
        "</section>";
    }
    html += "</main>";

    var hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    html += '<div class="dock"><div class="dock-inner' + (locked ? " three" : "") + '">' +
      '<button class="btn" id="prev"' + (idx === 0 ? " disabled" : "") + ">前へ</button>" +
      (locked
        ? '<button class="btn" id="edit">修正</button><button class="btn primary" id="next">' + (idx === list.length - 1 ? "終える" : "次へ") + "</button>"
        : '<div class="mic-wrap"><button class="mic" id="mic" aria-label="音声で入力"' + (hasSR ? "" : " disabled") + ">" + ICON.mic + '</button><span class="mic-label" id="micLabel">' + (hasSR ? "話す" : "音声は非対応") + "</span></div>" +
          '<button class="btn primary" id="confirm">' + (editing[ek] ? "再確定" : "確定") + "</button>") +
      "</div></div>";
    app.innerHTML = html;

    var ta = document.getElementById("answer"), savedEl = document.getElementById("saved");
    autoGrow(ta);
    function showSync() {
      if (!getAns(key, q.id)) { savedEl.textContent = ""; savedEl.className = "saved"; return; }
      var conf = isConfirmed(key, q.id);
      if (conf && isSynced(co, it.row, col)) { savedEl.textContent = "確定済み・シートの" + col + it.row + "に反映済み"; savedEl.className = "saved ok"; }
      else if (conf) { savedEl.textContent = "確定済み"; savedEl.className = "saved"; }
      else if (editing[ek]) { savedEl.textContent = "修正中。直したら「再確定」を押してください"; savedEl.className = "saved"; }
      else { savedEl.textContent = "この端末に保存（未確定）"; savedEl.className = "saved"; }
    }
    showSync();
    var saveTimer;
    function save() {
      var ok = setAns(key, q.id, ta.value);
      if (!ok) { savedEl.textContent = "保存できませんでした（プライベートブラウズでは保存されません）"; return; }
      showSync();
    }
    ta.addEventListener("input", function () { autoGrow(ta); clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); });

    function move(to) { stopRec(); save(); go("#/q/" + key + "/" + mode + "/" + to); }
    document.getElementById("prev").onclick = function () { move(idx - 1); };
    document.getElementById("skip").onclick = function () { move(idx + 1); };
    if (locked) {
      document.getElementById("next").onclick = function () { move(idx + 1); };
      document.getElementById("edit").onclick = function () {
        editing[ek] = true; viewQuestion(key, mode, idx);
        var t = document.getElementById("answer"); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
      };
      return;
    }
    var cbtn = document.getElementById("confirm");
    cbtn.onclick = function () {
      stopRec(); clearTimeout(saveTimer); save();
      if (!ta.value.trim()) { toast("答えを入れてから確定してください"); return; }
      var wasEditing = !!editing[ek];
      setConfirmed(key, q.id); delete editing[ek];
      if (!conn) { toast("確定しました"); setTimeout(function () { move(idx + 1); }, 600); return; }
      cbtn.disabled = true; cbtn.textContent = "書き込み中";
      pushCell(co, it.row, col).then(function () {
        toast((wasEditing ? "シートの" + col + it.row + "を書き直しました" : "シートの" + col + it.row + "に入れました"));
        setTimeout(function () { move(idx + 1); }, 500);
      }, function () {
        cbtn.disabled = false; cbtn.textContent = "確定";
        savedEl.textContent = "シートに書き込めませんでした。電波を確認してもう一度確定してください"; savedEl.className = "saved err";
      });
    };

    Array.prototype.forEach.call(app.querySelectorAll("[data-reuse]"), function (b) {
      b.onclick = function () {
        var o = others[+b.getAttribute("data-reuse")];
        ta.value = ta.value ? ta.value.replace(/\s+$/, "") + "\n" + o.a : o.a;
        autoGrow(ta); save(); toast("追加しました");
      };
    });

    /* AIで整える */
    var aiBody = document.getElementById("aiBody"), aiRun = document.getElementById("aiRun"), aiActions = document.getElementById("aiActions");
    var aiBusy = false;
    function runAi(auto) {
      var src = ta.value.trim();
      if (!aiReady() || aiBusy) return;
      if (!src) { if (!auto) toast("先に話すか入力してください"); return; }
      var prev = getAi(key, q.id);
      if (auto && prev && prev.src === src) return;
      aiBusy = true; aiRun.disabled = true; aiRun.textContent = "整えています";
      aiBody.innerHTML = '<span class="ai-empty">整えています。10〜30秒ほどかかります</span>';
      var context = col === "D" ? cellText(co, it.row, "C") : "";
      polishText({ co: co, row: it.row, col: col, itemTitle: it.title, question: q.q, context: context, text: src }).then(function (out) {
        setAi(key, q.id, src, out);
        if (document.getElementById("aiBody") !== aiBody) return;
        aiBody.textContent = out; aiActions.hidden = false;
      }).catch(function (err) {
        if (document.getElementById("aiBody") !== aiBody) return;
        aiBody.innerHTML = '<span class="ai-empty">' + esc(aiErrorText(String(err.message || ""), err.detail)) + "</span>";
      }).then(function () {
        aiBusy = false;
        if (document.getElementById("aiRun") === aiRun) { aiRun.disabled = false; aiRun.textContent = "整え直す"; }
      });
    }
    aiRun.onclick = function () { runAi(false); };
    document.getElementById("aiUse").onclick = function () {
      var a = getAi(key, q.id); if (!a) return;
      var body = a.out.split("【足すと良いこと】")[0].trim();
      if (!getRaw(key, q.id)) setRaw(key, q.id, ta.value);
      ta.value = body; autoGrow(ta); save(); toast("整えた文章を回答に入れました");
      viewQuestion(key, mode, idx);
    };
    var rb = document.getElementById("rawBack");
    if (rb) rb.onclick = function () { ta.value = getRaw(key, q.id); setRaw(key, q.id, ""); save(); viewQuestion(key, mode, idx); };

    if (hasSR) setupMic(ta, save, cur.drill ? q.sec : 0, function () { runAi(true); });
  }
  function bucket(name, ck) { if (!state[name]) state[name] = {}; if (!state[name][ck]) state[name][ck] = {}; return state[name][ck]; }
  function getAi(ck, qid) { return (state.ai && state.ai[ck] && state.ai[ck][qid]) || null; }
  function setAi(ck, qid, src, out) { bucket("ai", ck)[qid] = { src: src, out: out }; persist(); }
  function getRaw(ck, qid) { return (state.raw && state.raw[ck] && state.raw[ck][qid]) || ""; }
  function setRaw(ck, qid, t) { var b = bucket("raw", ck); if (t) b[qid] = t; else delete b[qid]; persist(); }
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

  var timerId = null;
  function setupMic(ta, save, target, onStop) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = document.getElementById("mic"), label = document.getElementById("micLabel"), interimEl = document.getElementById("interim"), timerEl = document.getElementById("timer");
    var wanted = false, base = "", sessionText = "", started = 0;

    function joinText(a, b) { if (!a) return b; if (!b) return a; return /[\s\n。、]$/.test(a) ? a + b : a + "。" + b; }
    // iPhoneのSafariは、確定した結果に「それまでの全文」を重ねて返すことがあるので、重なりを除いてつなぐ
    function appendResult(acc, t) {
      t = t.trim(); if (!t) return acc;
      if (!acc) return t;
      if (t.indexOf(acc) === 0) return t;
      if (acc.slice(-t.length) === t) return acc;
      return acc + t;
    }
    function keepVisible() {
      var dock = document.querySelector(".dock"); if (!dock) return;
      var r = ta.getBoundingClientRect(), limit = dock.getBoundingClientRect().top - 16;
      if (r.bottom > limit) window.scrollBy(0, r.bottom - limit);
    }
    function tick() {
      var s = Math.floor((Date.now() - started) / 1000);
      timerEl.textContent = fmtSec(s) + (target ? " / 目安 " + fmtSec(target) : "");
      timerEl.className = "timer" + (target && s > target ? " over" : "");
    }
    function startSession() {
      var r = new SR();
      r.lang = "ja-JP"; r.continuous = true; r.interimResults = true;
      sessionText = "";
      r.onresult = function (e) {
        var fin = "", inter = "";
        for (var i = 0; i < e.results.length; i++) {
          var t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin = appendResult(fin, t); else inter += t;
        }
        // 確定前の文字も同じ枠に入れる（途中で認識が切れても消えない）
        sessionText = inter && inter.indexOf(fin) === 0 ? inter : fin + inter;
        ta.value = joinText(base, sessionText);
        interimEl.textContent = "";
        autoGrow(ta); keepVisible();
        save();
      };
      r.onerror = function (e) {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { wanted = false; toast("マイクの使用が許可されていません"); }
      };
      r.onend = function () {
        base = joinText(base, sessionText); sessionText = "";
        ta.value = base; autoGrow(ta);
        interimEl.textContent = "";
        if (wanted) { try { rec = startSession(); } catch (err) { setOff(); } } else { setOff(); if (onStop) onStop(); }
      };
      r.start();
      return r;
    }
    function setOn() {
      btn.classList.add("on"); btn.innerHTML = ICON.stop; btn.setAttribute("aria-label", "音声入力を止める"); label.textContent = "聞いています"; ta.classList.add("listening");
      started = Date.now(); tick(); clearInterval(timerId); timerId = setInterval(tick, 500);
    }
    function setOff() {
      wanted = false; btn.classList.remove("on"); btn.innerHTML = ICON.mic; btn.setAttribute("aria-label", "音声で入力"); label.textContent = "話す"; ta.classList.remove("listening"); interimEl.textContent = ""; rec = null;
      clearInterval(timerId); save();
    }
    btn.onclick = function () {
      if (wanted) { wanted = false; if (rec) rec.stop(); else setOff(); return; }
      ta.blur();
      base = ta.value; wanted = true;
      try { rec = startSession(); setOn(); } catch (err) { setOff(); toast("音声入力を開始できませんでした"); }
    };
  }
  function stopRec() { clearInterval(timerId); if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} rec = null; } }

  function viewFinished(co, mode) {
    document.body.classList.remove("q-screen");
    var s = stats(co);
    var html = bar(co.name, co.position, "#/c/" + co.key) + "<main>";
    html += '<div class="done-box"><h2>' + (mode === "must" ? "必須の質問はここまでです" : mode === "core" ? "深掘り練習はここまでです" : "この範囲の質問はここまでです") + "</h2>" +
      "<p>必須 " + s.mustDone + " / " + s.must + "　深掘り " + s.coreDone + " / " + s.core + "</p></div>";
    html += '<div class="stack">';
    if (mode === "must" && s.core) html += '<a class="btn primary" href="#/q/' + co.key + "/core/" + firstUnanswered(co, "core") + '">深掘りを練習する</a>';
    else if (s.done < s.total) html += '<a class="btn primary" href="#/q/' + co.key + '/rest/0">残りの質問に答える（' + (s.total - s.done) + "）</a>";
    html += '<a class="btn" href="#/c/' + co.key + '">項目の一覧へ</a></div></main>';
    app.innerHTML = html;
  }

  /* ---------- 画面：まとめる・送る ---------- */
  var sendSel = "all";
  function buildText(sel) {
    var lines = [];
    var d = new Date();
    lines.push("【面接シート回答】" + d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate() + " " + d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"));
    DATA.companies.forEach(function (co) {
      if (sel !== "all" && sel !== co.key) return;
      var block = [], any = false;
      block.push(""); block.push("■ " + co.name + "（" + co.position + "）");
      co.items.forEach(function (it) {
        var c = cellText(co, it.row, "C"), dd = cellText(co, it.row, "D");
        if (!c && !dd) return;
        any = true;
        block.push(""); block.push("▼ 行" + it.row + " " + it.title);
        if (c) block.push("[C列]\n" + c);
        if (dd) block.push("[D列]\n" + dd);
      });
      if (any) lines = lines.concat(block);
    });
    return lines.join("\n");
  }
  function allCells(sel) {
    var cells = [];
    DATA.companies.forEach(function (co) {
      if (sel !== "all" && sel !== co.key) return;
      co.items.forEach(function (it) {
        ["C", "D"].forEach(function (col) {
          var t = cellText(co, it.row, col);
          if (t && !isSynced(co, it.row, col)) cells.push({ company: co.key, row: it.row, col: col, text: t });
        });
      });
    });
    return cells;
  }
  function countAnswered(sel) { var n = 0; DATA.companies.forEach(function (co) { if (sel === "all" || sel === co.key) n += stats(co).done; }); return n; }
  function viewSend() {
    var html = bar("回答をまとめる", "", "#/") + "<main>";
    html += '<div class="seg" role="group" aria-label="範囲">';
    html += '<button data-sel="all" aria-pressed="' + (sendSel === "all") + '">すべて</button>';
    DATA.companies.forEach(function (co) { html += '<button data-sel="' + co.key + '" aria-pressed="' + (sendSel === co.key) + '">' + esc(co.name) + "</button>"; });
    html += "</div>";
    var n = countAnswered(sendSel), pending = allCells(sendSel);
    if (!n) html += '<p class="empty">まだ回答がありません</p>';
    else html += '<div class="preview">' + esc(buildText(sendSel)) + "</div>";
    html += '<div class="stack">' +
      (conn ? '<button class="btn primary" id="sync"' + (pending.length ? "" : " disabled") + ">" + ICON.sheet + "未反映のセルをシートに入れる（" + pending.length + "）</button>" : "") +
      '<button class="btn primary" id="copy"' + (n ? "" : " disabled") + ">" + ICON.copy + "まとめてコピー</button>" +
      '<button class="btn" id="dl"' + (n ? "" : " disabled") + ">" + ICON.file + "ファイルに保存</button></div>";
    html += '<p class="note">答えはこの端末のブラウザに保存されます。「まとめてコピー」で、シートのC列・D列に貼れる形でまとめて取り出せます。別の端末に移すときは、保存したファイルを「回答を読み込む」で開いてください。</p>';
    html += '<button class="text-btn" id="import">回答を読み込む</button><input type="file" id="importFile" accept=".json,application/json" hidden>';
    html += "</main>";
    app.innerHTML = html;

    Array.prototype.forEach.call(app.querySelectorAll(".seg button"), function (b) { b.onclick = function () { sendSel = b.getAttribute("data-sel"); viewSend(); }; });
    var sy = document.getElementById("sync");
    if (sy) sy.onclick = function () {
      sy.disabled = true; sy.textContent = "書き込み中";
      pushCells(allCells(sendSel)).then(function () { toast("シートに入れました"); viewSend(); }, function () { toast("書き込めませんでした"); viewSend(); });
    };
    var c = document.getElementById("copy");
    if (c) c.onclick = function () { copyText(buildText(sendSel)); };
    document.getElementById("dl").onclick = function () {
      var payload = { app: "mensetsu-taisaku", version: 2, exportedAt: new Date().toISOString(), answers: state.answers, text: buildText("all") };
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

  /* ---------- 接続の設定（#/setup?u=...&t=...） ---------- */
  function viewSetup(query) {
    var p = {};
    query.split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    var html = bar("シートとつなぐ", "", "#/") + "<main>";
    if (p.u && p.t && /^https:\/\/script\.google\.com\//.test(p.u)) {
      html += '<p class="lead">確認しています</p></main>';
      app.innerHTML = html;
      saveConn({ url: p.u, token: p.t });
      pushCells([]).then(function () {
        history.replaceState(null, "", location.pathname + "#/");
        app.innerHTML = bar("シートとつなぐ", "", "#/") + '<main><div class="done-box"><h2>面接シートとつながりました</h2><p>これから「確定」を押した答えは、シートの各社タブに入ります。</p></div><div class="stack"><a class="btn primary" href="#/">会社を選ぶ</a></div></main>';
      }, function () {
        saveConn(null);
        app.innerHTML = bar("シートとつなぐ", "", "#/") + '<main><p class="lead">つながりませんでした。リンクが古いか、電波が不安定です。左腕たけちゃんに新しいリンクをもらってください。</p></main>';
      });
      return;
    }
    html += '<p class="lead">' + (conn ? "この端末はシートとつながっています。" : "設定用リンクが正しくありません。") + "</p>";
    if (conn) html += '<div class="stack"><button class="btn" id="unlink">接続を解除する</button></div>';
    html += "</main>";
    app.innerHTML = html;
    var u = document.getElementById("unlink");
    if (u) u.onclick = function () { saveConn(null); go("#/"); };
  }

  /* ---------- ルーター ---------- */
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function route() {
    stopRec();
    document.body.classList.remove("q-screen");
    var h = (location.hash || "#/").slice(2), qi = h.indexOf("?");
    var query = qi >= 0 ? h.slice(qi + 1) : ""; if (qi >= 0) h = h.slice(0, qi);
    var p = h.split("/");
    if (p[0] === "c" && p[1]) viewCompany(p[1]);
    else if (p[0] === "q" && p[1]) viewQuestion(p[1], p[2] || "all", parseInt(p[3] || "0", 10) || 0);
    else if (p[0] === "send") viewSend();
    else if (p[0] === "setup") viewSetup(query);
    else if (p[0] === "settings") viewSettings();
    else viewHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();
})();
