(function () {
/* ===== Thresholds (calculations below repeat these numbers; keep them in sync) ===== */
window.EM = { MIN_N: 10, CAUTION_N: 30, ENG_MIN: 4.0, GAIN_MIN: 0.5 };

/* ===== Calculations: every figure comes from the cleaned responses file ===== */
dash.calc('base_all', {
  inputs: ['responses'],
  title: 'All responses with scores',
  description: 'Every cleaned response with its averages, gains and the audience filters it belongs to.',
  fn: (responses) => responses.map((r) => {
    const has = [r.pre_identify, r.pre_describe, r.pre_when, r.post_identify, r.post_describe, r.post_when].every((x) => x != null);
    const pre = has ? (r.pre_identify + r.pre_describe + r.pre_when) / 3 : null;
    const post = has ? (r.post_identify + r.post_describe + r.post_when) / 3 : null;
    const student = r.role === 'Student';
    const segs = ['All participants', student ? 'Students' : 'Adults (non-students)'];
    if (r.role === 'School staff') segs.push('School staff');
    if (r.role === 'Caregiver/parent') segs.push('Caregivers/parents');
    if (r.role === 'Community member') segs.push('Community members');
    if (['Anne Arundel', "Prince George's", 'Montgomery', "Queen Anne's"].includes(r.county)) segs.push(r.county);
    if (r.spanish_speaker) segs.push('Spanish speakers');
    return {
      ...r, student, segs, has_knowledge: has, included: has && !r.flag_likely_reversed,
      pre_avg: pre, post_avg: post, gain_avg: has ? post - pre : null,
      gain_identify: has ? r.post_identify - r.pre_identify : null,
      gain_describe: has ? r.post_describe - r.pre_describe : null,
      gain_when: has ? r.post_when - r.pre_when : null,
    };
  }),
});

dash.calc('base', {
  inputs: ['base_all'],
  title: 'Responses used in results',
  description: 'All responses except likely reversed-scale answers and rows missing a knowledge rating.',
  fn: (base_all) => base_all.filter((r) => r.included),
});

dash.calc('seg_kpis', {
  inputs: ['base'],
  title: 'Headline figures by audience',
  description: 'Counts, shares with Wilson 95% intervals, average gain with t-interval, and NPS with its interval, for each audience filter.',
  fn: (base) => {
    const Z = 1.959963984540054;
    const wilson = (k, n) => { if (!n) return [null, null, null]; const p = k / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d; return [p, Math.max(0, c - h), Math.min(1, c + h)]; };
    const tq = (df) => Z + (Z ** 3 + Z) / (4 * df) + (5 * Z ** 5 + 16 * Z ** 3 + 3 * Z) / (96 * df * df) + (3 * Z ** 7 + 19 * Z ** 5 + 17 * Z ** 3 - 15 * Z) / (384 * df ** 3);
    const meanCI = (xs) => { const n = xs.length; if (n < 2) return [null, null, null]; const m = xs.reduce((s, x) => s + x, 0) / n; const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)); const h = tq(n - 1) * sd / Math.sqrt(n); return [m, m - h, m + h]; };
    const npsCI = (xs) => { const n = xs.length; if (!n) return [null, null, null]; const pro = xs.filter((x) => x >= 9).length / n, det = xs.filter((x) => x <= 6).length / n, v = pro - det, se = Math.sqrt(Math.max(0, pro + det - v * v) / n); return [v * 100, Math.max(-100, (v - Z * se) * 100), Math.min(100, (v + Z * se) * 100)]; };
    return [...new Set(base.flatMap((r) => r.segs))].map((segment) => {
      const a = base.filter((r) => r.segs.includes(segment));
      const asked = a.filter((r) => r.call_988_0_10 != null);
      const knowers = asked.filter((r) => r.post_when >= 4);
      const [pw, pwl, pwh] = wilson(a.filter((r) => r.post_when >= 4).length, a.length);
      const [pp] = wilson(a.filter((r) => r.pre_when >= 4).length, a.length);
      const [g, gl, gh] = meanCI(a.map((r) => r.gain_avg));
      const [c, cl, ch] = asked.length >= 10 ? wilson(asked.filter((r) => r.call_988_0_10 >= 9).length, asked.length) : [null, null, null];
      const [ck] = knowers.length >= 10 ? wilson(knowers.filter((r) => r.call_988_0_10 >= 9).length, knowers.length) : [null];
      const [nps, nl, nh] = npsCI(a.map((r) => r.recommend_0_10).filter((x) => x != null));
      const eng = a.map((r) => r.deliv_engaged).filter((x) => x != null);
      return {
        segment, n: a.length, pct_pre_when: pp, pct_post_when: pw, pct_post_when_lo: pwl, pct_post_when_hi: pwh,
        gain_avg: g, gain_lo: gl, gain_hi: gh, n_call: asked.length, pct_call_hi: c, pct_call_hi_lo: cl, pct_call_hi_hi: ch,
        pct_call_hi_knowers: ck, nps, nps_lo: nl, nps_hi: nh, engaged: eng.length ? eng.reduce((s, x) => s + x, 0) / eng.length : null,
      };
    });
  },
});

