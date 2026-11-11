"""profiles/*.json を1つの data.js にまとめる。公開してはいけない語が残っていたら止める。"""
import json, re, sys, pathlib
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
order = ["cyberz", "onestar", "vitabrid", "hakuhodo"]
NG = [r"小柳", r"万円", r"億円", r"AGA", r"美容医療", r"クリニック", r"\d[\d,]+\s*(万|億|%|％|本|円)"]
TITLES = {12:"自己紹介",13:"小〜中学生の時",14:"高校生の時",15:"大学時代",16:"大学で価値観を形成した経験",17:"人生で一番頑張った経験",18:"新卒時代に見ていた業界",19:"新卒の会社選びの軸",20:"1社目の決め手",21:"現職の業務内容",22:"現職の実績",23:"課題の特定→アクション→改善前対比",24:"現職で大変だったこと",25:"どう乗り越えたか",26:"現職で得た学び",27:"仕事で大事にしている価値観",28:"強み",29:"弱み",30:"退職理由",31:"転職の軸",32:"得たいことは現職で手に入らないのか",33:"キャリアビジョン",34:"なぜこの業界か",35:"志望動機",36:"活かせる点・足りない点",37:"逆質問"}
cos = []
for k in order:
    p = src / f"{k}.json"
    if not p.exists():
        print("skip", k); continue
    d = json.loads(p.read_text())
    keep = {x: d.get(x) for x in ["key", "name", "position", "tagline", "lookFor", "persona", "work", "cases", "keywords"]}
    # 公開ページには、転職エージェント資料由来の年収・金額や候補者の担当領域を出さない
    def clean(x):
        if isinstance(x, str):
            x = re.sub(r"[／/、]?\s*オファー提示\s*[\d,]+万円", "", x)
            x = re.sub(r"美容医療", "担当している商材", x)
            return x
        if isinstance(x, list): return [clean(i) for i in x]
        if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
        return x
    d = clean(d)
    keep = {x: d.get(x) for x in ["key", "name", "position", "tagline", "lookFor", "persona", "work", "cases", "keywords"]}
    keep["items"] = [{"row": it["row"], "title": TITLES[it["row"]], "intent": it.get("intent", ""),
                      "questions": [{"id": q["id"], "col": q["col"], "q": q["q"], "hint": q.get("hint", ""), "must": bool(q.get("must"))} for q in it["questions"]]}
                     for it in sorted(d["items"], key=lambda i: i["row"])]
    dp = src / f"{k}_drill.json"
    drills = {}
    if dp.exists():
        for it in clean(json.loads(dp.read_text()))["items"]:
            drills[it["row"]] = [{"id": q["id"], "type": q.get("type", ""), "q": q["q"], "aim": q.get("aim", ""), "good": q.get("good", ""),
                                  "sec": int(q.get("sec") or 45), "core": bool(q.get("core"))} for q in it["drill"]]
    else:
        print("no drill", k)
    for it in keep["items"]:
        it["drill"] = drills.get(it["row"], [])
    whole = json.dumps(keep, ensure_ascii=False); items = json.dumps(keep["items"], ensure_ascii=False)
    for pat in NG:
        txt = items if pat.startswith("\\d") else whole
        m = re.search(pat, txt)
        if m: sys.exit(f"NG word in {k}: {pat} … {txt[max(0,m.start()-30):m.end()+30]}")
    cos.append(keep)
out.write_text("window.INTERVIEW_DATA = " + json.dumps({"companies": cos}, ensure_ascii=False, indent=1) + ";\n")
print("ok", [c["key"] for c in cos], sum(len(q["questions"]) for c in cos for q in c["items"]), "questions", sum(len(q["drill"]) for c in cos for q in c["items"]), "drill")
