/**
 * Standalone PBT runner — no vitest harness, pure Node ESM.
 * Runs all 12 property invariants directly and prints a report.
 */
import * as fc from 'fast-check';
import { computeLayout, sortSpeakers, buildPKConfig } from './src/lib/layout/computeLayout.js';

// ─── minimal fixtures ─────────────────────────────────────────────────────────
function makeSpeaker(overrides = {}) {
  return {
    userId: `u-${Math.random().toString(36).slice(2,8)}`,
    seatIndex: 0, role: 'speaker', displayName: 'Spk',
    isMuted: false, isSpeaking: false, isOnline: true,
    connectionQuality: 'good', ...overrides,
  };
}

function genSpeakers(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push(makeSpeaker({ userId: `user-${i}`, seatIndex: i,
      role: i === 0 ? 'owner' : 'speaker' }));
  }
  return arr;
}

function flatten(pages) { return pages.flat(); }

const MODES = ['auto','grid','focus-host','podcast','classroom','pk','compact','minimal'];

// ─── fast-check arbitraries (fast — no webUrl) ────────────────────────────────
const connectionQualities = ['excellent','good','poor','unknown'];

const fcSpeaker = fc.record({
  userId: fc.string({ minLength: 1, maxLength: 12 }),
  seatIndex: fc.nat({ max: 99 }),
  role: fc.constantFrom('moderator','speaker'),
  displayName: fc.string({ minLength: 1, maxLength: 12 }),
  isMuted: fc.boolean(),
  isSpeaking: fc.boolean(),
  isOnline: fc.boolean(),
  connectionQuality: fc.constantFrom(...connectionQualities),
});

const fcSpeakersArray = fc.integer({ min: 1, max: 30 }).chain(n =>
  fc.uniqueArray(fcSpeaker, { minLength: n-1, maxLength: n-1, selector: s => s.userId })
    .map(rest => {
      const owner = { userId:'owner-0', seatIndex:0, role:'owner',
        displayName:'Owner', isMuted:false, isSpeaking:false, isOnline:true,
        connectionQuality:'good' };
      return [owner, ...rest.map((s,i) => ({...s, seatIndex:i+1,
        userId: s.userId==='owner-0' ? `sp-${i}` : s.userId}))];
    })
);

const fcMode = fc.constantFrom(...MODES);
const RUNS = 200;

// ─── results accumulator ─────────────────────────────────────────────────────
const results = [];
let totalPassed = 0, totalFailed = 0;
const edgeCases = [];
const perfTimings = [];

function run(id, desc, arb, fn, numRuns = RUNS) {
  try {
    fc.assert(fc.property(arb, fn), { numRuns, seed: 42 });
    results.push({ id, desc, status: 'PASS' });
    totalPassed++;
  } catch(e) {
    const msg = e.message?.slice(0, 200) ?? String(e);
    results.push({ id, desc, status: 'FAIL', error: msg });
    totalFailed++;
    edgeCases.push(`${id}: ${msg}`);
  }
}

// ─── P1 Host Invariant ────────────────────────────────────────────────────────
run('P1a', 'Host Invariant: owner at pages[0][0] for all modes',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    const r = computeLayout(speakers, mode);
    return r.pages[0][0].role === 'owner' && !r.pages[0][0].isEmpty;
  });

run('P1b', 'Host Invariant: holds when owner is last in input array',
  fc.integer({ min: 1, max: 8 }), n => {
    const extras = Array.from({length:n}, (_,i) => makeSpeaker({userId:`sp-${i}`,role:'speaker',seatIndex:i+1}));
    const owner = makeSpeaker({userId:'late-owner',role:'owner',seatIndex:0});
    const r = computeLayout([...extras, owner], null);
    return r.pages[0][0].userId === 'late-owner';
  });

// ─── P2 Page Size Invariant ───────────────────────────────────────────────────
run('P2', 'Page Size: every page has exactly columns*rows seats',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    const r = computeLayout(speakers, mode);
    const cap = r.gridDef.columns * r.gridDef.rows;
    return r.pages.every(p => p.length === cap);
  });