dash.calc('stats', {
  inputs: ['base_all'],
  title: 'Statistical tests and checks',
  description: 'Before/after tests per audience, sixteen program-wide tests with Holm-adjusted p-values, sensitivity scenarios and checks on the recalled before-ratings. Same methods as clean_988.py.',
  fn: (base_all) => {
    /* ---------- numerical helpers ---------- */
    const Z = 1.959963984540054;
    const sum = (xs) => xs.reduce((s, x) => s + x, 0);
    const mean = (xs) => sum(xs) / xs.length;
    const sd = (xs) => { const m = mean(xs); return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)); };
    const erfc = (x) => { const z = Math.abs(x), t = 1 / (1 + 0.5 * z); const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; };
    const pNorm2 = (z) => Math.min(1, erfc(Math.abs(z) / Math.SQRT2));
    const lgamma = (x) => { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (const v of c) ser += v / ++y; return -tmp + Math.log(2.5066282746310005 * ser / x); };
    const betacf = (a, b, x) => { let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d; for (let m = 1; m <= 300; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c; aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break; } return h; };
    const betai = (a, b, x) => { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; };
    const pT2 = (t, df) => betai(df / 2, 0.5, df / (df + t * t));
    const gammq = (a, x) => { if (x <= 0) return 1; const gln = lgamma(a); if (x < a + 1) { let ap = a, s = 1 / a, del = s; for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 3e-14) break; } return 1 - s * Math.exp(-x + a * Math.log(x) - gln); } let b = x + 1 - a, c = 1e300, d = 1 / b, h = d; for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break; } return Math.exp(-x + a * Math.log(x) - gln) * h; };
    const tq = (df) => Z + (Z ** 3 + Z) / (4 * df) + (5 * Z ** 5 + 16 * Z ** 3 + 3 * Z) / (96 * df * df) + (3 * Z ** 7 + 19 * Z ** 5 + 17 * Z ** 3 - 15 * Z) / (384 * df ** 3);
    const meanCI = (xs) => { if (xs.length < 2) return [xs.length ? xs[0] : null, null, null]; const m = mean(xs), h = tq(xs.length - 1) * sd(xs) / Math.sqrt(xs.length); return [m, m - h, m + h]; };
    const wilson = (k, n) => { if (!n) return [null, null, null]; const p = k / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d; return [p, Math.max(0, c - h), Math.min(1, c + h)]; };
    const rank = (xs) => { const o = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); let tie = 0; for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2 + 1; const t = j - i + 1; tie += t ** 3 - t; i = j + 1; } return { r, tie }; };
    const wilcoxon = (d) => { const nz = d.filter((x) => x !== 0), n = nz.length; const out = { n: d.length, improved: d.length ? d.filter((x) => x > 0).length / d.length : null, declined: d.length ? d.filter((x) => x < 0).length / d.length : null, z: null, p: null, r: null }; if (n < 10) return out; const { r, tie } = rank(nz.map(Math.abs)); let rp = 0, rm = 0; nz.forEach((x, i) => { if (x > 0) rp += r[i]; else rm += r[i]; }); const z = (rp - n * (n + 1) / 4) / Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tie / 48); return { ...out, z, p: pNorm2(z), r: (rp - rm) / (rp + rm) }; };
    const mannWhitney = (a, b) => { const n1 = a.length, n2 = b.length, N = n1 + n2, { r, tie } = rank(a.concat(b)); const U = sum(r.slice(0, n1)) - n1 * (n1 + 1) / 2, mu = n1 * n2 / 2; const v = n1 * n2 / 12 * ((N + 1) - tie / (N * (N - 1))); const z = (Math.abs(U - mu) - 0.5) / Math.sqrt(v); return { n: N, U, p: pNorm2(z), r: 2 * U / (n1 * n2) - 1 }; };
    const welch = (a, b) => { const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length, d = mean(a) - mean(b), se = Math.sqrt(va + vb); const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1)); return [d, d - tq(df) * se, d + tq(df) * se]; };
    const twoProp = (k1, n1, k2, n2) => { const [p1, l1, u1] = wilson(k1, n1), [p2, l2, u2] = wilson(k2, n2), pp = (k1 + k2) / (n1 + n2); const z = (p1 - p2) / Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)), d = p1 - p2; return { n: n1 + n2, z, p: pNorm2(z), d, lo: d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), hi: d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2) }; };
    const spearman = (x, y) => { const rx = rank(x).r, ry = rank(y).r, mx = mean(rx), my = mean(ry); const rho = sum(rx.map((v, i) => (v - mx) * (ry[i] - my))) / Math.sqrt(sum(rx.map((v) => (v - mx) ** 2)) * sum(ry.map((v) => (v - my) ** 2))); const n = x.length, t = rho * Math.sqrt((n - 2) / (1 - rho * rho)), zf = Math.atanh(rho), se = 1 / Math.sqrt(n - 3); return { n, rho, p: pT2(t, n - 2), lo: Math.tanh(zf - Z * se), hi: Math.tanh(zf + Z * se) }; };
    const kruskal = (groups) => { const all = groups.flat(), N = all.length, { r, tie } = rank(all); let H = 0, i = 0; for (const g of groups) { const R = sum(r.slice(i, i + g.length)); H += R * R / g.length; i += g.length; } H = (12 / (N * (N + 1)) * H - 3 * (N + 1)) / (1 - tie / (N ** 3 - N)); const k = groups.length; return { n: N, H, k, p: gammq((k - 1) / 2, H / 2), eta2: (H - k + 1) / (N - k) }; };
    const signTest = (k, n) => { const pr = []; let pmf = Math.pow(0.5, n); for (let i = 0; i <= n; i++) { pr.push(pmf); pmf = pmf * (n - i) / (i + 1); } return Math.min(1, 2 * Math.min(sum(pr.slice(0, k + 1)), sum(pr.slice(k)))); };
    const fisher = (k1, n1, k2, n2) => { const N = n1 + n2, K = k1 + k2, lf = [0]; for (let i = 1; i <= N; i++) lf[i] = lf[i - 1] + Math.log(i); const lp = (a) => (lf[K] - lf[a] - lf[K - a]) + (lf[N - K] - lf[n1 - a] - lf[N - K - n1 + a]) - (lf[N] - lf[n1] - lf[N - n1]); const obs = lp(k1); let p = 0; for (let a = Math.max(0, K - n2); a <= Math.min(K, n1); a++) { const v = lp(a); if (v <= obs + 1e-7) p += Math.exp(v); } return Math.min(1, p); };
    const holm = (ps) => { const idx = ps.map((p, i) => [p, i]).filter((x) => x[0] != null).sort((a, b) => a[0] - b[0]); const m = idx.length, out = ps.map(() => null); let run = 0; idx.forEach(([p, i], rnk) => { run = Math.max(run, Math.min(1, (m - rnk) * p)); out[i] = run; }); return out; };
    const effectWord = (r) => { const a = Math.abs(r); return a < 0.1 ? 'negligible' : a < 0.3 ? 'small' : a < 0.5 ? 'medium' : 'large'; };
    const pText = (p) => (p == null ? 'not tested' : p < 0.001 ? '< .001' : p.toFixed(3).replace(/^0/, ''));
    const verdict = (p) => (p == null ? 'Too few answers to test' : p < 0.001 ? 'very unlikely to be chance' : p < 0.05 ? 'unlikely to be chance' : 'could be chance');
    const pc = (x) => Math.round(x * 100) + '%';
    const sg = (x, dp = 2) => { const v = Number(x.toFixed(dp)); return v === 0 ? (0).toFixed(dp) : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(dp); };

    /* ---------- data ---------- */
    const base = base_all.filter((r) => r.included);
    const stu = base.filter((r) => r.student), adu = base.filter((r) => !r.student);
    const out = [];
    const items = [['identify', 'Identify mental health crises'], ['describe', 'Describe 988 and how it works'], ['when', 'Know when to use 988']];

    /* Before/after per audience and item */
    for (const segment of [...new Set(base.flatMap((r) => r.segs))]) {
      const a = base.filter((r) => r.segs.includes(segment));
      for (const [k, item] of items) {
        const d = a.map((r) => r['post_' + k] - r['pre_' + k]);
        const [pre, prl, prh] = wilson(a.filter((r) => r['pre_' + k] >= 4).length, a.length);
        const [po, pol, poh] = wilson(a.filter((r) => r['post_' + k] >= 4).length, a.length);
        const [g, gl, gh] = meanCI(d), w = wilcoxon(d);
        out.push({ id: `item|${segment}|${k}`, kind: 'item', segment, item, n: a.length, pre_pct: pre, pre_lo: prl, pre_hi: prh, post_pct: po, post_lo: pol, post_hi: poh, estimate: g, lo: gl, hi: gh, p: w.p, effect: w.r, improved: w.improved, declined: w.declined });
      }
    }

    /* Sixteen program-wide tests (same as the workbook's Stats_Tests sheet) */
    const tests = [];
    const T = (o) => tests.push({ kind: 'test', ...o });
    items.forEach(([k, label], i) => {
      const d = base.map((r) => r['post_' + k] - r['pre_' + k]), w = wilcoxon(d), [m, lo, hi] = meanCI(d);
      T({ id: 'T' + (i + 1), question: `Did ratings rise on "${label}"?`, group: 'All participants', method: 'Wilcoxon signed-rank', n: w.n, estimate: m, lo, hi, est: 'gain', p: w.p, effect: w.r, effect_name: 'rank-biserial r', note: `${pc(w.improved)} rated themselves higher after, ${pc(w.declined)} lower.` });
    });
    [['T4', 'Students', stu], ['T5', 'Adults (non-students)', adu]].forEach(([id, group, a]) => {
      const d = a.map((r) => r.gain_avg), w = wilcoxon(d), [m, lo, hi] = meanCI(d);
      T({ id, question: 'Did the average knowledge rating rise?', group, method: 'Wilcoxon signed-rank', n: w.n, estimate: m, lo, hi, est: 'gain', p: w.p, effect: w.r, effect_name: 'rank-biserial r', note: `${pc(w.improved)} improved on average across the three items.` });
    });
    {
      const d = base.map((r) => r.gain_describe - r.gain_identify), w = wilcoxon(d), [m, lo, hi] = meanCI(d);
      T({ id: 'T6', question: 'Is the gain bigger on the 988-specific item than on general crisis recognition?', group: 'All participants', method: 'Wilcoxon signed-rank on the two gains', n: w.n, estimate: m, lo, hi, est: 'gain', p: w.p, effect: w.r, effect_name: 'rank-biserial r', note: 'Gains track what the training teaches, which argues against inflated before-ratings.' });
    }
    const rec = (a) => a.map((r) => r.recommend_0_10).filter((x) => x != null);
    {
      const a = rec(stu), b = rec(adu), m = mannWhitney(a, b), [d, lo, hi] = welch(a, b);
      T({ id: 'T7', question: 'Do students and adults differ in how likely they are to recommend the training?', group: 'Students vs adults', method: 'Mann-Whitney U', n: m.n, estimate: d, lo, hi, est: 'points', p: m.p, effect: m.r, effect_name: 'rank-biserial r', note: `Students average ${mean(a).toFixed(1)} of 10, adults ${mean(b).toFixed(1)}.` });
    }
    {
      const a = stu.map((r) => r.call_988_0_10).filter((x) => x != null), b = adu.map((r) => r.call_988_0_10).filter((x) => x != null);
      const t = twoProp(a.filter((x) => x >= 9).length, a.length, b.filter((x) => x >= 9).length, b.length);
      T({ id: 'T8', question: 'Do students and adults differ in being very likely (9–10) to call 988?', group: 'Students vs adults', method: 'Two-proportion z-test', n: t.n, estimate: t.d, lo: t.lo, hi: t.hi, est: 'pctdiff', p: t.p, effect: t.d, effect_name: 'difference', note: `${pc(a.filter((x) => x >= 9).length / a.length)} of students vs ${pc(b.filter((x) => x >= 9).length / b.length)} of adults (${b.length} adults asked).` });
    }
    {
      const a = stu.map((r) => r.gain_avg), b = adu.map((r) => r.gain_avg), m = mannWhitney(a, b), [d, lo, hi] = welch(a, b);
      T({ id: 'T9', question: 'Do students and adults gain different amounts of knowledge?', group: 'Students vs adults', method: 'Mann-Whitney U', n: m.n, estimate: d, lo, hi, est: 'gain', p: m.p, effect: m.r, effect_name: 'rank-biserial r', note: `Students gain ${sg(mean(a))}, adults ${sg(mean(b))} on the 1–5 scale.` });
    }
    const aa = stu.filter((r) => r.county === 'Anne Arundel'), pg = stu.filter((r) => r.county === "Prince George's");
    if (aa.length >= 10 && pg.length >= 10) {
      const a = rec(aa), b = rec(pg), m = mannWhitney(a, b), [d, lo, hi] = welch(a, b);
      T({ id: 'T10', question: "Among students only: do Anne Arundel and Prince George's differ in recommending?", group: "Students: Anne Arundel vs Prince George's", method: 'Mann-Whitney U', n: m.n, estimate: d, lo, hi, est: 'points', p: m.p, effect: m.r, effect_name: 'rank-biserial r', note: `Anne Arundel students average ${mean(a).toFixed(1)}, Prince George's ${mean(b).toFixed(1)}.` });
      const a2 = aa.map((r) => r.post_avg), b2 = pg.map((r) => r.post_avg), m2 = mannWhitney(a2, b2), [d2, lo2, hi2] = welch(a2, b2);
      T({ id: 'T11', question: 'Among students only: do the two counties end with different knowledge?', group: "Students: Anne Arundel vs Prince George's", method: 'Mann-Whitney U', n: m2.n, estimate: d2, lo: lo2, hi: hi2, est: 'points', p: m2.p, effect: m2.r, effect_name: 'rank-biserial r', note: `After-ratings average ${mean(a2).toFixed(2)} vs ${mean(b2).toFixed(2)}.` });
    }
    {
      const byRole = new Map(); base.forEach((r) => { if (!byRole.has(r.role)) byRole.set(r.role, []); byRole.get(r.role).push(r.gain_avg); });
      const groups = [...byRole.values()].filter((g) => g.length >= 10), k = kruskal(groups);
      T({ id: 'T12', question: 'Does knowledge gain differ across roles?', group: `${groups.length} roles with 10+ responses`, method: 'Kruskal-Wallis H', n: k.n, estimate: null, lo: null, hi: null, est: 'none', p: k.p, effect: k.eta2, effect_name: 'eta squared', note: 'Compares gains across students, staff, caregivers, community members and multi-role.' });
    }
    [['T13', 'deliv_engaged', 'presenter engagement'], ['T14', 'post_when', 'knowing when to use 988']].forEach(([id, col, label]) => {
      const a = base.filter((r) => r[col] != null && r.call_988_0_10 != null), s = spearman(a.map((r) => r[col]), a.map((r) => r.call_988_0_10));
      T({ id, question: `Is ${label} related to how likely people are to call 988?`, group: 'Answered both questions', method: 'Spearman rank correlation', n: s.n, estimate: s.rho, lo: s.lo, hi: s.hi, est: 'rho', p: s.p, effect: s.rho, effect_name: 'rho', note: `Correlation of ${s.rho.toFixed(2)} (${effectWord(s.rho)}).` });
    });
    {
      const by = new Map(); base.forEach((r) => { if (!by.has(r.session_id)) by.set(r.session_id, []); by.get(r.session_id).push(r.gain_avg); });
      const means = [...by.values()].filter((g) => g.length >= 10).map(mean), kpos = means.filter((m) => m > 0).length, [p, lo, hi] = wilson(kpos, means.length);
      T({ id: 'T15', question: 'Do sessions, not just people, show gains?', group: 'Sessions with 10+ responses', method: 'Sign test across sessions', n: means.length, estimate: p, lo, hi, est: 'share', p: means.length ? signTest(kpos, means.length) : null, effect: p, effect_name: 'share positive', note: `${kpos} of ${means.length} sessions show an average gain above zero.` });
    }
    {
      const a = base_all.filter((r) => r.has_knowledge), sd1 = (r) => r.post_identify === 1 && r.post_describe === 1 && r.post_when === 1;
      const sp = a.filter((r) => r.spanish_speaker), ot = a.filter((r) => !r.spanish_speaker);
      const k1 = sp.filter(sd1).length, k2 = ot.filter(sd1).length, t = twoProp(k1, sp.length, k2, ot.length);
      T({ id: 'T16', question: 'Do Spanish speakers mark every after-item "Strongly disagree" more often?', group: 'Spanish speakers vs others (all responses)', method: "Fisher's exact test", n: a.length, estimate: t.d, lo: t.lo, hi: t.hi, est: 'pctdiff', p: sp.length ? fisher(k1, sp.length, k2, ot.length) : null, effect: t.d, effect_name: 'difference', note: `${(100 * k1 / sp.length).toFixed(1)}% of Spanish speakers vs ${(100 * k2 / ot.length).toFixed(1)}% of others. Small numbers: a hint, not a finding.` });
    }
    const adj = holm(tests.map((t) => t.p));
    tests.forEach((t, i) => {
      const ci = t.lo == null ? '' : t.est === 'gain' || t.est === 'points' ? ` (${sg(t.lo)} to ${sg(t.hi)})` : t.est === 'rho' ? ` (${t.lo.toFixed(2)} to ${t.hi.toFixed(2)})` : ` (${sg(100 * t.lo, 0)} to ${sg(100 * t.hi, 0)} pts)`;
      const est = t.estimate == null ? '—' : t.est === 'gain' || t.est === 'points' ? sg(t.estimate) : t.est === 'rho' ? t.estimate.toFixed(2) : t.est === 'share' ? pc(t.estimate) : sg(100 * t.estimate, 0) + ' pts';
      out.push({ ...t, p_holm: adj[i], family: tests.length, p_text: pText(adj[i]), verdict: verdict(adj[i]), estimate_text: est + (t.est === 'share' ? ` (${pc(t.lo)}–${pc(t.hi)})` : ci), effect_text: t.effect == null ? '—' : t.effect_name === 'eta squared' ? `${t.effect.toFixed(3)} (${t.effect_name})` : t.effect_name === 'difference' || t.effect_name === 'share positive' ? t.effect_name : `${t.effect.toFixed(2)} ${t.effect_name}, ${effectWord(t.effect)}` });
    });

    /* Sensitivity: the gain under different data-quality rules */
    const scen = [
      ['S0', 'Default (likely reversed left out)', (r) => r.included],
      ['S1', 'Add back likely reversed answers', (r) => r.has_knowledge],
      ['S2', 'Drop people at top of scale before', (r) => r.included && !r.flag_ceiling],
      ['S3', 'Drop forms done in under 20 seconds', (r) => r.included && !r.flag_speeder],
      ['S4', 'Drop surveys sent 30+ days later', (r) => r.included && !r.flag_late_submission],
      ['S5', 'Only surveys done on the training day', (r) => r.included && r.days_to_submit === 0],
      ['S6', 'Drop same-answer-everywhere forms', (r) => r.included && !r.flag_straightliner],
    ];
    scen.forEach(([id, label, keep], order) => {
      const a = base_all.filter(keep), d = a.map((r) => r.gain_avg), [m, lo, hi] = meanCI(d), w = wilcoxon(d);
      const [pw, pwl, pwh] = wilson(a.filter((r) => r.post_when >= 4).length, a.length);
      out.push({ id, kind: 'scenario', order, label, n: a.length, estimate: m, lo, hi, p: w.p, pct_when: pw, pct_when_lo: pwl, pct_when_hi: pwh });
    });
    {
      const by = new Map(); base.forEach((r) => { if (!by.has(r.session_id)) by.set(r.session_id, []); by.get(r.session_id).push(r.gain_avg); });
      const means = [...by.values()].filter((g) => g.length >= 10).map(mean), [m, lo, hi] = meanCI(means);
      out.push({ id: 'S7', kind: 'scenario', order: 7, label: 'Each session counted once', n: means.length, estimate: m, lo, hi, p: null, pct_when: null, pct_when_lo: null, pct_when_hi: null });
    }

    /* Retrospective checks */
    const nochange = base.filter((r) => r.gain_identify === 0 && r.gain_describe === 0 && r.gain_when === 0).length / base.length;
    const decline = base.filter((r) => r.gain_identify < 0 || r.gain_describe < 0 || r.gain_when < 0).length / base.length;
    const sb = spearman(base.map((r) => r.pre_avg), base.map((r) => r.gain_avg));
    out.push({ id: 'retro_no_change', kind: 'retro', label: 'No change on all three items', estimate: nochange, n: base.length });
    out.push({ id: 'retro_any_decline', kind: 'retro', label: 'Lower after on at least one item', estimate: decline, n: base.length });
    out.push({ id: 'retro_before_gain', kind: 'retro', label: 'Rank correlation of before-rating with gain', estimate: sb.rho, p: sb.p, n: base.length });
    return out;
  },
});

