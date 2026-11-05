# -*- coding: utf-8 -*-
"""產生 DM 宣傳單（A4 正反兩頁 PDF + 可編輯的 HTML）。
用法：python -X utf8 tools/docs-build/build_dm.py
網址可用環境變數 SITE_URL 覆蓋（預設為目前正式站）。QR 碼由專案內的 qrcode 套件產生。"""
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SITE = os.environ.get('SITE_URL', 'https://school-sigma-nine.vercel.app').rstrip('/')
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'


def qr_svg(url):
    js = ("const Q=require('qrcode');Q.toString(process.argv[1],{type:'svg',margin:1,errorCorrectionLevel:'M'})"
          ".then(s=>process.stdout.write(s))")
    out = subprocess.run(['node', '-e', js, url], cwd=ROOT, capture_output=True, check=True, text=True, encoding='utf8')
    return out.stdout.replace('<svg ', '<svg class="qr" ', 1)


CARDS = [
    ('📋', '出缺席登錄', '任課老師用手機就能點名，導師一週批次上傳。事假、病假、曠課累計達門檻，自動提醒。'),
    ('📊', '成績與成績單', '期中、期末、平時分線上登錄，自動算班排名與年級排名；成績單可批次列印（PDF／Word／Excel）。'),
    ('👪', '家長與學生入口', '用手機號碼登入，查成績、出缺勤、獎懲、課表；線上請假、申請修改資料，不用再跑學校。'),
    ('✅', '審核線上化', '請假、學籍異動、獎懲、成績修正，一關一關線上核准，每一步都留下紀錄。'),
    ('🎨', '社團與選社', '學生線上填志願，電腦抽籤分發；社團老師線上點名與輸入成績。'),
    ('🪑', '考試分班', '自動編排考場與梅花座位表，一鍵發送考場表給導師，並列印座位表與簽到表。'),
    ('🕘', '打卡・請假・代課', '教職員查詢打卡紀錄；請假時逐節選代課老師，系統自動通知雙方。'),
    ('🏆', '競賽活動', '線上報名、評審手機打分、成績公布；外校與家長掃 QR 碼就能查成績。'),
]

CHIPS = ['依身分顯示功能', '資料庫權限雙重把關', '每日自動備份', '中文／泰文雙語', '手機友善']

