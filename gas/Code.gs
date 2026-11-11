/**
 * 面接シートへの書き込み口（Googleスプレッドシートの Apps Script に貼る）
 * サイトの「確定」から { token, company, row, col, text } を受け取り、該当タブのセルに書く。
 * TOKEN は公開リポジトリには書かない。デプロイする時だけ実際の値に置き換える。
 */
var TOKEN = 'ここに合言葉';
var TABS = {
  cyberz: 'サイバーZ_運用スペシャリスト',
  onestar: 'ワンスター_クリエイティブディレクター',
  vitabrid: 'ビタブリッド',
  hakuhodo: '博報堂DYONE_パフォーマンスコンサルタント'
};

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad-json' }); }
  if (p.token !== TOKEN) return out_({ ok: false, error: 'token' });
  if (p.ping) return out_({ ok: true, ping: true });
  if (p.action === 'polish') return out_(polish_(p));

  var cells = p.cells || [{ company: p.company, row: p.row, col: p.col, text: p.text }];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var done = [];
    cells.forEach(function (c) {
      var tab = TABS[c.company];
      var row = Number(c.row);
      if (!tab || !(row >= 12 && row <= 37) || (c.col !== 'C' && c.col !== 'D')) throw new Error('bad-target');
      var sh = ss.getSheetByName(tab);
      if (!sh) throw new Error('no-sheet:' + tab);
      sh.getRange(c.col + row).setValue(String(c.text || ''));
      done.push(c.company + ':' + c.col + row);
    });
    SpreadsheetApp.flush();
    return out_({ ok: true, done: done });
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- AIで面接用の文章に整える（Claude API） ----------
 * APIキーは「プロジェクトの設定 → スクリプト プロパティ」に ANTHROPIC_API_KEY として入れる（コードには書かない）。
 * 会社の前提は、シートの各社タブの 2〜3行目（会社概要・求める人物像・内定事例・面接で見ているポイントなど）をそのまま読む。
 */
var MODEL = 'claude-opus-5-5';

function companyContext_(company) {
  var cache = CacheService.getScriptCache();
  var key = 'ctx:' + company;
  var hit = cache.get(key);
  if (hit) return hit;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS[company]);
  var vals = sh.getRange('B2:K3').getDisplayValues();
  var parts = [];
  for (var c = 0; c < vals[0].length; c++) {
    var head = String(vals[0][c] || '').trim(), body = String(vals[1][c] || '').trim();
    if (!body) continue;
    parts.push('## ' + (head || '補足') + '\n' + body);
  }
  var fb = String(sh.getRange('B5').getDisplayValue() || '').trim();
  if (fb) parts.push('## 模擬面接でよく受けるフィードバック\n' + fb);
  var text = parts.join('\n\n');
  cache.put(key, text.slice(0, 90000), 21600);
  return text;
}

function polish_(p) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return { ok: false, error: 'no-key' };
  if (!TABS[p.company]) return { ok: false, error: 'bad-company' };
  var row = Number(p.row);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS[p.company]);
  var itemTitle = String(sh.getRange('B' + row).getDisplayValue() || p.itemTitle || '');

  var system =
    'あなたは転職の面接対策のコーチです。候補者が声で話した回答を、面接でそのまま話せる文章に整えます。\n\n' +
    '次の会社の面接を受けます。会社の情報と、その会社が面接で見ているポイントは以下のとおりです。\n\n' +
    '# 会社：' + TABS[p.company] + '\n\n' + companyContext_(p.company) + '\n\n' +
    '# 整え方\n' +
    '- 候補者が話した事実だけを使う。経験・数字・固有名詞を足したり盛ったりしない。足りない要素があれば、文章の最後に【足すと良いこと】として短く挙げる\n' +
    '- 話した具体的な場面・言葉・細部は削らずに残す。話が前後したり言い直したりしていても、文脈をつないで一本の筋の通った答えにする。音声の誤変換は文脈から正しい言葉に直す\n' +
    '- 答えは「質問」とシートの「項目」に対する答えになっていること。質問からそれた話は、項目の答えにつながる形で使うか削る\n' +
    '- 上の「求める人物像」「面接で見ているポイント」に沿うよう、どの事実を前に出すか・どう言葉にするかを選ぶ\n' +
    '- 結論から話す。です・ます調の話し言葉で、声に出して自然な長さにする\n' +
    '- 数字は、何と比べてどうか（何人中・平均と比べて）が伝わる形にする。話の中に比較がなければ【足すと良いこと】に回す\n' +
    '- 経験 → そう思った理由（感情）→ これからどうしたいか、がつながるようにする\n' +
    '- 出力は整えた文章と【足すと良いこと】だけ。前置きや解説は書かない';

  var colGuide = p.col === 'C'
    ? 'この答えはシートのC列（結論）に入ります。2〜3文で、聞かれたことに一言で答える形にしてください。'
    : 'この答えはシートのD列（深掘り）に入ります。場面 → 自分の行動 → 結果 → 学び の流れで、面接官に深掘られた時にそのまま話せる形にしてください。';

  var user =
    '面接シートの項目：' + itemTitle + '\n' +
    '質問：' + String(p.question || '') + '\n' +
    (p.context ? 'この項目ですでに答えている結論：' + String(p.context) + '\n' : '') +
    colGuide + '\n\n' +
    '候補者が話した内容（音声の文字起こし。誤変換を含む）：\n' + String(p.text || '');

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: system,
      messages: [{ role: 'user', content: user }]
    }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: 'api-' + code }; }
  if (code !== 200) return { ok: false, error: (body.error && body.error.message) || ('api-' + code) };
  if (body.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
  var text = (body.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
  return { ok: true, text: text };
}

function doGet() { return out_({ ok: true, hello: 'mensetsu-taisaku' }); }

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