dash.calc('funnel', {
  inputs: ['base'],
  title: 'From knowing to acting',
  description: 'Among people asked the call question: share who can describe 988, know when to use it, and are very likely to call, with Wilson 95% intervals.',
  fn: (base) => {
    const Z = 1.959963984540054;
    const wilson = (k, n) => { if (!n) return [null, null, null]; const p = k / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d; return [p, Math.max(0, c - h), Math.min(1, c + h)]; };
    const auds = [['All participants', () => true], ['Students', (r) => r.student], ['Adults', (r) => !r.student]];
    const stages = [['Can describe 988', (r) => r.post_describe >= 4], ['Know when to use 988', (r) => r.post_when >= 4], ['Very likely to call (9–10)', (r) => r.call_988_0_10 >= 9]];
    return auds.flatMap(([audience, inAud]) => {
      const a = base.filter((r) => inAud(r) && r.call_988_0_10 != null);
      return stages.map(([stage, test], order) => {
        const k = a.filter(test).length, [p, lo, hi] = a.length >= 10 ? wilson(k, a.length) : [null, null, null];
        return { key: `${audience}|${stage}`, audience, stage, order, n: a.length, k, pct: p, lo, hi };
      });
    });
  },
});

dash.calc('gain_by_start', {
  inputs: ['base'],
  title: 'Gain by starting level',
  description: 'Average knowledge gain grouped by how people rated themselves before training, per audience.',
  fn: (base) => {
    const bands = [['Low (1–2)', (p) => p <= 2], ['Below middle (2.3–3)', (p) => p > 2 && p <= 3], ['Middle (3.3–4)', (p) => p > 3 && p <= 4], ['High (4.3–4.7)', (p) => p > 4 && p < 5], ['Top of scale (5)', (p) => p === 5]];
    return [...new Set(base.flatMap((r) => r.segs))].flatMap((segment) => bands.map(([band, test]) => {
      const a = base.filter((r) => r.segs.includes(segment) && test(Math.round(r.pre_avg * 100) / 100));
      return { key: `${segment}|${band}`, segment, band, n: a.length, gain: a.length ? a.reduce((s, r) => s + r.gain_avg, 0) / a.length : null };
    }));
  },
});

dash.calc('call_dist', {
  inputs: ['base'],
  title: 'Call-intent distribution',
  description: 'Share of each audience answering 0–6, 7–8 and 9–10 on likelihood to call 988.',
  fn: (base) => {
    const groups = [['All participants', () => true], ['Students', (r) => r.student], ['Adults', (r) => !r.student]];
    const buckets = [['Unlikely (0–6)', (x) => x <= 6], ['Maybe (7–8)', (x) => x >= 7 && x <= 8], ['Very likely (9–10)', (x) => x >= 9]];
    return groups.flatMap(([audience, inGroup]) => {
      const xs = base.filter(inGroup).map((r) => r.call_988_0_10).filter((x) => x != null);
      return buckets.map(([bucket, test]) => ({ key: `${audience}|${bucket}`, audience, bucket, asked: xs.length, n: xs.filter(test).length, pct: xs.length ? xs.filter(test).length / xs.length : null }));
    });
  },
});

dash.calc('groups', {
  inputs: ['base'],
  title: 'Results by role, county and language',
  description: 'Outcome measures with 95% intervals for every role, county and language group, and for students by county. Groups under 10 responses show counts only.',
  fn: (base) => {
    const Z = 1.959963984540054;
    const wilson = (k, n) => { if (!n) return [null, null, null]; const p = k / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d; return [p, Math.max(0, c - h), Math.min(1, c + h)]; };
    const npsCI = (xs) => { const n = xs.length; if (!n) return [null, null, null]; const pro = xs.filter((x) => x >= 9).length / n, det = xs.filter((x) => x <= 6).length / n, v = pro - det, se = Math.sqrt(Math.max(0, pro + det - v * v) / n); return [v * 100, Math.max(-100, (v - Z * se) * 100), Math.min(100, (v + Z * se) * 100)]; };
    const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const dims = [['Role', base, (r) => r.role], ['County', base, (r) => r.county], ['Language', base, (r) => (r.spanish_speaker ? 'Spanish speakers' : 'English speakers')], ['Students by county', base.filter((r) => r.student), (r) => r.county]];
    return dims.flatMap(([dimension, rows, keyOf]) => [...new Set(rows.map(keyOf))].map((group) => {
      const a = rows.filter((r) => keyOf(r) === group), small = a.length < 10, v = (x) => (small ? null : x);
      const call = a.map((r) => r.call_988_0_10).filter((x) => x != null);
      const [pw, pwl, pwh] = wilson(a.filter((r) => r.post_when >= 4).length, a.length);
      const [nps, nl, nh] = npsCI(a.map((r) => r.recommend_0_10).filter((x) => x != null));
      const [pc, pcl, pch] = call.length >= 10 && !small ? wilson(call.filter((x) => x >= 9).length, call.length) : [null, null, null];
      return {
        key: `${dimension}: ${group}`, dimension, group, n: a.length, small,
        pre_avg: v(mean(a.map((r) => r.pre_avg))), post_avg: v(mean(a.map((r) => r.post_avg))), gain_avg: v(mean(a.map((r) => r.gain_avg))),
        pct_post_describe: v(a.filter((r) => r.post_describe >= 4).length / a.length), pct_post_when: v(pw), pct_post_when_lo: v(pwl), pct_post_when_hi: v(pwh),
        engaged: v(mean(a.map((r) => r.deliv_engaged).filter((x) => x != null))), nps: v(nps), nps_lo: v(nl), nps_hi: v(nh),
        n_call: call.length, pct_call_hi: pc, pct_call_hi_lo: pcl, pct_call_hi_hi: pch,
      };
    }).sort((x, y) => y.n - x.n));
  },
});

