(() => {
'use strict';
const C = window.Cycle;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => C.iso(new Date());

const MOODS = ['happy', 'calm', 'energetic', 'confident', 'flirty', 'sexy', 'sensitive', 'emotional', 'needy', 'disappointed', 'sad', 'irritable', 'anxious', 'stressed', 'lonely'];
const SYMPTOMS = ['cramps', 'headache', 'backpain', 'bloating', 'breasts', 'nausea', 'acne', 'fatigue', 'insomnia', 'cravings', 'dizzy', 'sex'];
const FLOWS = ['none', 'spotting', 'light', 'medium', 'heavy'];
const PH_COLOR = { menstrual: '#d94f70', follicular: '#4fb286', ovulation: '#f0a03c', luteal: '#8f7bd1', premenstrual: '#b2559c' };
const CURVE_COLOR = { energy: '#f0a03c', mood: '#2fa58f', libido: '#e0446a', sens: '#8f6bd1' };
const SCALE_EMO = ['\u{1F634}', '\u{1F615}', '\u{1F642}', '\u{1F60A}', '\u{1F929}'];

let user = null, state = null, tab = 'today', calMonth = todayStr().slice(0, 7);
let sheetDate = null, draft = null, online = true, pushTimer = null, staticMode = false;

const blank = () => ({ v: 1, updatedAt: 0, settings: { cycleLen: 28, periodLen: 5, lang: '' }, starts: [], logs: {} });
const lang = () => state.settings.lang || 'pt';
const L = () => window.I18N[lang()] || window.I18N.en;
const fmt = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k]);
const fmtDate = (s, o) => new Intl.DateTimeFormat(lang() === 'pt' ? 'pt-BR' : 'en-GB', o).format(C.parse(s));
const model = () => C.build(state, todayStr());

/* ---------------- storage + sync ---------------- */
const KEY = (u) => 'luna:v1:' + u;
function loadLocal() {
  try { const s = JSON.parse(localStorage.getItem(KEY(user))); if (s && s.v === 1) return Object.assign(blank(), s); } catch {}
  return blank();
}
function saveLocal() { try { localStorage.setItem(KEY(user), JSON.stringify(state)); } catch {} }
function persist() { state.updatedAt = Date.now(); saveLocal(); clearTimeout(pushTimer); pushTimer = setTimeout(push, 600); }
async function api(path, opts = {}) {
  const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts));
  return r;
}
async function push() {
  if (staticMode) return;
  try {
    const r = await api('api/data', { method: 'PUT', body: JSON.stringify(state), keepalive: true });
    if (r.status === 401) return showLogin();
    online = r.ok;
  } catch { online = false; }
}
async function pull() {
  if (staticMode) return;
  try {
    const r = await api('api/data');
    if (r.status === 401) return showLogin();
    const { data } = await r.json();
    online = true;
    if (data && data.updatedAt > state.updatedAt) { state = Object.assign(blank(), data); saveLocal(); }
    else if (state.updatedAt > ((data && data.updatedAt) || 0)) push();
  } catch { online = false; }
}