// ─── P3 Seat Key Uniqueness ───────────────────────────────────────────────────
run('P3', 'Seat Uniqueness: no duplicate seat keys',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    const all = flatten(computeLayout(speakers, mode).pages);
    const keys = all.map(s => s.key);
    return new Set(keys).size === keys.length;
  });

// ─── P4 User Uniqueness ───────────────────────────────────────────────────────
run('P4', 'User Uniqueness: no duplicate userIds in occupied seats',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    const occupied = flatten(computeLayout(speakers, mode).pages).filter(s => !s.isEmpty);
    const ids = occupied.map(s => s.userId);
    return new Set(ids).size === ids.length;
  });

// ─── P5 Seat Key Format ───────────────────────────────────────────────────────
run('P5', 'Stable Keys: key === "seat-${seatIndex}" always',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    return flatten(computeLayout(speakers, mode).pages)
      .every(s => s.key === `seat-${s.seatIndex}`);
  });

// ─── P6 Pagination Consistency ───────────────────────────────────────────────
run('P6a', 'Pagination: totalPages >= 1 always',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    return computeLayout(speakers, mode).totalPages >= 1;
  });

run('P6b', 'Pagination: totalPages = ceil(max(n,1)/pageSize)',
  fc.tuple(fcSpeakersArray, fc.constantFrom(8,12,16)), ([speakers, pageSize]) => {
    const n = speakers.length;
    const expected = Math.ceil(Math.max(n,1)/pageSize);
    return computeLayout(speakers, null, { pageSize }).totalPages === expected;
  });

// ─── P7 Sort Order ────────────────────────────────────────────────────────────
function rank(s) {
  if (s.role === 'owner') return 0;
  if (s.role === 'moderator') return 1;
  if (s.isSpeaking && !s.isMuted) return 2;
  return 3;
}
run('P7a', 'Sort Order: occupied seats on page 0 are in non-decreasing rank',
  fcSpeakersArray, speakers => {
    const occ = computeLayout(speakers, null).pages[0].filter(s => !s.isEmpty);
    for (let i = 1; i < occ.length; i++) {
      if (rank(occ[i]) < rank(occ[i-1])) return false;
    }
    return true;
  });

run('P7b', 'Sort Order: pinned speaker is at index 1 after owner',
  fcSpeakersArray.filter(a => a.length >= 3), speakers => {
    const target = speakers.find(s => s.role !== 'owner');
    if (!target) return true;
    const r = computeLayout(speakers, null, { pinnedUserId: target.userId });
    const occ = r.pages[0].filter(s => !s.isEmpty);
    return occ.length < 2 || occ[1].userId === target.userId;
  });

// ─── P8 PK Team Balance ───────────────────────────────────────────────────────
run('P8a', 'PK Balance: |teamA - teamB| <= 1',
  fcSpeakersArray, speakers => {
    const pk = buildPKConfig(speakers);
    return Math.abs(pk.teamA.length - pk.teamB.length) <= 1;
  });

run('P8b', 'PK Balance: odd n → teamA gets ceil(n/2)',
  fc.integer({ min: 1, max: 49 }).filter(n => n%2===1), n => {
    const pk = buildPKConfig(genSpeakers(n));
    return pk.teamA.length === Math.ceil(n/2) && pk.teamB.length === Math.floor(n/2);
  });

// ─── P9 Layout Switching ─────────────────────────────────────────────────────
run('P9a', 'Layout Switching: all modes valid',
  fcSpeakersArray, speakers => {
    return MODES.every(mode => {
      const r = computeLayout(speakers, mode);
      return r.pages.length >= 1 && r.gridDef.columns >= 1 && r.gridDef.rows >= 1;
    });
  });

run('P9b', 'compact: columns >= 4, rows === 3, seatAspect === 0.75',
  fcSpeakersArray, speakers => {
    const r = computeLayout(speakers, 'compact');
    return r.gridDef.columns >= 4 && r.gridDef.rows === 3 && r.gridDef.seatAspect === 0.75;
  });