dash.calc('sessions', {
  inputs: ['base'],
  title: 'Results by session',
  description: 'Outcome measures per training session (training date plus county). Sessions under 10 responses show counts only.',
  fn: (base) => {
    const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const by = new Map(); base.forEach((r) => { if (!by.has(r.session_id)) by.set(r.session_id, []); by.get(r.session_id).push(r); });
    return [...by.keys()].sort().map((session_id) => {
      const a = by.get(session_id), ok = a.length >= 10, v = (x) => (ok ? x : null);
      const rec = a.map((r) => r.recommend_0_10).filter((x) => x != null), call = a.map((r) => r.call_988_0_10).filter((x) => x != null);
      return {
        session_id, date: a[0].training_date, county: a[0].county, n: a.length,
        pct_students: v(a.filter((r) => r.student).length / a.length), gain_avg: v(mean(a.map((r) => r.gain_avg))),
        pct_post_when: v(a.filter((r) => r.post_when >= 4).length / a.length), engaged: v(mean(a.map((r) => r.deliv_engaged).filter((x) => x != null))),
        nps: v(rec.length ? ((rec.filter((x) => x >= 9).length - rec.filter((x) => x <= 6).length) / rec.length) * 100 : null),
        n_call: call.length, pct_call_hi: ok && call.length >= 10 ? call.filter((x) => x >= 9).length / call.length : null,
      };
    });
  },
});

dash.calc('program', {
  inputs: ['base'],
  title: 'Program-wide counts',
  description: 'Share of students, and how many sessions with 10+ responses fall in the review zone (engagement under 4.0 or average gain under 0.5).',
  fn: (base) => {
    const by = new Map(); base.forEach((r) => { if (!by.has(r.session_id)) by.set(r.session_id, []); by.get(r.session_id).push(r); });
    let checked = 0, review = 0;
    for (const a of by.values()) {
      if (a.length < 10) continue;
      checked++;
      const g = a.reduce((s, r) => s + r.gain_avg, 0) / a.length, e = a.map((r) => r.deliv_engaged).filter((x) => x != null);
      const em = e.length ? e.reduce((s, x) => s + x, 0) / e.length : null;
      if ((em != null && em < 4.0) || g < 0.5) review++;
    }
    return [{ share_students: base.filter((r) => r.student).length / base.length, sessions_total: by.size, sessions_checked: checked, sessions_review: review }];
  },
});

dash.calc('impact', {
  inputs: ['base_all'],
  title: 'Impact measures',
  description: 'The action-plan measures for all data and for trainings in the last 90 days, with the proposed targets. Measures marked "Not collected yet" need new survey questions.',
  fn: (base_all) => {
    // [id, label, proposed target, which direction is better, action it belongs to]. Measures the current
    // form cannot collect are listed too, so the tracker shows what the new survey questions add.
    const MEASURES = [
      ['M1', 'Students very likely to call 988 (9–10)', 0.60, 'up', 'Priority 1'],
      ['M2', 'Gap between adults and students in very likely to call', 0.20, 'down', 'Priority 1'],
      ['M8', 'Agree "I can contact 988 even when I\'m not in a crisis"', 0.85, 'up', 'Priority 1'],
      ['M9', 'Agree "I know how to help someone connect to 988"', 0.85, 'up', 'Priority 1'],
      ['M3', 'Responses that include the "likely to call" question', 1.00, 'up', 'Priority 2'],
      ['M6', 'Responses that needed a data correction', 0.01, 'down', 'Priority 2'],
      ['M10', 'Responses with ZIP code or school recorded', 0.90, 'up', 'Priority 2'],
      ['M7', 'Spanish speakers who got the Spanish form', 0.80, 'up', 'Priority 3'],
      ['M11', 'Sessions held in priority neighborhoods', 0.50, 'up', 'Priority 3'],
      ['M4', 'Sessions (10+ responses) with engagement of 4.0 or more', 0.90, 'up', 'Priority 4'],
      ['M5', "Adults' share of participants", 0.25, 'up', 'Priority 5'],
    ];
    const share = (xs, test) => (xs.length ? xs.filter(test).length / xs.length : null);
    const calc = (all) => {
      const inc = all.filter((r) => r.included);
      const asked = (a) => a.filter((r) => r.call_988_0_10 != null);
      const s = asked(inc.filter((r) => r.student)), ad = asked(inc.filter((r) => !r.student));
      const hi = (a) => (a.length >= 10 ? share(a, (r) => r.call_988_0_10 >= 9) : null);
      const by = new Map(); inc.forEach((r) => { if (!by.has(r.session_id)) by.set(r.session_id, []); by.get(r.session_id).push(r); });
      const ses = [...by.values()].filter((a) => a.length >= 10).map((a) => a.map((r) => r.deliv_engaged).filter((x) => x != null)).filter((e) => e.length);
      const sp = inc.filter((r) => r.spanish_speaker);  // same people as the Spanish-speaker counts elsewhere
      return {
        M1: [hi(s), s.length], M2: [hi(s) != null && hi(ad) != null ? hi(ad) - hi(s) : null, s.length + ad.length],
        M3: [share(all, (r) => r.call_988_0_10 != null), all.length],
        M4: [ses.length ? ses.filter((e) => e.reduce((a, b) => a + b, 0) / e.length >= 4.0).length / ses.length : null, ses.length],
        M5: [share(inc, (r) => !r.student), inc.length], M6: [share(all, (r) => r.flag_needed_fix), all.length],
        M7: [sp.length >= 10 ? share(sp, (r) => r.language === 'Spanish') : null, sp.length],
      };
    };
    const dates = base_all.map((r) => r.training_date).filter(Boolean).sort();
    const last = dates[dates.length - 1], from = new Date(Date.parse(last) - 89 * 864e5).toISOString().slice(0, 10);
    const A = calc(base_all), R = calc(base_all.filter((r) => r.training_date && r.training_date >= from));
    const fmt = (v, id) => (v == null ? 'Too few answers' : id === 'M2' ? Math.round(v * 100) + ' pts' : Math.round(v * 100) + '%');
    return MEASURES.map(([measure, label, target, better, priority]) => {
      const target_text = (better === 'up' ? 'at least ' : 'at most ') + fmt(target, measure);
      if (!(measure in A)) {
        return { measure, label, target, better, priority, value: null, n: null, recent_value: null, recent_n: null, recent_from: from, recent_to: last, value_text: 'Not collected yet', recent_text: 'Not collected yet', target_text, status: 'Not collected yet' };
      }
      const [value, n] = A[measure], [recent_value, recent_n] = R[measure];
      const judged = recent_value != null ? recent_value : value;
      const meets = judged == null ? null : better === 'up' ? judged >= target : judged <= target;
      return {
        measure, label, target, better, priority, value, n, recent_value, recent_n, recent_from: from, recent_to: last,
        value_text: fmt(value, measure), recent_text: fmt(recent_value, measure), target_text,
        status: meets == null ? 'Not enough data' : meets ? 'Meets target' : 'Below target',
      };
    });
  },
});

dash.calc('spanish_by_county', {
  inputs: ['base'],
  title: 'Spanish speakers by county',
  description: 'Participants who answered the Spanish form or wrote comments in Spanish, and how many got the Spanish form, per county. Counties under 10 Spanish speakers are left out.',
  fn: (base) => {
    const by = new Map();
    base.filter((r) => r.spanish_speaker).forEach((r) => { if (!by.has(r.county)) by.set(r.county, []); by.get(r.county).push(r); });
    return [...by].filter(([, a]) => a.length >= 10).map(([county, a]) => ({ county, speakers: a.length, spanish_form: a.filter((r) => r.language === 'Spanish').length }));
  },
});

dash.calc('monthly', {
  inputs: ['base'],
  title: 'Gain by training month',
  description: 'Average knowledge gain per training month for students and adults.',
  fn: (base) => {
    const dated = base.filter((r) => r.month);
    return [...new Set(dated.map((r) => r.month))].sort().flatMap((month) => ['Students', 'Adults'].map((audience) => {
      const a = dated.filter((r) => r.month === month && (audience === 'Students') === r.student);
      return { key: `${month} ${audience}`, month, audience, n: a.length, gain_avg: a.length ? a.reduce((s, r) => s + r.gain_avg, 0) / a.length : null };
    }));
  },
});

dash.calc('themes', {
  inputs: ['base'],
  title: 'Comment themes by audience',
  description: 'How often each keyword theme appears among people who wrote each kind of comment.',
  fn: (base) => {
    const kinds = [['valuable', (r) => r.valuable !== '', (r) => r.valuable_themes], ['improve', (r) => r.improve !== '' && !r.improve_is_question, (r) => r.improve_themes], ['question', (r) => r.improve_is_question, (r) => r.question_topics]];
    const out = [];
    for (const segment of [...new Set(base.flatMap((r) => r.segs))]) {
      for (const [kind, has, themesOf] of kinds) {
        const a = base.filter((r) => r.segs.includes(segment) && has(r)), counts = new Map();
        for (const r of a) { const ts = (themesOf(r) || '').split('; ').filter(Boolean); for (const t of ts.length ? ts : ['Other / not coded']) counts.set(t, (counts.get(t) || 0) + 1); }
        for (const [theme, n] of counts) out.push({ key: `${segment}|${kind}|${theme}`, segment, kind, theme, n, writers: a.length, pct: n / a.length, general: theme.startsWith('General') || theme === 'Other / not coded' });
      }
    }
    return out;
  },
});

dash.calc('theme_coverage', {
  inputs: ['base'],
  title: 'Theme coverage',
  description: 'Share of comments of each kind that match at least one specific (not general) theme, per audience.',
  fn: (base) => {
    const kinds = [['valuable', (r) => r.valuable !== '', (r) => r.valuable_themes], ['improve', (r) => r.improve !== '' && !r.improve_is_question, (r) => r.improve_themes], ['question', (r) => r.improve_is_question, (r) => r.question_topics]];
    return [...new Set(base.flatMap((r) => r.segs))].flatMap((segment) => kinds.map(([kind, has, themesOf]) => {
      const a = base.filter((r) => r.segs.includes(segment) && has(r));
      const coded = a.filter((r) => (themesOf(r) || '').split('; ').some((t) => t && !t.startsWith('General'))).length;
      return { key: `${segment}|${kind}`, segment, kind, writers: a.length, coded, share: a.length ? coded / a.length : null };
    }));
  },
});

