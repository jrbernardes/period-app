/* Cycle maths: pure functions, no DOM. Works in the browser (window.Cycle) and Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cycle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const diff = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  const hasFlow = (log) => !!(log && log.flow && log.flow !== 'none');

  /** Build the prediction model from saved state. `today` is YYYY-MM-DD. */
  function build(state, today) {
    const st = state.settings;
    const starts = [...new Set(state.starts)].sort();
    const lens = [];
    for (let i = 1; i < starts.length; i++) {
      const d = diff(starts[i], starts[i - 1]);
      if (d >= 18 && d <= 60) lens.push(d); // ignore skipped logging / outliers
    }
    const recent = lens.slice(-6);
    const avgCycle = recent.length ? Math.round(mean(recent)) : st.cycleLen;
    const spread = recent.length >= 2 ? Math.max(...recent) - Math.min(...recent) : null;
    const runs = starts.map((s) => {
      let n = 0;
      while (hasFlow(state.logs[add(s, n)])) n++;
      return n;
    }).filter((n) => n >= 2);
    const avgPeriod = runs.length ? clamp(Math.round(mean(runs.slice(-6))), 2, 10) : st.periodLen;
    const last = starts.length ? starts[starts.length - 1] : null;
    const nextStart = last ? add(last, avgCycle) : null;
    const late = last && diff(today, nextStart) > 0 ? diff(today, nextStart) : 0;
    return { today, starts, avgCycle, avgPeriod, spread, cycles: lens.length, last, nextStart, late };
  }

  const ovulationDay = (L, P) => Math.max(L - 14, P + 4); // luteal phase ~14 days

  function phaseOf(d, L, P) {
    const O = ovulationDay(L, P);
    if (d <= P) return 'menstrual';
    if (d <= O - 2) return 'follicular';
    if (d <= O + 1) return 'ovulation';
    if (d <= L - 6) return 'luteal';
    return 'premenstrual';
  }

  /** Where does date `x` sit in the cycle? Returns null before the first logged period. */
  function infoFor(m, x) {
    if (!m.last || x < m.starts[0]) return null;
    let i = m.starts.length - 1;
    while (m.starts[i] > x) i--;
    const s = m.starts[i];
    let d = diff(x, s) + 1;
    let L;
    let late = false;
    if (i < m.starts.length - 1) {
      L = diff(m.starts[i + 1], s);
    } else {
      L = m.avgCycle;
      if (d > L) {
        if (m.late) { L = d; late = true; } // period is overdue: stay in the premenstrual stretch
        else { d = ((d - 1) % L) + 1; }       // project the next cycle(s)
      }
    }
    const P = m.avgPeriod;
    const O = ovulationDay(L, P);
    const phase = phaseOf(d, L, P);
    const predicted = x > m.today;
    return {
      date: x, cycleDay: d, L, O, phase, late, predicted,
      fertile: d >= O - 5 && d <= O + 1,
      ovulation: d === O,
      periodPredicted: predicted && phase === 'menstrual' && !late,
    };
  }

  const g = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s));
  const sm = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /** Typical hormone-driven tendencies, 0..1. These are population averages, not diagnoses. */
  function curves(d, L, P) {
    const O = ovulationDay(L, P);
    return {
      energy: clamp(0.5 + 0.35 * sm(d, P, O - 2) - 0.15 * sm(d, O + 1, O + 6) - 0.3 * g(d, 1.5, 1.5) - 0.35 * sm(d, L - 6, L - 1), 0, 1),
      mood: clamp(0.55 + 0.3 * sm(d, P, O - 1) - 0.1 * sm(d, O + 1, O + 4) - 0.15 * g(d, 1.5, 1.5) - 0.4 * sm(d, L - 6, L - 1), 0, 1),
      libido: clamp(0.3 + 0.1 * sm(d, P, O - 3) + 0.65 * g(d, O - 0.5, 2) + 0.12 * g(d, L - 1, 2), 0, 1),
      sens: clamp(0.25 + 0.6 * sm(d, L - 7, L - 1) + 0.15 * g(d, 1.5, 1.5), 0, 1),
    };
  }

  /** Keys of the notable tendencies for a day (translated by the UI). */
  function highlights(c) {
    const out = [];
    if (c.sens > 0.55) out.push('sens_hi');
    if (c.libido > 0.6) out.push('libido_hi');
    if (c.mood < 0.35) out.push('mood_lo');
    if (c.energy < 0.35) out.push('energy_lo');
    if (c.energy > 0.72) out.push('energy_hi');
    if (c.mood > 0.72) out.push('mood_hi');
    return out.slice(0, 3);
  }

  /** What she actually logs, grouped by phase: { phase: { n, items: [[key,count],...] } } */
  function patterns(state, m) {
    const acc = {};
    for (const [date, log] of Object.entries(state.logs)) {
      const inf = infoFor(m, date);
      if (!inf || inf.predicted) continue;
      const a = (acc[inf.phase] = acc[inf.phase] || { n: 0, c: {} });
      const keys = [...(log.moods || []), ...(log.symptoms || [])];
      if (!keys.length) continue;
      a.n++;
      keys.forEach((k) => { a.c[k] = (a.c[k] || 0) + 1; });
    }
    const out = {};
    for (const [p, a] of Object.entries(acc)) {
      if (a.n < 2) continue;
      out[p] = { n: a.n, items: Object.entries(a.c).sort((x, y) => y[1] - x[1]).slice(0, 4) };
    }
    return out;
  }

  return { pad, iso, parse, add, diff, build, infoFor, phaseOf, ovulationDay, curves, highlights, patterns, hasFlow };
});
