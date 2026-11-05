# -*- coding: utf-8 -*-
"""把操作說明的 Markdown 轉成 Word（.docx）。
用法：python -X utf8 tools/docs-build/md2docx.py <輸入.md> <輸出.docx> [副標題]
只支援我們文件裡用到的語法：# ## ### 標題、段落、- 清單、1. 清單、> 引言、| 表格 |、``` 程式碼、**粗體**、`行內碼`、--- 分隔線。
"""
import re
import sys
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

FONT = 'Microsoft JhengHei'
MONO = 'Consolas'
BLUE = RGBColor(0x1F, 0x4E, 0x79)
GRAY = RGBColor(0x55, 0x55, 0x55)


def set_font(run, name=FONT, size=None, bold=None, color=None, italic=None):
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    for k in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
        rfonts.set(qn(k), name)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = color


def shade(element_pr, fill):
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    element_pr.append(shd)


def para_border_left(paragraph, color='E0A800', size=18):
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    left = OxmlElement('w:left')
    left.set(qn('w:val'), 'single')
    left.set(qn('w:sz'), str(size))
    left.set(qn('w:space'), '8')
    left.set(qn('w:color'), color)
    pbdr.append(left)
    ppr.append(pbdr)


INLINE = re.compile(r'(\*\*.+?\*\*|`.+?`)')


def add_inline(paragraph, text, size=10.5, color=None, base_bold=False):
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith('**') and part.endswith('**') and len(part) > 4:
            r = paragraph.add_run(part[2:-2])
            set_font(r, size=size, bold=True, color=color)
        elif part.startswith('`') and part.endswith('`') and len(part) > 2:
            r = paragraph.add_run(part[1:-1])
            set_font(r, name=MONO, size=size - 0.5, color=RGBColor(0xA3, 0x2D, 0x2D))
        else:
            r = paragraph.add_run(part)
            set_font(r, size=size, bold=base_bold, color=color)


def add_footer_page_number(section):
    p = section.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('第 ')
    set_font(r, size=9, color=GRAY)
    for kind, txt in (('begin', None), (None, 'PAGE'), ('end', None)):
        run = p.add_run()
        set_font(run, size=9, color=GRAY)
        if kind:
            fc = OxmlElement('w:fldChar')
            fc.set(qn('w:fldCharType'), kind)
            run._r.append(fc)
        else:
            it = OxmlElement('w:instrText')
            it.set(qn('xml:space'), 'preserve')
            it.text = txt
            run._r.append(it)
    r = p.add_run(' 頁')
    set_font(r, size=9, color=GRAY)