CSS = '''
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; color: #1f2933; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; position: relative; overflow: hidden; page-break-after: always; background: #fff; }
.page:last-child { page-break-after: auto; }

/* ===== 正面 ===== */
.hero { height: 98mm; background: linear-gradient(135deg, #12324f 0%, #1f4e79 55%, #2b6ca3 100%); color: #fff; padding: 16mm 16mm 0; position: relative; overflow: hidden; }
.hero::after { content: ""; position: absolute; right: -28mm; top: -30mm; width: 110mm; height: 110mm; border-radius: 50%; background: rgba(255,255,255,0.07); }
.hero::before { content: ""; position: absolute; right: 22mm; bottom: -40mm; width: 80mm; height: 80mm; border-radius: 50%; background: rgba(232,145,58,0.28); }
.school { font-size: 13pt; letter-spacing: 4px; opacity: 0.9; position: relative; z-index: 1; }
.title { font-size: 44pt; font-weight: 800; line-height: 1.15; margin-top: 4mm; position: relative; z-index: 1; }
.tag { font-size: 16pt; margin-top: 6mm; font-weight: 600; position: relative; z-index: 1; }
.tag b { color: #ffc27a; }
.sub { font-size: 12pt; margin-top: 3mm; opacity: 0.88; position: relative; z-index: 1; }
.intro { padding: 9mm 16mm 3mm; font-size: 11.5pt; line-height: 1.8; color: #3e4c59; }
.intro b { color: #1f4e79; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm 6mm; padding: 3mm 16mm 0; }
.card { display: flex; gap: 4mm; background: #f4f7fb; border: 1px solid #dbe5f0; border-radius: 3mm; padding: 4mm 4.5mm; }
.ic { flex: none; width: 12mm; height: 12mm; border-radius: 3mm; background: #1f4e79; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 17pt; }
.card:nth-child(4n+2) .ic, .card:nth-child(4n+3) .ic { background: #e8913a; }
.card h3 { font-size: 12.5pt; color: #12324f; margin-bottom: 1mm; }
.card p { font-size: 9.6pt; line-height: 1.55; color: #46535f; }
.chips { position: absolute; left: 16mm; right: 16mm; bottom: 10mm; display: flex; flex-wrap: wrap; gap: 2.5mm; justify-content: center; }
.chip { background: #12324f; color: #fff; font-size: 9.5pt; padding: 1.6mm 4mm; border-radius: 10mm; }
.chip::before { content: "✓ "; color: #ffc27a; }

/* ===== 背面 ===== */
.bhead { background: #12324f; color: #fff; padding: 12mm 16mm 9mm; }
.bhead h2 { font-size: 26pt; }
.bhead p { font-size: 11.5pt; opacity: 0.88; margin-top: 2mm; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; padding: 8mm 16mm 0; }
.col { border: 1px solid #dbe5f0; border-top: 4px solid #1f4e79; border-radius: 2mm; padding: 4mm 4.5mm; background: #fff; }
.col:nth-child(2) { border-top-color: #e8913a; }
.col:nth-child(3) { border-top-color: #2f9e77; }
.col h3 { font-size: 14pt; color: #12324f; margin-bottom: 2.5mm; }
.col ol { padding-left: 5mm; font-size: 9.8pt; line-height: 1.7; color: #3e4c59; }
.col li { margin-bottom: 1.2mm; }
.col b { color: #1f4e79; }
.code { background: #fff4e5; border: 1px dashed #e8913a; border-radius: 1.5mm; padding: 1.5mm 2.5mm; margin-top: 2mm; font-size: 9.2pt; color: #7a4a0c; line-height: 1.6; }
.qrs { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; padding: 8mm 16mm 0; }
.qbox { display: flex; align-items: center; gap: 5mm; background: #f4f7fb; border: 1px solid #dbe5f0; border-radius: 3mm; padding: 4mm 5mm; }
.qr { width: 34mm; height: 34mm; flex: none; background: #fff; }
.qbox h4 { font-size: 12.5pt; color: #12324f; margin-bottom: 1.5mm; }
.qbox p { font-size: 9.2pt; color: #46535f; line-height: 1.55; }
.flow { padding: 8mm 16mm 0; }
.flow h3 { font-size: 13pt; color: #12324f; margin-bottom: 2.5mm; }
table { width: 100%; border-collapse: collapse; font-size: 9.6pt; }
th { background: #dce6f1; text-align: left; }
th, td { border: 1px solid #c3d0df; padding: 1.8mm 3mm; }
.tips { margin: 7mm 16mm 0; background: #fff8e1; border-left: 1.6mm solid #e0a800; border-radius: 1.5mm; padding: 4mm 5mm; }
.tips h3 { font-size: 12.5pt; color: #7a4a0c; margin-bottom: 1.8mm; }
.tips ul { padding-left: 5mm; font-size: 9.8pt; line-height: 1.75; color: #4a3b1a; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; background: #1f4e79; color: #fff; padding: 5mm 16mm; display: flex; justify-content: space-between; font-size: 10pt; }
'''


def wbr(u):
    return u.replace('-', '-<wbr>').replace('.', '.<wbr>').replace('/', '/<wbr>')


def build():
    site_qr = qr_svg(SITE)
    portal_qr = qr_svg(SITE + '/portal/login')
    cards = ''.join(f'<div class="card"><div class="ic">{i}</div><div><h3>{t}</h3><p>{d}</p></div></div>' for i, t, d in CARDS)
    chips = ''.join(f'<span class="chip">{c}</span>' for c in CHIPS)
    html = f'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>華雲學校 校務行政系統 DM</title><style>{CSS}</style></head><body>
<section class="page">
  <div class="hero">
    <div class="school">華 雲 學 校</div>
    <div class="title">校務行政系統</div>
    <div class="tag">出缺席・成績・請假・競賽，<b>一個網站全部搞定</b></div>
    <div class="sub">老師省時間，家長更安心</div>
  </div>
  <div class="intro">把學校每天的行政工作搬上網。<b>老師</b>少填表單、少跑辦公室，<b>家長與學生</b>用手機就能查詢與申請，<b>學校</b>的每一次審核與修改都有紀錄可查。</div>
  <div class="grid">{cards}</div>
  <div class="chips">{chips}</div>