dash.calc('comments', {
  inputs: ['base'],
  title: 'Comments',
  description: 'Open-ended answers with names redacted, one row per comment.',
  fn: (base) => base.flatMap((r) => {
    const rows = [];
    if (r.valuable) rows.push({ cid: r.record_id + '-v', kind: 'Most valuable', text: r.valuable, themes: r.valuable_themes || 'Other / not coded', role: r.role, county: r.county, segs: r.segs });
    if (r.improve) rows.push({ cid: r.record_id + '-i', kind: r.improve_is_question ? 'Question' : 'Improve', text: r.improve, themes: (r.improve_is_question ? r.question_topics : r.improve_themes) || 'Other / not coded', role: r.role, county: r.county, segs: r.segs });
    return rows;
  }),
});

dash.calc('quality', {
  inputs: ['responses'],
  title: 'Data quality counts',
  description: 'Counts of each data-quality flag set by the cleaning script.',
  fn: (responses) => [{
    total: responses.length,
    reversed: responses.filter((r) => r.flag_likely_reversed).length,
    speeders: responses.filter((r) => r.flag_speeder).length,
    late: responses.filter((r) => r.flag_late_submission).length,
    straightliners: responses.filter((r) => r.flag_straightliner).length,
    ceiling: responses.filter((r) => r.flag_ceiling).length,
    needed_fix: responses.filter((r) => r.flag_needed_fix).length,
    call_answered: responses.filter((r) => r.call_988_0_10 != null).length,
    questions: responses.filter((r) => r.improve_is_question).length,
  }],
});

/* ===== Helpers for drawing ===== */
const F = {
  pct: d3.format('.0%'), int: d3.format(','), gain: (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2),
  nps: (x) => (Math.round(x) === 0 ? '0' : (x > 0 ? '+' : '−') + Math.abs(Math.round(x))), dec: d3.format('.2f'), one: d3.format('.1f'),
};
const fmt = (kind, v) => (v == null || Number.isNaN(v) ? '—' : kind && F[kind] ? F[kind](v) : String(v));
const pShort = (p) => (p == null ? 'not tested' : p < 0.001 ? 'p < .001' : 'p = ' + p.toFixed(3).replace(/^0/, ''));
const enc = (s) => String(s).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
const seg = () => dash.params().segment || 'All participants';
/* EveryMind brand colors, sampled from everymind.org and the logo */
const BR = { teal: '#5bb7b8', green: '#8cbf53', sky: '#7caabb', yellow: '#f7cd46', coral: '#e1765f', lime: '#bbd46d', gray: '#c3cbcd', ink: '#2b2b2b' };
const C = () => [BR.teal, BR.green, BR.sky, BR.yellow, BR.coral, BR.lime];
const ok = (id) => dash.data(id).status === 'ok';
const rowsOf = (id) => (ok(id) ? dash.data(id).data : []);
const findRow = (rows, el) => {
  if (el.dataset.row != null) return rows[Number(el.dataset.row)];
  const conds = (el.dataset.where || '').split('&').filter(Boolean).map((p) => p.split('=').map(decodeURIComponent));
  return rows.find((r) => conds.every(([k, v]) => String(r[k]) === v));
};

function tipFor(el) {
  const t = document.createElement('div');
  t.className = 'em-tip';
  t.hidden = true;
  el.appendChild(t);
  return {
    show(event, head, lines) {
      t.replaceChildren();
      const h = document.createElement('div');
      h.className = 'em-tip-h';
      h.textContent = head;
      t.appendChild(h);
      for (const l of lines) { const d = document.createElement('div'); d.textContent = l; t.appendChild(d); }
      t.hidden = false;
      const box = el.getBoundingClientRect();
      let x = event.clientX - box.left + 12, y = event.clientY - box.top + 12;
      if (x + t.offsetWidth > box.width) x = Math.max(0, event.clientX - box.left - t.offsetWidth - 12);
      if (y + t.offsetHeight > box.height) y = Math.max(0, event.clientY - box.top - t.offsetHeight - 12);
      t.style.left = x + 'px';
      t.style.top = y + 'px';
    },
    hide() { t.hidden = true; },
  };
}

function textWidth(svg, strings) {
  const probe = svg.append('text').attr('x', -9999).attr('y', -9999);
  let w = 0;
  for (const s of strings) { probe.text(s); w = Math.max(w, probe.node().getComputedTextLength()); }
  probe.remove();
  return w;
}
const axisStyle = (s) => s.attr('font-size', null).attr('font-family', null);
/* Ticks for a linear scale, halved until neighbours are at least minGap pixels apart. */
const thinTicks = (x, minGap = 48) => { for (let n = 10; n >= 2; n--) { const t = x.ticks(n); if (t.length < 2 || Math.abs(x(t[1]) - x(t[0])) >= minGap) return t; } const t = x.ticks(2); return t.length > 1 ? [t[0], t[t.length - 1]] : t; };
/* Shorten SVG labels that would run past maxW, keeping the full text for the tooltip. */
const fitText = (sel, maxW) => sel.each(function () {
  let t = this.textContent;
  while (this.getComputedTextLength() > maxW && t.length > 4) { t = t.slice(0, -2); this.textContent = t.trimEnd() + '…'; }
});
/* Soft left-to-right gradients in the brand colors, one per color per chart. */
let gradSeq = 0;
const fillCache = (svg) => {
  const defs = svg.append('defs'), made = new Map();
  return (color) => {
    if (!made.has(color)) {
      const id = `em-grad-${++gradSeq}`;
      const lg = defs.append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 1).attr('y1', 0).attr('y2', 0);
      lg.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.72);
      lg.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 1);
      made.set(color, `url(#${id})`);
    }
    return made.get(color);
  };
};
const gridStyle = (s) => { s.select('.domain').remove(); s.selectAll('line').style('stroke', 'var(--em-grid)'); };

/* Horizontal bars with optional 95% CI whiskers, background track and click handler. */
function hbar(el, rows, o) {
  el.replaceChildren();
  if (!rows.length) return;
  const W = Math.max(260, el.clientWidth), rowH = 32, barH = 14, H = rows.length * rowH + 26, yMid = rowH / 2 - 2;
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const fill = fillCache(svg);
  const valW = textWidth(svg, rows.map((r) => o.valueLabel(r))) + 12;
  const ext = rows.flatMap((r) => [r.value, r.lo ?? r.value, r.hi ?? r.value]);
  const lo = Math.min(0, d3.min(ext)), hi = Math.max(0, d3.max(ext));
  // Keep about a third of the width for the bars; long labels shorten (with an ellipsis) to make room.
  // Value labels always sit to the right of the zero line, so negative bars need no extra room on the left.
  const labW = Math.max(56, Math.min(W * (o.labMax || 0.46), textWidth(svg, rows.map((r) => r.label)) + 14, W - valW - Math.min(150, W * 0.3)));
  const x = d3.scaleLinear().domain(o.domain || [lo, hi]).range([labW, W - valW]);
  if (!o.domain) x.nice();
  const tip = tipFor(el);
  const colorOf = (d) => (d.muted ? BR.gray : o.highlight && d.emph ? BR.yellow : d.value < 0 ? BR.coral : BR.teal);
  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 4).attr('y2', H - 20).style('stroke', 'var(--em-muted)').style('opacity', 0.45);
  const g = svg.selectAll('g.r').data(rows).join('g').attr('transform', (d, i) => `translate(0, ${i * rowH + 6})`);
  if (o.track) g.append('rect').attr('x', x.range()[0]).attr('y', yMid - barH / 2).attr('width', x.range()[1] - x.range()[0]).attr('height', barH).attr('rx', barH / 2).style('fill', 'var(--em-track)');
  g.append('text').attr('class', (d) => (d.emph ? 'em-strong' : 'em-lab')).attr('x', labW - 10).attr('y', yMid).attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
    .text((d) => d.label).call(fitText, labW - 12);
  g.append('rect').attr('class', o.onClick ? 'em-click' : null)
    .attr('x', (d) => x(Math.min(0, d.value))).attr('y', yMid - barH / 2).attr('height', barH).attr('rx', barH / 2)
    .attr('width', (d) => Math.max(2, Math.abs(x(d.value) - x(0))))
    .style('fill', (d) => fill(colorOf(d)))
    .on('mousemove', (e, d) => tip.show(e, d.label, o.tipLines(d))).on('mouseleave', () => tip.hide())
    .on('click', (e, d) => o.onClick && o.onClick(d));
  const wh = g.filter((d) => d.lo != null && d.hi != null);
  wh.append('line').attr('x1', (d) => x(d.lo)).attr('x2', (d) => x(d.hi)).attr('y1', yMid).attr('y2', yMid).style('stroke', 'var(--em-ink)').style('stroke-width', 1.5).style('opacity', 0.5);
  wh.selectAll('line.cap').data((d) => [d.lo, d.hi]).join('line').attr('class', 'cap').attr('x1', (v) => x(v)).attr('x2', (v) => x(v)).attr('y1', yMid - 5).attr('y2', yMid + 5).style('stroke', 'var(--em-ink)').style('stroke-width', 1.5).style('opacity', 0.5);
  g.append('text').attr('class', 'em-strong').attr('y', yMid).attr('dominant-baseline', 'middle')
    .attr('x', (d) => x(Math.max(0, d.value, d.hi ?? d.value)) + 6).attr('text-anchor', 'start').text((d) => o.valueLabel(d));
  const ticks = thinTicks(x);
  svg.append('g').attr('transform', `translate(0, ${H - 18})`).call(d3.axisBottom(x).tickValues(ticks).tickFormat(o.tickFormat).tickSize(0)).call(axisStyle).call((s) => s.select('.domain').remove());
}

/* ===== Drawings ===== */
dash.draw('const', (el) => {
  const v = window.EM[el.dataset.const];
  el.textContent = v == null ? '—' : v % 1 ? v.toFixed(1) : String(v);
});

dash.draw('kpi', (el) => {
  el.dataset.where = 'segment=' + enc(seg());
  const row = rowsOf(el.dataset.source).find((r) => r.segment === seg());
  el.textContent = row ? fmt(el.dataset.fmt, row[el.dataset.field]) : '—';
});

dash.draw('val', (el) => {
  const row = findRow(rowsOf(el.dataset.source), el);
  el.textContent = row ? fmt(el.dataset.fmt, row[el.dataset.field]) : '—';
});

dash.draw('cov', (el) => {
  el.dataset.where = 'key=' + enc(`${seg()}|${el.dataset.kind}`);
  const row = rowsOf('theme_coverage').find((r) => r.segment === seg() && r.kind === el.dataset.kind);
  el.textContent = row ? fmt('pct', row.share) : '—';
});

