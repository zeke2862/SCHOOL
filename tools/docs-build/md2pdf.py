# -*- coding: utf-8 -*-
"""把 Markdown 轉成 PDF：Markdown → HTML（加上列印樣式）→ Edge 無頭模式列印成 PDF。
用法：python -X utf8 tools/docs-build/md2pdf.py <輸入.md> <輸出.pdf> [標題] [副標題]
需要：pip install markdown；Windows 內建的 Microsoft Edge。"""
import os
import re
import subprocess
import sys
import tempfile

import markdown

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

CSS = '''
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; font-size: 10.5pt; line-height: 1.65; color: #222; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
.cover h1 { font-size: 30pt; color: #1f4e79; margin: 0 0 10px; border: 0; }
.cover .sub { font-size: 14pt; color: #555; margin-bottom: 40px; }
.cover .meta { font-size: 11pt; color: #666; line-height: 2; }
h1 { font-size: 22pt; color: #1f4e79; }
h2 { font-size: 16pt; color: #1f4e79; border-bottom: 2px solid #1f4e79; padding-bottom: 4px; margin: 0 0 12px; page-break-before: always; page-break-after: avoid; }
h2.first { page-break-before: auto; }
h3 { font-size: 12.5pt; color: #2b2b2b; margin: 18px 0 6px; page-break-after: avoid; }
p { margin: 6px 0; }
ul, ol { margin: 6px 0 8px 0; padding-left: 22px; }
li { margin: 2px 0; }
blockquote { margin: 10px 0; padding: 8px 14px; background: #fff8e1; border-left: 4px solid #e0a800; border-radius: 3px; page-break-inside: avoid; }
blockquote p { margin: 3px 0; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th { background: #dce6f1; text-align: left; }
th, td { border: 1px solid #b8c4d2; padding: 5px 8px; vertical-align: top; }
code { font-family: Consolas, monospace; background: #f3f3f3; padding: 1px 4px; border-radius: 3px; color: #a32d2d; }
pre { background: #f3f3f3; padding: 8px 12px; border-radius: 4px; page-break-inside: avoid; }
pre code { background: none; color: #222; padding: 0; }
hr { display: none; }
em { color: #666; }
'''


def build(md_path, pdf_path, title='', subtitle=''):
    text = open(md_path, encoding='utf8').read()
    lines = text.split('\n')
    # 封面：第一個 # 標題＋緊接著的 > 版本資訊
    cover = ''
    if lines and lines[0].startswith('# '):
        t = lines[0][2:].strip()
        meta = []
        j = 1
        while j < len(lines) and (lines[j].startswith('>') or not lines[j].strip()):
            if lines[j].startswith('>'):
                meta.append(lines[j].lstrip('>').strip())
            j += 1
        meta_html = '<br>'.join(re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', m) for m in meta)
        cover = f'<div class="cover"><h1>{title or t}</h1><div class="sub">{subtitle}</div><div class="meta">{meta_html}</div></div>'
        text = '\n'.join(lines[j:])
    body = markdown.markdown(text, extensions=['tables', 'fenced_code', 'sane_lists'])
    body = body.replace('<h2>', '<h2 class="first">', 1)
    html = f'<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>{title or "文件"}</title><style>{CSS}</style></head><body>{cover}{body}</body></html>'
    tmp = os.path.join(tempfile.gettempdir(), 'md2pdf_tmp.html')
    open(tmp, 'w', encoding='utf8').write(html)
    out = os.path.abspath(pdf_path)
    if os.path.exists(out):
        os.remove(out)
    subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                    f'--print-to-pdf={out}', 'file:///' + tmp.replace('\\', '/')], check=True, timeout=180,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(out):
        raise SystemExit('Edge 沒有產生 PDF')
    print('已產生：', out)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '', sys.argv[4] if len(sys.argv) > 4 else '')