</section>

<section class="page">
  <div class="bhead"><h2>三分鐘開始使用</h2><p>老師、家長、學生，各有自己的入口</p></div>
  <div class="three">
    <div class="col"><h3>老師</h3><ol>
      <li>開啟系統網址，選<b>「教職員」</b></li>
      <li>輸入登入信箱與密碼（第一次登入會要求先改密碼）</li>
      <li>看過<b>布告欄</b>，按「我知道」進入工作分類表</li>
      <li>依您的身分，自動顯示可用的功能</li>
    </ol></div>
    <div class="col"><h3>家長</h3><ol>
      <li>開啟系統網址，選<b>「家長/學生登入口」</b></li>
      <li>輸入登入代碼與手機號碼</li>
      <li>第一次使用請按<b>「申請帳號」</b>，導師核對手機後核准</li>
      <li>可查成績、出缺勤、獎懲、課表，也能線上請假</li>
    </ol><div class="code">登入代碼：<b>HY＋學號</b><br>密碼：<b>您的手機號碼</b></div></div>
    <div class="col"><h3>學生</h3><ol>
      <li>使用學生本人的登入代碼登入</li>
      <li>查詢自己的成績與出缺勤</li>
      <li>開放時間內可<b>線上選社</b>，也能報名競賽活動</li>
    </ol><div class="code">登入代碼：<b>HYS＋學號</b><br>密碼：<b>您的手機號碼</b></div></div>
  </div>
  <div class="qrs">
    <div class="qbox">{site_qr}<div><h4>老師入口</h4><p>掃描開啟系統<br>{wbr(SITE.replace('https://', ''))}</p></div></div>
    <div class="qbox">{portal_qr}<div><h4>家長／學生入口</h4><p>掃描直接前往登入<br>{wbr(SITE.replace('https://', '') + '/portal/login')}</p></div></div>
  </div>
  <div class="flow"><h3>常見申請，線上就能辦</h3>
    <table>
      <tr><th>想辦的事</th><th>誰送出</th><th>誰核准</th></tr>
      <tr><td>幫孩子請假</td><td>家長</td><td>班導師（核准後自動登記進出缺席）</td></tr>
      <tr><td>修改孩子或監護人資料</td><td>家長、學生</td><td>班導師</td></tr>
      <tr><td>第一次使用，申請登入帳號</td><td>家長、學生</td><td>班導師（核對手機）</td></tr>
      <tr><td>休學、轉學、轉班</td><td>導師</td><td>教務處</td></tr>
    </table>
  </div>
  <div class="tips"><h3>給家長的小提醒</h3><ul>
    <li>成績與排名，要等<b>導師送出並鎖定</b>平時分、學校公布後才會顯示。</li>
    <li>孩子的出缺席累計達到學校示警門檻的一半時，入口頁會<b>提醒您多留意</b>。</li>
    <li>線上請假<b>只能補請最近 14 天內</b>的假，並由家長帳號送出；可以只請部分節次。</li>
    <li>修改資料送出後，<b>導師核准前</b>畫面上仍顯示原本的資料，進度可在「通知」查看。</li>
  </ul></div>
  <div class="foot"><span>華雲學校　校務行政系統</span><span>使用問題請洽教務處，或索取《操作說明》</span></div>
</section>
</body></html>'''
    out_dir = os.path.join(ROOT, 'docs')
    html_path = os.path.join(out_dir, '校務行政系統DM.html')
    pdf_path = os.path.join(out_dir, '校務行政系統DM.pdf')
    open(html_path, 'w', encoding='utf8').write(html)
    if os.path.exists(pdf_path):
        os.remove(pdf_path)
    subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={pdf_path}',
                    'file:///' + html_path.replace('\\', '/')], check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('已產生：', html_path, '與', pdf_path)


if __name__ == '__main__':
    build()