/* ---------------- boot / auth ---------------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const r = await api('api/me');
    if (r.ok) { user = (await r.json()).user; localStorage.setItem('luna:last', user); return start(); }
    if (r.status === 401) return showLogin();
    staticMode = true; // no server behind this URL (e.g. GitHub Pages)
  } catch {
    const last = localStorage.getItem('luna:last');
    if (last) { user = last; online = false; return start(false); }
    return showLogin();
  }
  const u = localStorage.getItem('luna:static-session');
  if (u) { user = u; return start(false); }
  return showLogin();
}
async function staticLogin(name, pw) {
  const rec = (window.STATIC_USERS || {})[name.trim().toLowerCase()];
  if (!rec) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: rec.iter, salt: new TextEncoder().encode(rec.salt) }, key, 256);
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === rec.hash ? name.trim().toLowerCase() : null;
}
async function start(sync = true) {
  state = loadLocal();
  document.documentElement.lang = lang();
  render();
  if (sync) { await pull(); document.documentElement.lang = lang(); render(); }
}
function showLogin(msg = '') {
  user = null; state = state || blank();
  const t = L();
  $('#sheet').hidden = true;
  $('#app').innerHTML = `<form class="login" id="lf" autocomplete="on">
    <img class="logo" src="icon.svg" alt="">
    <h1>${t.name}</h1><p class="muted">${t.tagline}</p>
    <label class="field"><span>${t.login.user}</span><input type="text" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required></label>
    <label class="field"><span>${t.login.pass}</span><input type="password" name="password" autocomplete="current-password" required></label>
    <p class="err" id="err">${esc(msg)}</p>
    <button class="btn" type="submit">${t.login.btn}</button>
    <p class="muted small">${t.login.hint}</p></form>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (staticMode) {
      const u = await staticLogin(f.get('username') || '', f.get('password') || '');
      if (!u) return ($('#err').textContent = t.login.invalid);
      user = u; localStorage.setItem('luna:static-session', u); return start(false);
    }
    try {
      const r = await api('api/login', { method: 'POST', body: JSON.stringify({ user: f.get('username'), password: f.get('password') }) });
      if (r.ok) { user = (await r.json()).user; localStorage.setItem('luna:last', user); return start(); }
      $('#err').textContent = r.status === 429 ? t.login.many : t.login.invalid;
    } catch { $('#err').textContent = t.login.net; }
  };
}

/* ---------------- views ---------------- */
function render() {
  if (!user) return;
  const t = L();
  const views = { today: viewToday, calendar: viewCalendar, insights: viewInsights, settings: viewSettings };
  const tabs = [['today', '\u{1F319}'], ['calendar', '\u{1F4C5}'], ['insights', '\u{1F4C8}'], ['settings', '⚙️']];
  $('#app').innerHTML = views[tab]() + `<nav class="tabs"><div class="in">${tabs.map(([k, i]) =>
    `<button class="tab ${k === tab ? 'on' : ''}" data-act="tab" data-v="${k}"><span>${i}</span>${t.tabs[k]}</button>`).join('')}</div></nav>`;
}
const header = (title) => `<div class="top"><h1>${title}</h1><span class="muted small">${fmtDate(todayStr(), { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const bars = (c) => ['energy', 'mood', 'libido', 'sens'].map((k) =>
  `<div class="meter"><span>${L().meters[k]}</span><div class="bar"><i style="width:${Math.round(c[k] * 100)}%;background:${CURVE_COLOR[k]}"></i></div></div>`).join('');

function onboardCard() {
  const t = L(), T = todayStr();
  return `<div class="card"><h2>${t.welcome.title}</h2><p>${t.welcome.text}</p>
    <label class="field"><span>${t.welcome.when}</span><input type="date" id="firstDate" max="${T}" value="${T}"></label>
    <button class="btn" data-act="firstSave">${t.welcome.save}</button></div>`;
}

function viewToday() {
  const t = L(), M = model(), T = todayStr();
  const hi = header(fmt(t.hi, { name: esc(cap(user)) }));
  if (!M.last) {
    return hi + onboardCard();
  }
  const inf = C.infoFor(M, T);
  const ph = t.phases[inf.phase];
  const cv = C.curves(inf.cycleDay, inf.L, M.avgPeriod);
  const daysToNext = C.diff(M.nextStart, T);
  const inPeriod = C.hasFlow(state.logs[T]);
  let sub = M.late ? '' : `<span class="pill">${t.ev.period.split(' (')[0]} ${t.inDays(daysToNext)}</span>`;
  if (inf.fertile) sub += `<span class="pill">\u{1F33C} ${t.legend.fertile}</span>`;
  const hl = C.highlights(cv).map((k) => `<span class="chip tag">${t.hl[k]}</span>`).join(' ');

  let h = hi + `<div class="card hero" style="--ph:linear-gradient(135deg,${PH_COLOR[inf.phase]},${PH_COLOR[inf.phase]}cc)">
    <div class="emo">${ph.emoji}</div><div class="big">${ph.name}</div>
    <div style="margin:6px 0"><span class="pill">${fmt(t.dayN, { n: inf.cycleDay })}</span>${sub}</div>
    <p>${ph.vibe}</p></div>`;
  if (M.late) h += `<div class="banner"><b>${fmt(t.late.title, { n: M.late })}</b><br>${t.late.text}</div>`;
  h += `<button class="btn" data-act="startToday">${t.startedToday}</button>
    <button class="btn alt" data-act="log" data-v="${T}">${t.logToday}</button>`;
  h += `<div class="card"><h2>${t.expect}</h2>${hl ? `<div class="chips" style="margin-bottom:10px">${hl}</div>` : ''}${bars(cv)}
    <p class="muted small">${t.meterHint}</p></div>`;
  h += `<div class="card"><h3>\u{1F4AD} ${t.feelings}</h3><ul class="clean">${ph.feel.map((f) => `<li>${f}</li>`).join('')}</ul></div>`;
  h += `<div class="card"><h3>\u{1F49C} ${t.selfcare}</h3><ul class="clean">${ph.tips.map((f) => `<li>${f}</li>`).join('')}</ul></div>`;
  h += upNext(M, T);
  h += `<div class="card"><h3>\u{1F4C6} ${t.startOther}</h3><div class="row"><input type="date" id="otherDate" max="${T}" value="${T}"><button class="btn alt" style="flex:none;width:auto" data-act="startOn">${t.startOtherBtn}</button></div></div>`;
  return h;
}

function upNext(M, T) {
  const t = L(), P = M.avgPeriod, L0 = M.avgCycle, O = C.ovulationDay(L0, P);
  const ev = [];
  for (let k = 0; k < 3; k++) {
    const b = C.add(M.last, k * L0);
    if (!(k === 0 && M.late)) ev.push(
      [C.add(b, O - 6), 'fertile'], [C.add(b, O - 1), 'ovulation'], [C.add(b, L0 - 6), 'pms'], [C.add(b, L0), 'period']);
  }
  const list = ev.filter(([d]) => d >= T).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 4);
  if (!list.length) return '';
  const dot = { fertile: '#2fa58f', ovulation: '#f0a03c', pms: PH_COLOR.premenstrual, period: PH_COLOR.menstrual };
  return `<div class="card"><h3>\u{1F5D3}️ ${t.upNext}</h3>${list.map(([d, k]) =>
    `<div class="event"><span><i class="dot" style="background:${dot[k]}"></i>${t.ev[k]}</span><span class="muted">${fmtDate(d, { day: 'numeric', month: 'short' })} · ${t.inDays(C.diff(d, T))}</span></div>`).join('')}</div>`;
}

function viewCalendar() {
  const t = L(), M = model(), T = todayStr();
  if (!M.last) return header(t.tabs.calendar) + onboardCard();
  const [y, mo] = calMonth.split('-').map(Number);
  const first = new Date(y, mo - 1, 1, 12), days = new Date(y, mo, 0).getDate();
  const loc = lang() === 'pt' ? 'pt-BR' : 'en-GB';
  const dows = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(loc, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i, 12)));
  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="cell empty"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${C.pad(mo)}-${C.pad(d)}`;
    const inf = C.infoFor(M, ds), log = state.logs[ds];
    const cls = ['cell'];
    if (C.hasFlow(log) || (log && log.flow === 'spotting')) cls.push('period');
    else if (inf && inf.periodPredicted) cls.push('pred');
    else if (inf && inf.ovulation && !inf.late) cls.push('ovu');
    else if (inf && inf.fertile && !inf.late) cls.push('fertile');
    else if (inf && inf.phase === 'premenstrual') cls.push('pms');
    if (ds === T) cls.push('today');
    const has = log && (log.moods?.length || log.symptoms?.length || log.note || log.energy || log.desire);
    cells += `<button class="${cls.join(' ')}" data-act="log" data-v="${ds}">${d}${has ? '<i class="mk"></i>' : ''}</button>`;
  }
  const lg = [['period', '#f4489a'], ['predicted', '#ffc2d8'], ['fertile', '#b79be6'], ['ovulation', '#8e6fd0'], ['pms', 'rgba(178,85,156,.25)']]
    .map(([k, bg]) => `<span><i style="background:${bg}"></i>${t.legend[k]}</span>`).join('');
  const nowInf = C.infoFor(M, T);
  let banner = '';
  if (nowInf && M.late) banner = fmt(t.late.title, { n: M.late });
  else if (nowInf && nowInf.phase === 'menstrual' && C.hasFlow(state.logs[T])) { const n = M.avgPeriod - nowInf.cycleDay; banner = n > 0 ? fmt(t.cal.endsIn, { n }) : t.cal.endsToday; }
  else if (nowInf) banner = fmt(t.cal.nextIn, { when: t.inDays(C.diff(M.nextStart, T)) });
  return header(t.tabs.calendar) + (banner ? `<div class="card" style="background:var(--soft);display:flex;gap:10px;align-items:center">\u{1F4E3} <span>${banner}</span></div>` : '') + `<div class="card"><div class="calhead"><button data-act="month" data-v="-1" aria-label="prev">‹</button>
    <b>${cap(fmtDate(calMonth + '-01', { month: 'long', year: 'numeric' }).replace(' de ', ' '))}</b><button data-act="month" data-v="1" aria-label="next">›</button></div>
    <div class="grid">${dows.map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div><div class="legend">${lg}</div></div>`;
}