dash.draw('status', (el) => {
  const row = findRow(rowsOf('impact'), el);
  el.textContent = row ? row.status : '—';
  el.classList.remove('ok', 'bad', 'muted');
  if (row) el.classList.add(row.status === 'Meets target' ? 'ok' : row.status === 'Below target' ? 'bad' : 'muted');
});

dash.draw('dumbbell', (el) => {
  el.replaceChildren();
  const rows = rowsOf('stats').filter((r) => r.kind === 'item' && r.segment === seg());
  if (!rows.length) return;
  const W = Math.max(260, el.clientWidth);
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('role', 'img');
  const statText = (d) => `${fmt('gain', d.estimate)} · ${pShort(d.p)}`;
  // Put the test result beside the item name when it fits, otherwise on its own line underneath
  const wide = textWidth(svg, rows.map((d) => d.item)) + textWidth(svg, rows.map(statText)) + 56 < W;
  const rowH = wide ? 58 : 74, H = rows.length * rowH + 26, dotY = 36;
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  const x = d3.scaleLinear().domain([0, 1]).range([40, W - 50]);
  const tip = tipFor(el);
  const defs = svg.append('defs'), gid = `em-db-${++gradSeq}`;
  rows.forEach((d, i) => {
    const lg = defs.append('linearGradient').attr('id', `${gid}-${i}`).attr('gradientUnits', 'userSpaceOnUse').attr('x1', x(d.pre_pct)).attr('x2', x(d.post_pct)).attr('y1', 0).attr('y2', 0);
    lg.append('stop').attr('offset', '0%').attr('stop-color', BR.gray);
    lg.append('stop').attr('offset', '100%').attr('stop-color', BR.teal);
  });
  svg.append('g').selectAll('line').data([0, 0.25, 0.5, 0.75, 1]).join('line').attr('x1', (d) => x(d)).attr('x2', (d) => x(d)).attr('y1', 0).attr('y2', H - 22).style('stroke', 'var(--em-grid)');
  const g = svg.selectAll('g.r').data(rows).join('g').attr('transform', (d, i) => `translate(0, ${i * rowH})`);
  g.append('text').attr('x', 16).attr('y', 13).attr('class', 'em-strong').text((d) => d.item).call(fitText, W - 32);
  g.append('text').attr('x', wide ? W - 16 : 16).attr('y', wide ? 13 : dotY + 24).attr('text-anchor', wide ? 'end' : 'start').text(statText);
  g.append('line').attr('x1', (d) => x(d.pre_pct)).attr('x2', (d) => x(d.post_pct)).attr('y1', dotY).attr('y2', dotY).style('stroke', (d, i) => `url(#${gid}-${i})`).style('stroke-width', 5).style('stroke-linecap', 'round');
  g.append('circle').attr('cx', (d) => x(d.post_pct)).attr('cy', dotY).attr('r', 13).style('fill', BR.teal).style('opacity', 0.16);
  g.append('circle').attr('cx', (d) => x(d.pre_pct)).attr('cy', dotY).attr('r', 6).style('fill', 'var(--color-panel)').style('stroke', BR.gray).style('stroke-width', 2.5);
  g.append('circle').attr('cx', (d) => x(d.post_pct)).attr('cy', dotY).attr('r', 7.5).style('fill', BR.teal).style('stroke', 'var(--color-panel)').style('stroke-width', 2.5);
  g.append('text').attr('x', (d) => x(d.pre_pct) - 12).attr('y', dotY).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').text((d) => F.pct(d.pre_pct));
  g.append('text').attr('class', 'em-post').attr('y', dotY).attr('dominant-baseline', 'middle')
    .attr('x', (d) => x(d.post_pct) + 15).attr('text-anchor', 'start').text((d) => F.pct(d.post_pct));
  g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH).style('fill', 'transparent')
    .on('mousemove', (e, d) => tip.show(e, d.item, [`Before: ${F.pct(d.pre_pct)} agree (95% CI ${F.pct(d.pre_lo)}–${F.pct(d.pre_hi)})`, `After: ${F.pct(d.post_pct)} agree (95% CI ${F.pct(d.post_lo)}–${F.pct(d.post_hi)})`, `Gain: ${fmt('gain', d.estimate)} (95% CI ${fmt('gain', d.lo)} to ${fmt('gain', d.hi)})`, `${F.pct(d.improved)} rated higher, ${F.pct(d.declined)} lower`, `Responses: ${F.int(d.n)}`]))
    .on('mouseleave', () => tip.hide());
  svg.append('g').attr('transform', `translate(0, ${H - 18})`).call(d3.axisBottom(x).tickValues([0, 0.25, 0.5, 0.75, 1]).tickFormat(F.pct).tickSize(0)).call(axisStyle).call((s) => s.select('.domain').remove());
});

