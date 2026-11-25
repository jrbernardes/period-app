const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/cycle.js');

const mk = (starts, extra = {}) => ({
  settings: { cycleLen: 28, periodLen: 5, lang: '' }, starts, logs: {}, ...extra,
});

test('date helpers', () => {
  assert.strictEqual(C.add('2026-02-27', 3), '2026-03-02');
  assert.strictEqual(C.diff('2026-03-31', '2026-03-01'), 30);
  assert.strictEqual(C.add('2026-03-28', 2), '2026-03-30'); // DST safe
});

test('defaults to 28 days with one start, predicts next period', () => {
  const m = C.build(mk(['2026-11-01']), '2026-11-10');
  assert.strictEqual(m.avgCycle, 28);
  assert.strictEqual(m.nextStart, '2026-11-29');
  assert.strictEqual(m.late, 0);
});

test('averages recent cycle lengths and ignores outliers', () => {
  const m = C.build(mk(['2026-01-01', '2026-01-31', '2026-03-02', '2026-06-20']), '2026-06-21');
  assert.strictEqual(m.avgCycle, 30); // 30,30 used; 110 ignored
});

test('phases follow the expected order over a 28-day cycle', () => {
  const seq = [];
  for (let d = 1; d <= 28; d++) seq.push(C.phaseOf(d, 28, 5));
  assert.strictEqual(seq[0], 'menstrual');
  assert.strictEqual(seq[4], 'menstrual');
  assert.strictEqual(seq[5], 'follicular');
  assert.strictEqual(seq[12], 'ovulation'); // O = 14 -> days 13..15
  assert.strictEqual(seq[15], 'luteal');
  assert.strictEqual(seq[27], 'premenstrual');
});

test('projects future cycles and flags ovulation + fertile window', () => {
  const m = C.build(mk(['2026-11-01']), '2026-11-10');
  const o = C.infoFor(m, '2026-11-14');
  assert.ok(o.ovulation && o.fertile);
  const next = C.infoFor(m, '2026-11-30');
  assert.strictEqual(next.cycleDay, 2);
  assert.ok(next.periodPredicted);
  assert.strictEqual(C.infoFor(m, '2026-10-31'), null);
});

test('late period stays premenstrual and is not "predicted period"', () => {
  const m = C.build(mk(['2026-11-01']), '2026-12-03');
  assert.strictEqual(m.late, 4);
  const i = C.infoFor(m, '2026-12-03');
  assert.strictEqual(i.phase, 'premenstrual');
  assert.ok(i.late && !i.periodPredicted);
});

test('tendencies: sensitivity peaks before period, desire peaks at ovulation', () => {
  const pms = C.curves(27, 28, 5), mid = C.curves(14, 28, 5), early = C.curves(9, 28, 5);
  assert.ok(pms.sens > early.sens + 0.3);
  assert.ok(mid.libido > pms.libido && mid.libido > early.libido);
  assert.ok(pms.mood < early.mood);
  for (const d of [1, 7, 14, 21, 28]) for (const v of Object.values(C.curves(d, 28, 5))) assert.ok(v >= 0 && v <= 1);
});

test('period length learned from logged flow days', () => {
  const logs = {};
  ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].forEach((d) => (logs[d] = { flow: 'medium' }));
  const m = C.build(mk(['2026-10-01', '2026-10-29'], { logs }), '2026-11-02');
  assert.strictEqual(m.avgPeriod, 4);
});