run('P9c', 'classroom: columns === 4, hostSpan full top row',
  fcSpeakersArray, speakers => {
    const r = computeLayout(speakers, 'classroom');
    return r.gridDef.columns === 4 &&
      r.gridDef.hostSpan?.colSpan === 4 && r.gridDef.hostSpan?.rowSpan === 1;
  });

run('P9d', 'grid: columns*rows >= n (fits all)',
  fcSpeakersArray, speakers => {
    const r = computeLayout(speakers, 'grid');
    return r.gridDef.columns * r.gridDef.rows >= speakers.length;
  });

// ─── P10 Empty Seat Integrity ─────────────────────────────────────────────────
run('P10a', 'Empty Seat Integrity: isEmpty=true → userId="" isSpeaking=false',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    return flatten(computeLayout(speakers, mode).pages)
      .filter(s => s.isEmpty)
      .every(e => e.userId==='' && !e.isSpeaking && !e.isMuted && e.role==='empty');
  });

run('P10b', 'Empty Seat Integrity: occupied seats never have isEmpty=true',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    return flatten(computeLayout(speakers, mode).pages)
      .filter(s => s.userId !== '')
      .every(o => !o.isEmpty);
  });

// ─── P11 Performance Budget ───────────────────────────────────────────────────
{
  const samples = 50;
  const timings = [];
  for (let i = 0; i < samples; i++) {
    const speakers = genSpeakers(200);
    const mode = MODES[i % MODES.length];
    const t0 = performance.now();
    computeLayout(speakers, mode);
    timings.push(performance.now() - t0);
  }
  const avg = timings.reduce((a,b)=>a+b,0)/timings.length;
  const max = Math.max(...timings);
  perfTimings.push({ avg, max, samples });
  if (avg < 2) {
    results.push({ id:'P11', desc:`Performance: avg ${avg.toFixed(3)}ms max ${max.toFixed(3)}ms (200 speakers, 50 runs)`, status:'PASS' });
    totalPassed++;
  } else {
    results.push({ id:'P11', desc:`Performance: avg ${avg.toFixed(3)}ms EXCEEDS 2ms budget`, status:'FAIL' });
    totalFailed++;
    edgeCases.push(`P11: avg ${avg.toFixed(3)}ms > 2ms budget`);
  }
}

// ─── P12 Determinism ─────────────────────────────────────────────────────────
run('P12', 'Determinism: same inputs → identical key/uid sequences',
  fc.tuple(fcSpeakersArray, fcMode), ([speakers, mode]) => {
    const r1 = computeLayout(speakers, mode);
    const r2 = computeLayout(speakers, mode);
    const k1 = flatten(r1.pages).map(s=>s.key).join(',');
    const k2 = flatten(r2.pages).map(s=>s.key).join(',');
    return k1 === k2 && r1.totalPages === r2.totalPages;
  });

// ─── Report ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  DYNAMIC SPEAKER LAYOUT — PROPERTY TEST REPORT');
console.log('══════════════════════════════════════════════════════');
console.log(`  fast-check seed: 42 | runs per property: ${RUNS}`);
console.log('══════════════════════════════════════════════════════\n');

for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [${r.id}] ${r.desc}`);
  if (r.error) console.log(`     ↳ ${r.error}`);
}

console.log('\n──────────────────────────────────────────────────────');
console.log(`  Passed:  ${totalPassed} / ${results.length}`);
console.log(`  Failed:  ${totalFailed} / ${results.length}`);
if (edgeCases.length > 0) {
  console.log('\n  Edge cases found:');
  edgeCases.forEach(e => console.log(`    • ${e}`));
} else {
  console.log('\n  Edge cases found: none');
}
if (perfTimings.length > 0) {
  const { avg, max, samples } = perfTimings[0];
  console.log(`\n  Performance (computeLayout 200 speakers):`);
  console.log(`    avg = ${avg.toFixed(3)}ms  max = ${max.toFixed(3)}ms  (${samples} samples)`);
  console.log(`    Budget: < 2ms per run — ${avg < 2 ? 'WITHIN' : 'EXCEEDS'} budget`);
}
console.log('══════════════════════════════════════════════════════\n');

process.exit(totalFailed > 0 ? 1 : 0);