dash.draw('funnel', (el) => {
  el.replaceChildren();
  const rows = rowsOf('funnel').filter((r) => r.audience !== 'All participants');
  if (!rows.length) return;
  const stages = [...new Set(rows.map((r) => r.stage))], auds = ['Students', 'Adults'];
  const W = Math.max(260, el.clientWidth), barH = 16, groupH = 2 * barH + 34, H = stages.length * groupH + 24;
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const fill = fillCache(svg);
  const labW = Math.min(W * 0.4, textWidth(svg, auds.map((a) => `${a} (n=${F.int(rows.find((r) => r.audience === a).n)})`)) + 14);
  const x = d3.scaleLinear().domain([0, 1]).range([labW, W - 46]);
  const tip = tipFor(el);
  stages.forEach((stage, si) => {
    const g = svg.append('g').attr('transform', `translate(0, ${si * groupH})`);
    g.append('text').attr('x', labW).attr('y', 12).attr('class', 'em-strong').text(stage);
    auds.forEach((aud, ai) => {
      const r = rows.find((d) => d.audience === aud && d.stage === stage);
      if (!r || r.pct == null) return;
      const y = 22 + ai * (barH + 5);
      g.append('text').attr('class', 'em-lab').attr('x', labW - 10).attr('y', y + barH / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').text(si === 0 ? `${aud} (n=${F.int(r.n)})` : aud).call(fitText, labW - 12);
      g.append('rect').attr('x', x(0)).attr('y', y).attr('width', x(1) - x(0)).attr('height', barH).attr('rx', barH / 2).style('fill', 'var(--em-track)');
      g.append('rect').attr('x', x(0)).attr('y', y).attr('width', Math.max(2, x(r.pct) - x(0))).attr('height', barH).attr('rx', barH / 2).style('fill', fill(C()[ai]))
        .on('mousemove', (e) => tip.show(e, `${aud} · ${stage}`, [`${F.pct(r.pct)} (${F.int(r.k)} of ${F.int(r.n)})`, `95% CI ${F.pct(r.lo)}–${F.pct(r.hi)}`])).on('mouseleave', () => tip.hide());
      g.append('line').attr('x1', x(r.lo)).attr('x2', x(r.hi)).attr('y1', y + barH / 2).attr('y2', y + barH / 2).style('stroke', 'var(--em-ink)').style('stroke-width', 1.5).style('opacity', 0.5);
      g.append('text').attr('x', x(Math.max(r.pct, r.hi)) + 6).attr('y', y + barH / 2).attr('dominant-baseline', 'middle').attr('class', 'em-strong').text(F.pct(r.pct));
    });
  });
  svg.append('g').attr('transform', `translate(0, ${H - 18})`).call(d3.axisBottom(x).tickValues([0, 0.25, 0.5, 0.75, 1]).tickFormat(F.pct).tickSize(0)).call(axisStyle).call((s) => s.select('.domain').remove());
});

dash.draw('calldist', (el) => {
  el.replaceChildren();
  const rows = rowsOf('call_dist');
  if (!rows.length) return;
  const auds = [...new Set(rows.map((r) => r.audience))], buckets = ['Unlikely (0–6)', 'Maybe (7–8)', 'Very likely (9–10)'];
  const colors = [BR.coral, BR.yellow, BR.green];
  const W = Math.max(260, el.clientWidth), rowH = 42, H = auds.length * rowH + 4;
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const labels = auds.map((a) => `${a} (n=${F.int(rows.find((r) => r.audience === a).asked)})`);
  const labW = Math.min(W * 0.45, textWidth(svg, labels) + 14), x = d3.scaleLinear().domain([0, 1]).range([labW, W - 2]);
  const tip = tipFor(el);
  auds.forEach((a, i) => {
    const g = svg.append('g').attr('transform', `translate(0, ${i * rowH})`);
    g.append('text').attr('class', 'em-lab').attr('x', labW - 10).attr('y', rowH / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').text(labels[i]).call(fitText, labW - 12);
    let acc = 0;
    buckets.forEach((b, j) => {
      const r = rows.find((d) => d.audience === a && d.bucket === b);
      if (!r || r.pct == null) return;
      const x0 = x(acc), w = Math.max(0, x(acc + r.pct) - x0 - 3);
      g.append('rect').attr('x', x0).attr('y', 8).attr('width', w).attr('height', rowH - 16).attr('rx', 8).style('fill', colors[j])
        .on('mousemove', (e) => tip.show(e, a, [`${b}: ${F.pct(r.pct)}`, `${F.int(r.n)} of ${F.int(r.asked)} asked`])).on('mouseleave', () => tip.hide());
      if (w > 34) g.append('text').attr('x', x0 + w / 2).attr('y', rowH / 2).attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').style('fill', BR.ink).style('font-weight', 600).style('pointer-events', 'none').text(F.pct(r.pct));
      acc += r.pct;
    });
  });
});

let commentTheme = null, commentQuery = '', commentKind = '';
const pickTheme = (kind, theme) => {
  commentTheme = theme;
  commentKind = { valuable: 'Most valuable', improve: 'Improve', question: 'Question' }[kind];
  document.querySelectorAll('#em-kind').forEach((s) => { s.value = commentKind; });
  document.querySelectorAll('#theme-chip').forEach((b) => { b.hidden = false; });
  dash.draw('theme-chip'); dash.draw('comments-body'); dash.draw('comment-count');
  document.querySelectorAll('#card-comments-table').forEach((c) => c.scrollIntoView({ behavior: 'smooth', block: 'start' }));
};
const themeRows = (kind) => rowsOf('themes').filter((r) => r.segment === seg() && r.kind === kind)
  .sort((a, b) => a.general - b.general || b.n - a.n)
  .map((r) => ({ label: r.theme, value: r.pct, n: r.n, writers: r.writers, muted: r.general, kind }));
const HBARS = {
  gainstart: () => rowsOf('gain_by_start').filter((r) => r.segment === seg() && r.n > 0).map((r) => ({ label: r.band, value: r.gain, n: r.n, muted: r.n < window.EM.MIN_N })),
  groups_nps: () => rowsOf('groups').filter((r) => r.nps != null && (r.dimension === 'Role' || r.dimension === 'County')).map((r) => ({ label: `${r.group} (${r.dimension.toLowerCase()})`, value: r.nps, lo: r.nps_lo, hi: r.nps_hi, n: r.n, emph: r.group === 'Student' })),
  groups_call: () => rowsOf('groups').filter((r) => r.pct_call_hi != null && (r.dimension === 'Role' || r.dimension === 'County')).map((r) => ({ label: `${r.group} (${r.dimension.toLowerCase()})`, value: r.pct_call_hi, lo: r.pct_call_hi_lo, hi: r.pct_call_hi_hi, n: r.n_call, emph: r.group === 'Student' })),
  theme_valuable: () => themeRows('valuable'),
  theme_improve: () => themeRows('improve'),
  theme_question: () => themeRows('question'),
};
const themeOpts = (noun) => ({ labMax: 0.62, valueLabel: (d) => F.pct(d.value), tickFormat: F.pct, onClick: (d) => pickTheme(d.kind, d.label), tipLines: (d) => [`${F.int(d.n)} of ${F.int(d.writers)} ${noun}`, 'Click to read them'] });
const HBAR_OPTS = {
  gainstart: { valueLabel: (d) => `${fmt('gain', d.value)}  (n=${F.int(d.n)})`, tickFormat: (v) => fmt('gain', v).replace(/0$/, ''), tipLines: (d) => [`Average gain: ${fmt('gain', d.value)}`, `Responses: ${F.int(d.n)}`] },
  groups_nps: { highlight: true, domain: [-100, 100], valueLabel: (d) => fmt('nps', d.value), tickFormat: (v) => fmt('nps', v), tipLines: (d) => [`Recommend NPS: ${fmt('nps', d.value)}`, `95% CI ${fmt('nps', d.lo)} to ${fmt('nps', d.hi)}`, `Responses: ${F.int(d.n)}`] },
  groups_call: { highlight: true, track: true, domain: [0, 1], valueLabel: (d) => `${F.pct(d.value)} (n=${F.int(d.n)})`, tickFormat: F.pct, tipLines: (d) => [`Very likely to call: ${F.pct(d.value)}`, `95% CI ${F.pct(d.lo)}–${F.pct(d.hi)}`, `Asked: ${F.int(d.n)}`] },
  theme_valuable: themeOpts('comments'),
  theme_improve: themeOpts('suggestions'),
  theme_question: themeOpts('questions'),
};
dash.draw('hbar', (el) => {
  const which = el.dataset.hbar;
  hbar(el, HBARS[which](), HBAR_OPTS[which]);
});

dash.draw('robust', (el) => {
  el.replaceChildren();
  const rows = rowsOf('stats').filter((r) => r.kind === 'scenario' && r.estimate != null).sort((a, b) => a.order - b.order);
  if (!rows.length) return;
  const W = Math.max(260, el.clientWidth), rowH = 34, H = rows.length * rowH + 26;
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const labels = rows.map((r) => `${r.label} (n=${F.int(r.n)})`);
  const labW = Math.min(W * 0.55, textWidth(svg, labels) + 14);
  const x = d3.scaleLinear().domain([0, Math.max(1.4, d3.max(rows, (r) => r.hi))]).range([labW, W - 50]).nice();
  const tip = tipFor(el);
  const colorOf = (d) => (d.id === 'S0' ? BR.green : BR.teal);
  svg.append('g').selectAll('line').data(thinTicks(x)).join('line').attr('x1', (d) => x(d)).attr('x2', (d) => x(d)).attr('y1', 0).attr('y2', H - 20).style('stroke', 'var(--em-grid)');
  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', H - 20).style('stroke', 'var(--em-muted)').style('opacity', 0.5);
  const g = svg.selectAll('g.r').data(rows).join('g').attr('transform', (d, i) => `translate(0, ${i * rowH + 4})`);
  g.append('text').attr('x', labW - 10).attr('y', rowH / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').attr('class', (d) => (d.id === 'S0' ? 'em-strong' : 'em-lab')).text((d) => labels[rows.indexOf(d)]).call(fitText, labW - 12);
  g.append('line').attr('x1', (d) => x(d.lo)).attr('x2', (d) => x(d.hi)).attr('y1', rowH / 2).attr('y2', rowH / 2).style('stroke', colorOf).style('stroke-width', 4).style('stroke-linecap', 'round').style('opacity', 0.9);
  g.append('circle').attr('cx', (d) => x(d.estimate)).attr('cy', rowH / 2).attr('r', 6).style('fill', 'var(--color-panel)').style('stroke', colorOf).style('stroke-width', 3);
  g.append('text').attr('class', 'em-strong').attr('x', (d) => x(d.hi) + 8).attr('y', rowH / 2).attr('dominant-baseline', 'middle').text((d) => fmt('gain', d.estimate));
  g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH).style('fill', 'transparent')
    .on('mousemove', (e, d) => tip.show(e, d.label, [`Average gain: ${fmt('gain', d.estimate)} (95% CI ${fmt('gain', d.lo)} to ${fmt('gain', d.hi)})`, d.pct_when == null ? 'Sessions weighted equally' : `Know when to use 988 after: ${F.pct(d.pct_when)}`, `n = ${F.int(d.n)}`]))
    .on('mouseleave', () => tip.hide());
  svg.append('g').attr('transform', `translate(0, ${H - 18})`).call(d3.axisBottom(x).tickValues(thinTicks(x)).tickFormat((v) => fmt('gain', v).replace(/0$/, '')).tickSize(0)).call(axisStyle).call((s) => s.select('.domain').remove());
});

dash.draw('scatter', (el) => {
  el.replaceChildren();
  const E = window.EM;
  const rows = rowsOf('sessions').filter((r) => r.n >= E.MIN_N && r.engaged != null);
  if (!rows.length) return;
  const W = Math.max(260, el.clientWidth), H = 320, m = { t: 12, r: 16, b: 38, l: 44 };
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const x = d3.scaleLinear().domain([Math.min(0, d3.min(rows, (d) => d.gain_avg)), Math.max(2, d3.max(rows, (d) => d.gain_avg))]).nice().range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([Math.min(3.4, d3.min(rows, (d) => d.engaged)), 5]).nice().range([H - m.b, m.t]);
  const r = d3.scaleSqrt().domain([0, d3.max(rows, (d) => d.n)]).range([0, 17]);
  const tip = tipFor(el);
  svg.append('rect').attr('x', m.l).attr('y', y(E.ENG_MIN)).attr('width', W - m.r - m.l).attr('height', H - m.b - y(E.ENG_MIN)).style('fill', BR.coral).style('opacity', 0.1);
  svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', Math.max(0, x(E.GAIN_MIN) - m.l)).attr('height', y(E.ENG_MIN) - m.t).style('fill', BR.coral).style('opacity', 0.1);
  svg.append('g').attr('transform', `translate(0, ${H - m.b})`).call(d3.axisBottom(x).tickValues(thinTicks(x)).tickFormat((v) => fmt('gain', v).replace(/0$/, '')).tickSize(-(H - m.b - m.t))).call(axisStyle).call(gridStyle);
  svg.append('g').attr('transform', `translate(${m.l}, 0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.1f')).tickSize(-(W - m.l - m.r))).call(axisStyle).call(gridStyle);
  for (const [x1, x2, y1, y2] of [[x(E.GAIN_MIN), x(E.GAIN_MIN), m.t, H - m.b], [m.l, W - m.r, y(E.ENG_MIN), y(E.ENG_MIN)]]) {
    svg.append('line').attr('x1', x1).attr('x2', x2).attr('y1', y1).attr('y2', y2).style('stroke', BR.coral).style('opacity', 0.6).style('stroke-width', 1.5).style('stroke-dasharray', '5 4');
  }
  svg.append('text').attr('x', W - m.r).attr('y', H - 4).attr('text-anchor', 'end').text('Average knowledge gain →');
  svg.append('text').attr('transform', `translate(14, ${m.t}) rotate(-90)`).attr('text-anchor', 'end').text('Presenter engagement (1–5) →');
  svg.append('text').attr('class', 'em-zone').attr('x', m.l + 8).attr('y', H - m.b - 8).text('Review zone');
  svg.selectAll('circle.s').data([...rows].sort((a, b) => b.n - a.n)).join('circle')
    .attr('cx', (d) => x(d.gain_avg)).attr('cy', (d) => y(d.engaged)).attr('r', (d) => Math.max(4.5, r(d.n)))
    .style('fill', (d) => (d.pct_students >= 0.5 ? BR.teal : BR.green)).style('fill-opacity', 0.85).style('stroke', 'var(--color-panel)').style('stroke-width', 2)
    .on('mousemove', (e, d) => tip.show(e, d.session_id, [`Responses: ${F.int(d.n)} (${F.pct(d.pct_students)} students)`, `Average gain: ${fmt('gain', d.gain_avg)}`, `Engagement: ${F.dec(d.engaged)}`, `Recommend NPS: ${fmt('nps', d.nps)}`]))
    .on('mouseleave', () => tip.hide());
});

dash.draw('monthly', (el) => {
  el.replaceChildren();
  const E = window.EM;
  const rows = rowsOf('monthly').map((r) => ({ ...r, date: new Date(r.month + '-01T00:00:00Z') }));
  const valid = rows.filter((r) => r.n >= E.MIN_N);
  if (!valid.length) return;
  const W = Math.max(260, el.clientWidth), H = 320, m = { t: 14, r: 76, b: 30, l: 40 };
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const x = d3.scaleUtc(d3.extent(rows, (d) => d.date), [m.l + 26, W - m.r]);
  const y = d3.scaleLinear([0, Math.max(2, d3.max(valid, (d) => d.gain_avg))], [H - m.b, m.t]).nice();
  const tip = tipFor(el);
  const defs = svg.append('defs');
  svg.append('g').attr('transform', `translate(${m.l}, 0)`).call(d3.axisLeft(y).ticks(4).tickFormat((v) => fmt('gain', v).replace(/0$/, '')).tickSize(-(W - m.l - m.r))).call(axisStyle).call(gridStyle);
  svg.append('g').attr('transform', `translate(0, ${H - m.b})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 90))).tickFormat(d3.utcFormat('%b %y')).tickSize(0).tickPadding(8)).call(axisStyle).call((s) => s.select('.domain').style('stroke', 'var(--em-line)'));
  const ends = [];
  ['Students', 'Adults'].forEach((aud, i) => {
    const pts = valid.filter((r) => r.audience === aud).sort((a, b) => a.date - b.date);
    if (!pts.length) return;
    const gid = `em-area-${++gradSeq}`;
    const lg = defs.append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    [[0, 0.26], [0.65, 0.08], [1, 0]].forEach(([o, a]) => lg.append('stop').attr('offset', o).attr('stop-color', C()[i]).attr('stop-opacity', a));
    svg.append('path').datum(pts).attr('d', d3.area().x((d) => x(d.date)).y0(y(0)).y1((d) => y(d.gain_avg))).style('fill', `url(#${gid})`);
    svg.append('path').datum(pts).attr('d', d3.line().x((d) => x(d.date)).y((d) => y(d.gain_avg))).style('fill', 'none').style('stroke', C()[i]).style('stroke-width', 2.75).style('stroke-linejoin', 'round').style('stroke-linecap', 'round');
    svg.selectAll(null).data(pts).join('circle').attr('cx', (d) => x(d.date)).attr('cy', (d) => y(d.gain_avg)).attr('r', 4.5).style('fill', 'var(--color-panel)').style('stroke', C()[i]).style('stroke-width', 2.5)
      .on('mousemove', (e, d) => tip.show(e, `${d3.utcFormat('%B %Y')(d.date)} · ${aud}`, [`Average gain: ${fmt('gain', d.gain_avg)}`, `Responses: ${F.int(d.n)}`])).on('mouseleave', () => tip.hide());
    const last = pts[pts.length - 1];
    ends.push({ y: y(last.gain_avg), text: aud, cls: i ? 'em-end-green' : 'em-end-teal' });
  });
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  for (const e of ends) svg.append('text').attr('class', e.cls).attr('x', W - m.r + 10).attr('y', e.y).attr('dominant-baseline', 'middle').text(e.text);
});