function chartSVG(M, T) {
  const W = 340, H = 180, pl = 6, pr = 6, pt = 8, pb = 22;
  const from = -7, to = 21, n = to - from;
  const X = (i) => pl + ((i - from) / n) * (W - pl - pr);
  const Y = (v) => pt + (1 - v) * (H - pt - pb);
  const days = []; for (let i = from; i <= to; i++) days.push(C.add(T, i));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  const bw = (W - pl - pr) / n;
  days.forEach((d, k) => {
    const inf = C.infoFor(M, d);
    if (inf) svg += `<rect x="${(X(from + k) - bw / 2).toFixed(1)}" y="${pt}" width="${bw.toFixed(1)}" height="${H - pt - pb}" fill="${PH_COLOR[inf.phase]}" opacity="${inf.predicted ? .13 : .2}"/>`;
  });
  [0, .5, 1].forEach((v) => { svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".1"/>`; });
  for (const key of ['energy', 'mood', 'libido', 'sens']) {
    const pts = days.map((d, k) => { const inf = C.infoFor(M, d); return inf ? [X(from + k), Y(C.curves(inf.cycleDay, inf.L, M.avgPeriod)[key])] : null; });
    let p = '', pen = false;
    pts.forEach((q) => { if (!q) { pen = false; return; } p += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); pen = true; });
    svg += `<path d="${p}" fill="none" stroke="${CURVE_COLOR[key]}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  days.forEach((d, k) => { // her own logged energy / desire as dots
    const lg = state.logs[d]; if (!lg) return;
    if (lg.energy) svg += `<circle cx="${X(from + k)}" cy="${Y((lg.energy - 1) / 4)}" r="3.2" fill="#fff" stroke="${CURVE_COLOR.energy}" stroke-width="2"/>`;
    if (lg.desire) svg += `<circle cx="${X(from + k)}" cy="${Y((lg.desire - 1) / 4)}" r="3.2" fill="#fff" stroke="${CURVE_COLOR.libido}" stroke-width="2"/>`;
  });
  svg += `<line x1="${X(0)}" x2="${X(0)}" y1="${pt}" y2="${H - pb}" stroke="currentColor" stroke-dasharray="3 3" opacity=".7"/>`;
  [-7, 0, 7, 14, 21].forEach((i) => { svg += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 21 ? 'end' : i === -7 ? 'start' : 'middle'}" font-size="9.5" fill="currentColor" opacity=".7">${fmtDate(C.add(T, i), { day: 'numeric', month: 'short' })}</text>`; });
  return svg + '</svg>';
}

function viewInsights() {
  const t = L(), M = model(), T = todayStr();
  if (!M.last) return header(t.tabs.insights) + onboardCard();
  let h = header(t.tabs.insights);
  h += `<div class="card"><h2>${t.insights.chart}</h2><p class="muted small" style="margin-top:-4px">${t.insights.chartSub}</p>${chartSVG(M, T)}
    <div class="lg">${['energy', 'mood', 'libido', 'sens'].map((k) => `<span><b style="background:${CURVE_COLOR[k]}"></b>${t.meters[k]}</span>`).join('')}</div></div>`;
  let rows = '';
  for (let i = 0; i < 7; i++) {
    const d = C.add(T, i), inf = C.infoFor(M, d); if (!inf) continue;
    const tags = C.highlights(C.curves(inf.cycleDay, inf.L, M.avgPeriod)).map((k) => `<span class="chip tag">${t.hl[k]}</span>`).join(' ');
    const ph = t.phases[inf.phase];
    rows += `<div class="dayrow"><div class="d">${fmtDate(d, { weekday: 'short' })}<small>${fmtDate(d, { day: 'numeric', month: 'short' })}</small></div>
      <div class="t"><div><i class="dot" style="background:${PH_COLOR[inf.phase]}"></i>${ph.emoji} ${ph.name.split(' —')[0]}${inf.fertile ? ' · \u{1F33C}' : ''}${inf.periodPredicted ? ' · \u{1FA78}' : ''}</div>
      <div class="chips" style="margin-top:6px">${tags}</div></div></div>`;
  }
  h += `<div class="card"><h2>${t.insights.days7}</h2>${rows}</div>`;
  const spread = M.spread == null ? '—' : fmt(t.insights.range, { n: Math.ceil(M.spread / 2) });
  h += `<div class="card"><h2>${t.insights.stats}</h2><div class="stat">
    <div><span class="muted small">${t.insights.avgCycle}</span><b>${fmt(t.insights.days, { n: M.avgCycle })}</b></div>
    <div><span class="muted small">${t.insights.avgPeriod}</span><b>${fmt(t.insights.days, { n: M.avgPeriod })}</b></div>
    <div><span class="muted small">${t.insights.cyclesLogged}</span><b>${M.cycles}</b></div>
    <div><span class="muted small">${t.insights.variation}</span><b>${spread}</b></div></div>
    ${M.cycles < 3 ? `<p class="muted small">${t.insights.learning}</p>` : ''}</div>`;
  const pat = C.patterns(state, M), names = Object.assign({}, t.moods, t.symptoms);
  const order = ['menstrual', 'follicular', 'ovulation', 'luteal', 'premenstrual'].filter((p) => pat[p]);
  h += `<div class="card"><h2>${t.insights.patterns}</h2><p class="muted small" style="margin-top:-4px">${t.insights.patternsSub}</p>` +
    (order.length ? order.map((p) => `<div style="margin:10px 0"><b><i class="dot" style="background:${PH_COLOR[p]}"></i>${t.phases[p].name.split(' —')[0]}</b>
      <div class="chips" style="margin-top:6px">${pat[p].items.map(([k, c]) => `<span class="chip tag">${names[k] || k} · ${c}</span>`).join('')}</div></div>`).join('') : `<p class="muted">${t.insights.none}</p>`) + '</div>';
  return h;
}

function viewSettings() {
  const t = L(), s = t.settings, st = state.settings;
  const opt = (v, l) => `<option value="${v}" ${lang() === v ? 'selected' : ''}>${l}</option>`;
  return header(s.title) + `<div class="card"><label class="field"><span>${s.language}</span>
    <select data-set="lang">${opt('en', 'English')}${opt('pt', 'Português (Brasil)')}</select></label>
    <label class="field"><span>${s.cycle}</span><input type="number" min="21" max="45" data-set="cycleLen" value="${st.cycleLen}"></label>
    <label class="field"><span>${s.period}</span><input type="number" min="2" max="10" data-set="periodLen" value="${st.periodLen}"></label>
    <p class="muted small">${s.cycleNote}</p></div>
    <div class="card"><h3>${s.account}</h3><p>${fmt(s.signedAs, { name: esc(user) })}</p>
    <p class="muted small">${staticMode ? s.sync.local : online ? s.sync.ok : s.sync.offline}</p>
    <button class="btn ghost" data-act="logout">${s.logout}</button></div>
    <div class="card"><h3>${s.data}</h3><button class="btn alt" data-act="export">${s.export}</button>
    <button class="btn danger" data-act="wipe">${s.wipe}</button></div>
    <div class="card"><h3>${s.about}</h3><p class="small">${s.aboutText}</p><p class="small muted">${s.disclaimer}</p><p class="small muted">${s.install}</p></div>`;
}

/* ---------------- log sheet ---------------- */
function openLog(date) {
  sheetDate = date;
  draft = JSON.parse(JSON.stringify(state.logs[date] || {}));
  draft._start = state.starts.includes(date);
  renderSheet();
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; sheetDate = null; }
function renderSheet() {
  const keep = $('#note'); if (keep && draft) draft.note = keep.value;
  const t = L(), M = model(), T = todayStr(), d = sheetDate, inf = C.infoFor(M, d), future = d > T;
  const on = (arr, k) => (arr || []).includes(k) ? 'on' : '';
  let h = `<div class="panel"><div class="row" style="margin-bottom:6px"><div><h2 style="margin:0">${cap(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
    ${inf ? `<span class="muted small"><i class="dot" style="background:${PH_COLOR[inf.phase]}"></i>${t.phases[inf.phase].name} · ${fmt(t.dayN, { n: inf.cycleDay })}</span>` : ''}</div>
    <button class="btn ghost" style="flex:none;width:auto;padding:8px 14px" data-act="close">✕</button></div>`;
  if (inf) {
    const cv = C.curves(inf.cycleDay, inf.L, M.avgPeriod);
    h += future ? `<h3 class="s">${t.cal.future}</h3>${bars(cv)}<ul class="clean">${t.phases[inf.phase].feel.map((f) => `<li>${f}</li>`).join('')}</ul>` : '';
  } else if (future) h += `<p class="muted">${t.cal.noData}</p>`;
  if (future) return ($('#sheet').innerHTML = h + `<button class="btn alt" data-act="close" style="margin-top:14px">${t.log.cancel}</button></div>`);

  h += `<label class="sw" style="margin-top:10px"><input type="checkbox" data-act="isStart" ${draft._start ? 'checked' : ''}> \u{1FA78} ${t.log.first}</label>
    <h3 class="s">${t.log.flow}</h3><div class="chips">${FLOWS.map((k) => `<button class="chip ${draft.flow === k ? 'on' : ''}" data-act="flow" data-v="${k}">${t.log.flows[k]}</button>`).join('')}</div>
    <h3 class="s">${t.log.mood}</h3><div class="chips">${MOODS.map((k) => `<button class="chip ${on(draft.moods, k)}" data-act="mood" data-v="${k}">${t.moods[k]}</button>`).join('')}</div>
    <h3 class="s">${t.log.body}</h3><div class="chips">${SYMPTOMS.map((k) => `<button class="chip ${on(draft.symptoms, k)}" data-act="sym" data-v="${k}">${t.symptoms[k]}</button>`).join('')}</div>`;
  for (const [key, label] of [['energy', t.log.energy], ['desire', t.log.desire]])
    h += `<h3 class="s">${label}</h3><div class="scale">${SCALE_EMO.map((e, i) => `<button class="${draft[key] === i + 1 ? 'on' : ''}" title="${t.log.scale[i]}" data-act="scale" data-k="${key}" data-v="${i + 1}">${e}</button>`).join('')}</div>`;
  h += `<h3 class="s">${t.log.note}</h3><textarea id="note" placeholder="${t.log.notePh}">${esc(draft.note || '')}</textarea>
    <button class="btn" data-act="saveLog" style="margin-top:14px">${t.log.save}</button>
    <button class="btn ghost" data-act="clearLog">${t.log.remove}</button></div>`;
  $('#sheet').innerHTML = h;
}
function toggle(arr, k) { arr = arr || []; return arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]; }
function saveLog() {
  const d = sheetDate, note = ($('#note') || {}).value || '';
  const entry = { flow: draft.flow, moods: draft.moods, symptoms: draft.symptoms, energy: draft.energy, desire: draft.desire, note: note.trim() };
  const empty = !entry.flow && !(entry.moods || []).length && !(entry.symptoms || []).length && !entry.energy && !entry.desire && !entry.note;
  if (empty) delete state.logs[d]; else state.logs[d] = entry;
  state.starts = state.starts.filter((s) => s !== d);
  if (draft._start) state.starts.push(d);
  state.starts.sort();
  persist(); closeSheet(); render();
}
function toast(msg) {
  const e = document.createElement('div'); e.className = 'toast'; e.textContent = msg; document.body.appendChild(e); setTimeout(() => e.remove(), 2200);
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const v = el.dataset.v, act = el.dataset.act;
  if (act === 'tab') { tab = v; render(); window.scrollTo(0, 0); }
  else if (act === 'month') { const [y, m] = calMonth.split('-').map(Number); const d = new Date(y, m - 1 + Number(v), 1, 12); calMonth = C.iso(d).slice(0, 7); render(); }
  else if (act === 'log') openLog(v);
  else if (act === 'close') closeSheet();
  else if (act === 'flow') { draft.flow = draft.flow === v ? undefined : v; renderSheet(); }
  else if (act === 'mood') { draft.moods = toggle(draft.moods, v); renderSheet(); }
  else if (act === 'sym') { draft.symptoms = toggle(draft.symptoms, v); renderSheet(); }
  else if (act === 'scale') { const k = el.dataset.k; draft[k] = draft[k] === Number(v) ? undefined : Number(v); renderSheet(); }
  else if (act === 'saveLog') saveLog();
  else if (act === 'clearLog') { draft = { _start: false }; const n = $('#note'); if (n) n.value = ''; saveLog(); }
  else if (act === 'startToday') {
    const T = todayStr(); if (!state.starts.includes(T)) state.starts.push(T); state.starts.sort();
    state.logs[T] = Object.assign({}, state.logs[T], { flow: (state.logs[T] || {}).flow && state.logs[T].flow !== 'none' ? state.logs[T].flow : 'medium' });
    persist(); render(); openLog(T);
  }
  else if (act === 'startOn') {
    const d = $('#otherDate').value; if (!d || d > todayStr()) return;
    if (!state.starts.includes(d)) state.starts.push(d); state.starts.sort();
    state.logs[d] = Object.assign({}, state.logs[d], { flow: (state.logs[d] || {}).flow && state.logs[d].flow !== 'none' ? state.logs[d].flow : 'medium' });
    persist(); render(); openLog(d);
  }
  else if (act === 'firstSave') {
    const d = $('#firstDate').value || todayStr(); if (d > todayStr()) return;
    state.starts = [d]; state.logs[d] = Object.assign({}, state.logs[d], { flow: 'medium' }); persist(); render();
  }
  else if (act === 'logout') { (staticMode ? Promise.resolve() : api('api/logout', { method: 'POST' })).finally(() => { localStorage.removeItem('luna:last'); localStorage.removeItem('luna:static-session'); showLogin(); }); }
  else if (act === 'export') {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    a.download = 'luna-' + todayStr() + '.json'; a.click();
  }
  else if (act === 'wipe') { if (confirm(L().settings.wipeAsk)) { const s = state.settings; state = blank(); state.settings = s; persist(); render(); } }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.act === 'isStart') { draft._start = el.checked; if (el.checked && !draft.flow) draft.flow = 'medium'; renderSheet(); return; }
  const k = el.dataset.set; if (!k) return;
  if (k === 'lang') { state.settings.lang = el.value; document.documentElement.lang = lang(); }
  else { const n = Math.round(Number(el.value)); if (!n) return; state.settings[k] = k === 'cycleLen' ? Math.min(45, Math.max(21, n)) : Math.min(10, Math.max(2, n)); }
  persist(); render();
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

boot();
})();
