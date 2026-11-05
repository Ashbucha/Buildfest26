"""Recode comment themes to match the original dashboard's categories.
Starts from the workbook's codes (renamed where the original renamed them) and adds keyword rules for themes the
original added. Applied after convert.py; rewrites valuable_themes / improve_themes / question_topics in data.json."""
import json, re, sys
p = sys.argv[1]
D = json.load(open(p))
RENAME = {
    'That 988 exists / where to get help': 'General: knowing 988 exists',
    'Someone listens without judgment': 'Someone is always there to listen',
    'Tech or room problems': 'Food, room and logistics',
    'Police, privacy and what happens': 'Police, privacy and location',
    'How texting or chat works': 'What happens on a call',
}
R = lambda s: re.compile(s, re.I)
ADD = {
    'valuable': [
        ("What 988 is and what it's for", R(r"what 988 is|purpose|what (it|988) (is|does|offers)|understanding (of )?(what|988|the)|what the (line|hotline|number) is|para qu[eé] (sirve|es)|qu[eé] es (el )?988")),
        ('Not just for suicide or crisis', R(r"not (just|only|always) (for )?(suicid|crisis|emergenc|when)|(don'?t|do not|doesn'?t) (have|need) to be (in (a )?crisis|suicidal)|no crisis|any (problem|issue|reason|kind)|anything|no (solo|s[oó]lo|es solo) (es )?para")),
        ('You can call for someone else', R(r"(call|text|reach out|contact) (988 )?(for|on behalf of) (a |someone|somebody|others|another|other people|friends?|family|loved)|for someone else|por otra persona|para (otra persona|alguien m[aá]s)")),
        ('Someone is always there to listen', R(r"someone (is )?(always )?(there|to talk|to listen|will listen)|always (someone|there)|listen|alguien (que )?(te )?escuch")),
    ],
    'improve': [
        ('Food, room and logistics', R(r"\bfood\b|snack|pizza|drinks?\b|\broom\b|temperature|too (cold|hot)|seats?\b|chairs?|microphone|\bmic\b|audio|sound|projector|wi-?fi|parking|comida")),
    ],
    'question': [
        ('What happens on a call', R(r"what happens|what (would|will|do) (they|you|988|counselors) (ask|say|do)|what would happen|what if (someone|the person|all|you|they)|how (long|the calls?|the de-?escalation|would they connect|is it 24)|how (does |do |did )?(it|988|this) (actually |fully )?works?|how 988 works|pick up|call back|same person|process|disconnected|in-person|refuse|the call (take|go)|stations|how (does|do|did) (it|988|the call|they|you|calling|texting) (work|help)|how (it|the help) (is provided|works)|after (you|i|someone) (call|text)|c[oó]mo (trabajan|funciona)|text(ing)?\b|\bchat")),
        ('History and name of 988', R(r"how (did )?(it|988|this|these sources) (start|started|began|were created)|when (things like )?988 started|influence the organization|never a thing|how (it|988|this) (came|was made)|history|why (is it|the number|988|they chose)|who (made|created|started|invented)|when (was|did) (it|988)|\bname\b")),
        ("Where it's available and cost", R(r"world ?wide|everywhere|no (wifi|call service)|\bfee\b|phone bills?|\bcost|\bfree\b|\bpay\b|available|other (states|countries)|where (is|can|do)|nationwide|every state|outside (of )?(maryland|the us)")),
        ('Warmline and other hotlines', R(r"warm-?line|trevor|other (hotlines?|lines?|numbers?|resources)|\b911\b|crisis lines?|hotlines")),
        ('Why people struggle', R(r"why (does )?struggling|why people do|why do people (do|not)|(people|someone) (get|feel)|why (do |would |does )?(people|someone|kids|teens|students|they) (feel|struggle|get|are|commit|have|want|hurt)|causes?\b|depress|what makes (people|someone)")),
        ('Helping someone else', R(r"(know|tell|identify) (when|if) (someone|something)|de-?escalate a friend|explain 988|call(s|ed)? (it )?for (you|someone)|for someone else|what to say|share it|more people know|help (a |my |your )?(friend|someone|somebody|others|family|kids|child|peers?)|how (can|do|could|should) (i|we|you) help|ayudar|consejos|hijos")),
        ('Police, privacy and location', R(r"police|cops|track|location|privacy|private|confidential|anonymous|record(ed)?\b|trace|locat")),
        ("Who answers and how they're trained", R(r"hired|work at 988|988 trainer|stay that calm|really care|comforting|certain person|counsel+or|who (answers|picks up|is on|works)|trained|become a|volunteer|\bstaff\b")),
        ('Who can use it and for what', R(r"what else|more reasons|too small|what do most people call|when to (call|use|reach)|used for|versatile|(can|could) (anyone|i|kids|you|adults|students) (call|use|text)|\bage\b|for what|what (kinds?|types?) of|only for")),
        ('Numbers and statistics', R(r"what county has|how many|percent|statistic|number of|per (day|year)|a day|average|\brate\b")),
    ],
}
COLS = {'valuable': ('valuable', 'valuable_themes'), 'improve': ('improve', 'improve_themes'), 'question': ('improve', 'question_topics')}
for r in D['responses']:
    for kind, (text_col, col) in COLS.items():
        text = r[text_col] or ''
        if kind == 'question' and not r['improve_is_question']:
            continue
        cur = [RENAME.get(x.strip(), x.strip()) for x in str(r[col] or '').split(';') if x.strip()]
        if not text.strip():
            r[col] = '; '.join(cur) or None; continue
        for theme, rx in ADD[kind]:
            if theme not in cur and rx.search(text):
                cur.append(theme)
        r[col] = '; '.join(cur) or None
json.dump(D, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))
import collections
for kind, (_, col) in COLS.items():
    writers = sum(1 for r in D['responses'] if (r[COLS[kind][0]] or '').strip() and (kind != 'question' or r['improve_is_question']))
    c = collections.Counter(x.strip() for r in D['responses'] for x in str(r[col] or '').split(';') if x.strip())
    print(kind, writers, [(k, f"{v/writers:.0%}") for k, v in c.most_common()])