/* ===== Tables ===== */
const td = (tr, text, cls) => { const c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; tr.appendChild(c); return c; };
const flagEl = (cell, text, cls) => { const s = document.createElement('span'); s.className = 'em-flag ' + cls; s.textContent = text; cell.appendChild(s); };

dash.draw('impact-body', (el) => {
  el.replaceChildren();
  for (const r of rowsOf('impact')) {
    const tr = document.createElement('tr');
    tr.dataset.key = r.measure;
    td(tr, r.priority); td(tr, r.label, 'em-wide'); td(tr, r.value_text, 'em-num'); td(tr, fmt('int', r.n), 'em-num em-hide-narrow'); td(tr, r.recent_text, 'em-num'); td(tr, fmt('int', r.recent_n), 'em-num em-hide-narrow'); td(tr, r.target_text, 'em-num');
    const s = td(tr, '');
    flagEl(s, r.status, r.status === 'Meets target' ? 'ok' : r.status === 'Below target' ? 'bad' : 'muted');
    el.appendChild(tr);
  }
});

const groupRow = (el, r, cols) => {
  const tr = document.createElement('tr');
  tr.dataset.key = r.key;
  if (r.small) tr.className = 'em-muted';
  cols.forEach(([field, kind]) => td(tr, kind ? fmt(kind, r[field]) : String(r[field]), kind ? 'em-num' : null));
  el.appendChild(tr);
};
dash.draw('groups-body', (el) => {
  el.replaceChildren();
  for (const r of rowsOf('groups').filter((g) => g.dimension !== 'Students by county')) {
    groupRow(el, r, [['dimension'], ['group'], ['n', 'int'], ['pre_avg', 'dec'], ['post_avg', 'dec'], ['gain_avg', 'gain'], ['pct_post_describe', 'pct'], ['pct_post_when', 'pct'], ['engaged', 'dec'], ['nps', 'nps'], ['pct_call_hi', 'pct'], ['n_call', 'int']]);
  }
});
dash.draw('county-body', (el) => {
  el.replaceChildren();
  for (const r of rowsOf('groups').filter((g) => g.dimension === 'Students by county')) {
    groupRow(el, r, [['group'], ['n', 'int'], ['post_avg', 'dec'], ['gain_avg', 'gain'], ['nps', 'nps'], ['engaged', 'dec']]);
  }
});

let sortKey = 'session_id', sortDir = -1;
dash.draw('sessions-body', (el) => {
  el.replaceChildren();
  const E = window.EM;
  const rows = [...rowsOf('sessions')].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
  });
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.dataset.key = r.session_id;
    const enough = r.n >= E.MIN_N;
    if (!enough) tr.className = 'em-muted';
    td(tr, r.session_id); td(tr, F.int(r.n), 'em-num'); td(tr, fmt('pct', r.pct_students), 'em-num em-hide-narrow');
    td(tr, fmt('gain', r.gain_avg), 'em-num'); td(tr, fmt('pct', r.pct_post_when), 'em-num em-hide-narrow');
    td(tr, fmt('dec', r.engaged), 'em-num'); td(tr, fmt('nps', r.nps), 'em-num'); td(tr, fmt('pct', r.pct_call_hi), 'em-num em-hide-narrow');
    const f = td(tr, '');
    if (!enough) flagEl(f, 'Too few responses to judge', 'muted');
    else {
      if (r.engaged != null && r.engaged < E.ENG_MIN) flagEl(f, 'Low engagement', 'bad');
      if (r.gain_avg < E.GAIN_MIN) flagEl(f, 'Low gain', 'bad');
      if (r.nps != null && r.nps < 0) flagEl(f, 'More detractors than promoters', 'warn');
      if (!f.childNodes.length) flagEl(f, 'On track', 'ok');
    }
    el.appendChild(tr);
  }
});

const commentRows = () => {
  const q = commentQuery.trim().toLowerCase();
  return rowsOf('comments').filter((r) => r.segs.includes(seg()) && (!commentKind || r.kind === commentKind)
    && (!commentTheme || r.themes.split('; ').includes(commentTheme))
    && (!q || r.text.toLowerCase().includes(q) || r.themes.toLowerCase().includes(q)));
};
dash.draw('comments-body', (el) => {
  el.replaceChildren();
  for (const r of commentRows().slice(0, 600)) {
    const tr = document.createElement('tr');
    tr.dataset.key = r.cid;
    td(tr, r.kind); td(tr, r.text, 'em-text'); td(tr, r.themes, 'em-hide-narrow'); td(tr, r.role, 'em-hide-narrow'); td(tr, r.county, 'em-hide-narrow');
    el.appendChild(tr);
  }
});
dash.draw('comment-count', (el) => {
  if (!ok('comments')) { el.textContent = '—'; return; }
  const n = commentRows().length;
  el.textContent = F.int(n) + (n > 600 ? ' (first 600 listed; search to narrow)' : '');
});
dash.draw('theme-chip', (el) => { el.textContent = commentTheme || '—'; });

dash.draw('tests-body', (el) => {
  el.replaceChildren();
  for (const r of rowsOf('stats').filter((s) => s.kind === 'test')) {
    const tr = document.createElement('tr');
    tr.dataset.key = r.id;
    td(tr, r.question, 'em-wide'); td(tr, r.group); td(tr, F.int(r.n), 'em-num'); td(tr, r.estimate_text, 'em-num');
    td(tr, r.method); td(tr, r.p_text, 'em-num'); td(tr, r.effect_text); td(tr, r.verdict);
    el.appendChild(tr);
  }
});

dash.draw('log-body', (el) => {
  el.replaceChildren();
  for (const r of rowsOf('cleaning_log')) {
    const tr = document.createElement('tr');
    tr.dataset.key = String(r.step_no);
    td(tr, String(r.step_no), 'em-num'); td(tr, r.step); td(tr, r.what_changed); td(tr, F.int(r.rows_affected), 'em-num');
    el.appendChild(tr);
  }
});

/* ===== Controls ===== */
document.querySelectorAll('#em-seg').forEach((s) => s.addEventListener('change', () => dash.setParams({ segment: s.value })));

const PAGES = ['overview', 'actions', 'groups', 'sessions', 'comments', 'method'];
const showPage = (name) => {
  document.querySelectorAll('.em-page').forEach((p) => { p.hidden = p.dataset.page !== name; });
  document.querySelectorAll('.em-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.page === name)));
  document.querySelectorAll('#seg-control').forEach((c) => { c.style.visibility = ['overview', 'comments'].includes(name) ? 'visible' : 'hidden'; });
  dash.setLink(name);
};
document.querySelectorAll('.em-tab').forEach((t) => t.addEventListener('click', () => showPage(t.dataset.page)));
if (PAGES.includes(location.hash.slice(1))) showPage(location.hash.slice(1));

document.querySelectorAll('.em-sortable button[data-sort]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.sort;
  sortDir = sortKey === k ? -sortDir : (k === 'session_id' ? 1 : -1);
  sortKey = k;
  document.querySelectorAll('.em-sortable th').forEach((th) => th.removeAttribute('aria-sort'));
  b.parentElement.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
  dash.draw('sessions-body');
}));

document.querySelectorAll('#em-search').forEach((s) => s.addEventListener('input', () => { commentQuery = s.value; dash.draw('comments-body'); dash.draw('comment-count'); }));
document.querySelectorAll('#em-kind').forEach((s) => s.addEventListener('change', () => { commentKind = s.value; dash.draw('comments-body'); dash.draw('comment-count'); }));
document.querySelectorAll('#theme-chip').forEach((b) => b.addEventListener('click', () => { commentTheme = null; b.hidden = true; dash.draw('comments-body'); dash.draw('comment-count'); }));

/* Small-group notice (legend colors come from the brand stylesheet) */
dash.onData(() => {
  document.querySelectorAll('#em-seg').forEach((s) => { if (s !== document.activeElement) s.value = seg(); });
  const k = dash.data('seg_kpis');
  const row = k.status === 'ok' ? k.data.find((r) => r.segment === seg()) : null;
  document.querySelectorAll('.em-caution').forEach((n) => { n.hidden = !(row && row.n < window.EM.CAUTION_N); });
});
/* Charts measure their labels, so draw them again once the brand font has loaded */
if (document.fonts && document.fonts.load) {
  Promise.all(['400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 12px "EM Poppins"`)))
    .then(() => ['dumbbell', 'funnel', 'calldist', 'hbar', 'robust', 'scatter', 'monthly'].forEach((n) => dash.draw(n)))
    .catch(() => {});
}

//# sourceURL=dash-page/index.html
}).call(this);