def build(md_path, out_path, subtitle=''):
    lines = open(md_path, encoding='utf8').read().split('\n')
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2.0)
    sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(1.8)
    add_footer_page_number(sec)

    normal = doc.styles['Normal']
    normal.font.name = FONT
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.25

    first_chapter = True
    i = 0
    title_done = False

    def heading(text, level):
        sizes = {1: 24, 2: 17, 3: 13}
        p = doc.add_paragraph()
        p.paragraph_format.keep_with_next = True
        if level == 2:
            p.paragraph_format.space_before = Pt(6)
            p.paragraph_format.space_after = Pt(8)
            ppr = p._p.get_or_add_pPr()
            pbdr = OxmlElement('w:pBdr')
            b = OxmlElement('w:bottom')
            b.set(qn('w:val'), 'single'); b.set(qn('w:sz'), '10'); b.set(qn('w:space'), '4'); b.set(qn('w:color'), '1F4E79')
            pbdr.append(b); ppr.append(pbdr)
        elif level == 3:
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(4)
        r = p.add_run(text)
        set_font(r, size=sizes[level], bold=True, color=BLUE if level != 3 else RGBColor(0x2B, 0x2B, 0x2B))
        return p

    def flush_table(rows):
        rows = [r for r in rows if not re.match(r'^\|?\s*:?-{2,}', r.replace(' ', ''))]
        cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
        ncols = max(len(r) for r in cells)
        t = doc.add_table(rows=len(cells), cols=ncols)
        t.style = 'Table Grid'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for ri, row in enumerate(cells):
            for ci in range(ncols):
                cell = t.cell(ri, ci)
                cell.text = ''
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing = 1.15
                txt = row[ci] if ci < len(row) else ''
                add_inline(p, txt, size=9.5, base_bold=(ri == 0))
                if ri == 0:
                    shade(cell._tc.get_or_add_tcPr(), 'DCE6F1')
        doc.add_paragraph().paragraph_format.space_after = Pt(2)

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        s = line.strip()

        if not s:
            i += 1
            continue
        if s == '---':
            i += 1
            continue
        if s.startswith('```'):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i].rstrip())
                i += 1
            i += 1
            for l in buf:
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Cm(0.6)
                p.paragraph_format.space_after = Pt(0)
                shade(p._p.get_or_add_pPr(), 'F3F3F3')
                r = p.add_run(l if l else ' ')
                set_font(r, name=MONO, size=9.5)
            doc.add_paragraph().paragraph_format.space_after = Pt(2)
            continue
        if s.startswith('# '):
            text = s[2:].strip()
            if not title_done:
                title_done = True
                for _ in range(5):
                    doc.add_paragraph()
                p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                r = p.add_run(text); set_font(r, size=30, bold=True, color=BLUE)
                if subtitle:
                    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    r = p.add_run(subtitle); set_font(r, size=14, color=GRAY)
                i += 1
                # 封面下面連續的 > 版本資訊
                p = doc.add_paragraph()
                while i < len(lines) and (lines[i].strip().startswith('>') or not lines[i].strip()):
                    if lines[i].strip().startswith('>'):
                        q = doc.add_paragraph(); q.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        add_inline(q, lines[i].strip().lstrip('>').strip(), size=11, color=GRAY)
                    i += 1
                doc.add_page_break()
                continue
            heading(text, 1)
            i += 1
            continue
        if s.startswith('## '):
            if not first_chapter:
                doc.add_page_break()
            first_chapter = False
            heading(s[3:].strip(), 2)
            i += 1
            continue
        if s.startswith('### '):
            heading(s[4:].strip(), 3)
            i += 1
            continue
        if s.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append(lines[i].strip())
                i += 1
            flush_table(rows)
            continue
        if s.startswith('>'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                block.append(lines[i].strip()[1:].strip())
                i += 1
            for b in block:
                if not b:
                    continue
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Cm(0.5)
                p.paragraph_format.space_after = Pt(1)
                shade(p._p.get_or_add_pPr(), 'FFF8E1')
                para_border_left(p)
                if b.startswith('- '):
                    add_inline(p, '• ' + b[2:], size=10)
                else:
                    add_inline(p, b, size=10)
            doc.add_paragraph().paragraph_format.space_after = Pt(2)
            continue
        m = re.match(r'^(\d+)\.\s+(.*)$', s)
        if m:
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.9)
            p.paragraph_format.first_line_indent = Cm(-0.6)
            p.paragraph_format.space_after = Pt(2)
            add_inline(p, f'{m.group(1)}. {m.group(2)}')
            i += 1
            continue
        if s.startswith('- ') or s.startswith('* '):
            indent = (len(raw) - len(raw.lstrip(' '))) // 2
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.9 + 0.7 * indent)
            p.paragraph_format.first_line_indent = Cm(-0.5)
            p.paragraph_format.space_after = Pt(2)
            add_inline(p, '• ' + s[2:])
            i += 1
            continue
        if s.startswith('*') and s.endswith('*') and not s.startswith('**'):
            p = doc.add_paragraph()
            add_inline(p, s.strip('*'), size=9.5, color=GRAY)
            i += 1
            continue
        p = doc.add_paragraph()
        add_inline(p, s)
        i += 1

    doc.core_properties.title = re.sub(r'^#\s*', '', lines[0]) if lines else ''
    doc.core_properties.author = '華雲學校'
    doc.save(out_path)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '')
    print('已產生：', sys.argv[2])
