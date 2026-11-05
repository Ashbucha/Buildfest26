import openpyxl, json, re, datetime, sys
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
rows = list(wb['Cleaned_Data'].iter_rows(values_only=True)); h = rows[0]
SP = set('que de la el en los las muy para por una con es mas más fue porque sobre información aprendí mejor todo nada como cuando ayuda salud mental gracias'.split())
EN = set('the and to of is it was i a in for that how this more be about'.split())
def spanish_text(t):
    if not t: return False
    w = re.findall(r"[a-záéíóúñü]+", t.lower())
    if len(w) < 2: return t.lower().strip() in ('nada','ninguno','gracias','todo')
    sp = sum(x in SP for x in w); en = sum(x in EN for x in w)
    return sp >= 2 and sp > en * 1.5
def conv(v):
    if isinstance(v, datetime.datetime):
        return v.strftime('%Y-%m-%d') if v.time() == datetime.time(0) else v.isoformat(sep=' ')
    if isinstance(v, float) and v.is_integer() and False: return int(v)
    return v
likert = ['pre_identify','pre_describe','pre_when','post_identify','post_describe','post_when','deliv_engaged','deliv_knew','deliv_organized']
data = []; sp_by_text = 0
for r in rows[1:]:
    d = {k: conv(v) for k, v in zip(h, r)}
    for k in ('valuable','improve'):
        if d[k] is None: d[k] = ''
    d['record_id'] = d['response_id']
    by_text = spanish_text(d['valuable']) or spanish_text(d['improve'])
    sp_by_text += by_text and d['language'] != 'Spanish'
    d['spanish_speaker'] = d['language'] == 'Spanish' or by_text
    vals = [d[k] for k in likert if d[k] is not None]
    d['flag_straightliner'] = len(vals) >= 6 and len(set(vals)) == 1
    d['flag_needed_fix'] = bool(d['training_date_missing'])
    data.append(d)
import collections
cc = collections.Counter(d['county'] for d in data)
for d in data:
    if cc[d['county']] < 10:
        d['county'] = 'Other (under 10 responses each)'
        d['session_id'] = 'Other counties (dates withheld)'
log = [{'step_no': i, 'step': s, 'what_changed': (w or '').replace('\\u200e marks', 'direction marks').replace('\u200e', ''), 'rows_affected': n}
       for i, (s, w, n) in enumerate(list(wb['Cleaning_Log'].iter_rows(values_only=True))[1:], 1)]
json.dump({'responses': data, 'cleaning_log': log}, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(data), 'rows; spanish speakers', sum(d['spanish_speaker'] for d in data), '(by comment text only:', sp_by_text, ')',
      'straightliners', sum(d['flag_straightliner'] for d in data), 'needed_fix', sum(d['flag_needed_fix'] for d in data))
