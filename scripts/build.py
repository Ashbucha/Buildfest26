"""Build index.html from the cleaned workbook.

    python3 scripts/build.py                       # uses data/EveryMind988_Cleaned.xlsx
    python3 scripts/build.py path/to/other.xlsx    # rebuild from a newer cleaned workbook

Steps: convert.py (workbook -> build/data.json), themes.py (recode comment themes),
then pack the data and the dashboard code into src/template.html.
"""
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'EveryMind988_Cleaned.xlsx'
(ROOT / 'build').mkdir(exist_ok=True)
data_json = ROOT / 'build' / 'data.json'
subprocess.run([sys.executable, str(ROOT / 'scripts' / 'convert.py'), str(xlsx), str(data_json)], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts' / 'themes.py'), str(data_json)], check=True, stdout=subprocess.DEVNULL)

KEYS = ['record_id', 'role', 'county', 'language', 'training_date', 'month', 'days_to_submit',
        'pre_identify', 'pre_describe', 'pre_when', 'post_identify', 'post_describe', 'post_when',
        'deliv_engaged', 'recommend_0_10', 'call_988_0_10',
        'flag_likely_reversed', 'flag_speeder', 'flag_late_submission', 'flag_ceiling', 'flag_straightliner', 'flag_needed_fix',
        'spanish_speaker', 'improve_is_question', 'valuable', 'improve', 'valuable_themes', 'improve_themes', 'question_topics']
BOOLS = [k for k in KEYS if k.startswith('flag_') or k in ('spanish_speaker', 'improve_is_question')]
D = json.loads(data_json.read_text())
rows = [[(1 if r[k] else 0) if k in BOOLS else r[k] for k in KEYS] for r in D['responses']]
packed = json.dumps({'keys': KEYS, 'bools': BOOLS, 'rows': rows, 'cleaning_log': D['cleaning_log']},
                    ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

page = (ROOT / 'src' / 'dashboard-page.js').read_text().replace('"EM Poppins"', 'Poppins').replace('//# sourceURL=dash-page/index.html', '')
t = (ROOT / 'src' / 'template.html').read_text()
for k, v in (('/*DATA*/', packed), ('/*PAGE*/', page)):
    assert t.count(k) == 1, k
    t = t.replace(k, v)
html = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        + t.replace('</style>\n', '</style>\n</head>\n<body>\n', 1) + '</body>\n</html>\n')
(ROOT / 'index.html').write_text(html)
print(f'Wrote index.html ({len(html.encode()) // 1024} KB, {len(rows)} responses)')
