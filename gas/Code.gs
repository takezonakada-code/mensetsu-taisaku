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

function doGet() { return out_({ ok: true, hello: 'mensetsu-taisaku' }); }

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
