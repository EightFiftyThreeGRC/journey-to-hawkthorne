#!/usr/bin/env node
// Level reachability checker for index.html.
// Loads the game script with a stubbed canvas, then explores each level by running the game's own
// physicsStep() with many input patterns (walks, short/full jumps, double jumps, drops, ladders).
// Every stage lists targets that must be reachable with the abilities the player has at that point.
//   usage: node tools/check-levels.mjs [levelIndex] [--map]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

const noop = () => {};
const fakeCtx = new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 0 }) : noop, set: (t, k, v) => { t[k] = v; return true; } });
const fakeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => fakeCtx });
const sandbox = {
  console, Math, JSON, Set, Map, Object, Array, String, Number, Symbol, parseInt, parseFloat, isNaN, Infinity,
  document: { getElementById: fakeCanvas, createElement: fakeCanvas },
  window: { addEventListener: noop, innerWidth: 960, innerHeight: 720 },
  navigator: {}, location: { search: '', hash: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  performance: { now: () => 0 }, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__H={game,LEVELS,buildLevel,physicsStep,makePlayer,makeEntity,TILEDEF,ENT,touchesHazard,TS,boxOverlap};', sandbox);
const { game, LEVELS, buildLevel, physicsStep, makePlayer, makeEntity, touchesHazard, TS, boxOverlap } = sandbox.__H;

const DT = 1 / 60;
function setupLevel(idx, opts) {
  game.s.items = { ...opts.items };
  game.s.flags = { ...(opts.flags || {}) };
  const L = buildLevel(idx);
  game.L = L;
  const ents = [];
  let spawn = null;
  for (const sp of L.spawns) {
    if (sp.mk.type === 'spawn') { spawn = { x: sp.tx * TS + 3, y: (sp.ty + 1) * TS - 14 }; continue; }
    const e = makeEntity(sp); if (!e) continue;
    e.ch = sp.ch;
    ents.push(e);
  }
  const solids = [];
  for (const e of ents) {
    if (e.type === 'lift') {
      const steps = Math.max(1, Math.round(e.rangePx / 12));
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        solids.push({ platform: true, x: e.path === 'v' ? e.x0 : e.x0 + k * e.rangePx * (e.dir || 1), y: e.path === 'v' ? e.y0 - k * e.rangePx * (e.dir || 1) : e.y0, w: e.w, h: 6 });
      }
    } else if (e.type === 'spring') solids.push(e);
    else if (e.type === 'crate') solids.push(e);
    else if (e.solid && !(opts.open || []).some(f => f(e))) solids.push(e);
  }
  game.solids = solids;
  return { L, ents, spawn };
}

function* programs(boots, onLadder, onOneway) {
  for (const d of [-1, 1]) for (const T of [0.1, 0.22]) yield { kind: 'walk', dir: d, holdT: T };
  for (const d of [-1, 0, 1]) for (const hj of [0.1, 9]) for (const ds of [0, 0.18]) for (const de of [9, 0.3]) {
    if (d === 0 && (ds || de < 9)) continue;
    yield { kind: 'jump', dir: d, hj, ds, de };
  }
  if (boots) for (const d of [-1, 0, 1]) for (const t2 of [0.22, 0.42]) for (const de of [9, 0.65]) for (const ds of [0, 0.3]) {
    if (d === 0 && (de < 9 || ds)) continue;
    yield { kind: 'jump', dir: d, hj: 9, ds, de, t2 };
  }
  if (onOneway) for (const d of [-1, 0, 1]) yield { kind: 'drop', dir: d };
  if (onLadder) {
    yield { kind: 'climb', up: true }; yield { kind: 'climb', up: false };
    for (const t of [0.4, 0.8, 1.2, 1.6]) for (const d of [-1, 1]) yield { kind: 'climb', up: true, jumpAt: t, dir: d };
  }
}

function simulate(start, prog, targets, reached) {
  const p = makePlayer(start.x, start.y);
  p.onGround = true;
  let left = false;
  const maxT = prog.kind === 'climb' ? 6 : 3.2;
  for (let i = 0, t = 0; t < maxT; i++, t += DT) {
    const inp = { left: false, right: false, up: false, down: false, jumpP: false, jumpH: false, upP: false };
    const setDir = (d) => { if (d < 0) inp.left = true; if (d > 0) inp.right = true; };
    if (prog.kind === 'walk') { if (t < prog.holdT) setDir(prog.dir); }
    else if (prog.kind === 'jump') {
      if (i === 0) inp.jumpP = true;
      if (t < prog.hj) inp.jumpH = true;
      if (prog.t2 !== undefined) { if (Math.abs(t - prog.t2) < DT / 2) inp.jumpP = true; if (t > prog.t2) inp.jumpH = true; }
      if (t >= prog.ds && t < prog.de) setDir(prog.dir);
    } else if (prog.kind === 'drop') { if (i === 0) { inp.down = true; inp.jumpP = true; } if (i > 2) setDir(prog.dir); }
    else if (prog.kind === 'climb') {
      if (prog.jumpAt !== undefined && t >= prog.jumpAt) { if (Math.abs(t - prog.jumpAt) < DT / 2) inp.jumpP = true; inp.jumpH = true; setDir(prog.dir); }
      else if (prog.up) inp.up = true; else inp.down = true;
    }
    physicsStep(p, inp, DT);
    for (const tg of targets) if (!reached.has(tg.name) && boxOverlap({ x: p.x - tg.pad, y: p.y - tg.pad, w: p.w + 2 * tg.pad, h: p.h + 2 * tg.pad }, tg.box)) reached.add(tg.name);
    if (p.y > game.L.pxH + 20 || touchesHazard(p)) return null;
    if (!p.onGround || p.climb) left = true;
    const done = prog.kind === 'walk' ? (t > prog.holdT + 0.05 && p.onGround && Math.abs(p.vx) < 1) : (left && p.onGround && !p.climb);
    if (done && i > 1) return { x: p.x, y: p.y };
  }
  return null;
}

function explore(from, boots, targets) {
  const reached = new Set(), seen = new Map(), queue = [];
  const key = (s) => Math.floor((s.x + 5) / TS) + ',' + Math.round((s.y + 14) / TS);
  const push = (s) => { const k = key(s); if (!seen.has(k)) { seen.set(k, s); queue.push(s); } };
  push(from);
  while (queue.length) {
    const s = queue.shift();
    for (const tg of targets) if (!reached.has(tg.name) && boxOverlap({ x: s.x - tg.pad, y: s.y - tg.pad, w: 10 + 2 * tg.pad, h: 14 + 2 * tg.pad }, tg.box)) reached.add(tg.name);
    const cx = Math.floor((s.x + 5) / TS), fy = Math.round((s.y + 14) / TS);
    const onLadder = sandbox.__H.game && (tAtL(cx, fy) === 'H' || tAtL(cx, fy - 1) === 'H');
    const d = sandbox.__H.TILEDEF[tAtL(cx, fy)];
    const onOneway = (d && d.o) || tAtL(cx, fy) === 'H' || game.solids.some(q => q.platform && Math.abs(q.y - (s.y + 14)) < 1 && s.x + 10 > q.x && s.x < q.x + q.w);
    for (const prog of programs(boots, onLadder, onOneway)) {
      const r = simulate(s, prog, targets, reached);
      if (r) push(r);
    }
  }
  return { reached, seen };
}
function tAtL(tx, ty) { const L = game.L; if (tx < 0 || tx >= L.w) return '#'; if (ty < 0 || ty >= L.h) return ' '; return L.grid[ty][tx]; }

// --------------------------------------------------------------------------- stage definitions
const T = (pred, name, pad = 8) => ({ pred, name, pad });
const byType = (type, extra = () => true) => (e) => e.type === type && extra(e);
const at = (type, tx, ty) => (e) => e.type === type && e.tx === tx && e.ty === ty;
const STAGES = [
  { level: 0, stages: [
    { items: {}, targets: [T(byType('npc', e => e.npc === 'hilda'), 'Hilda'), T(byType('npc', e => e.npc === 'blacksmith'), 'Blacksmith'), T(byType('npc', e => e.npc === 'britta'), 'Britta'), T(byType('npc', e => e.npc === 'pierce'), 'Pierce'), T(byType('exit'), 'Cave mouth'), T(byType('trigger', e => e.scene === 'troy_recruit'), 'Troy trigger', 0), T(byType('trigger', e => e.scene === 'smithy_scene'), 'Smithy trigger', 0)],
      optional: [T(byType('page'), 'Journal page I', 0), T(byType('chest'), 'Chests'), T(byType('coin'), 'Coins', 0)] },
  ] },
  { level: 1, stages: [
    { items: { lantern: 1 }, flags: { troy: 1 }, open: [e => e.type === 'rubble'], targets: [T(byType('boots'), 'Boots', 0), T(byType('npc', e => e.talk === 'gilbert_pinned'), 'Gilbert (pinned)')], forbid: [T(byType('exit'), 'Exit without boots', 0)],
      optional: [T(byType('page'), 'Journal page II', 0)] },
    { items: { lantern: 1, boots: 1 }, from: byType('boots'), targets: [T(byType('crystal'), 'White Crystal', 0)] },
    { items: { lantern: 1, boots: 1, crystal: 1 }, from: byType('crystal'), targets: [T(byType('exit'), 'Exit', 0), T(byType('trigger', e => e.scene === 'void_stop'), 'Void stop', 0)] },
  ] },
  { level: 2, stages: [
    { items: { boots: 1 }, open: [e => e.type === 'rubble'], targets: [T(byType('npc', e => e.npc === 'merchant'), 'Merchant'), T(byType('npc', e => e.npc === 'guardian'), 'Guardian'), T(byType('exit'), 'Exit flag', 0), T(byType('trigger'), 'Gilbert trigger', 0)],
      optional: [T(byType('page'), 'Journal page III', 0), T(byType('coin'), 'Coins', 0)] },
    { items: {}, open: [e => e.type === 'rubble'], targets: [T(byType('exit'), 'Exit flag (no boots)', 0)] },
  ] },
  { level: 3, stages: [
    { items: { boots: 1 }, targets: [T(byType('gate'), 'Gate'), T(byType('towelette', e => e.tx < 18), 'Courtyard towelette', 0)], forbid: [T(at('checkpoint', 21, 56), 'Great hall')] },
    { items: { boots: 1 }, open: [e => e.type === 'gate'], targets: [T(byType('seal', e => e.ch === '4'), 'Seal I'), T(at('towelette', 25, 51), 'Great hall towelette', 0)], forbid: [T(at('checkpoint', 48, 46), 'Floor 2')] },
    { items: { boots: 1 }, open: [e => e.type === 'gate', e => e.ch === '4'], targets: [T(byType('rubble'), "Troy's last wall"), T(at('checkpoint', 48, 46), 'Floor 2 checkpoint', 0)], forbid: [T(at('checkpoint', 25, 36), 'Floor 3')] },
    { items: { boots: 1 }, open: [e => e.type === 'gate', e => e.ch === '4', e => e.type === 'rubble'], targets: [T(byType('seal', e => e.ch === '7'), 'Seal II'), T(at('towelette', 31, 41), 'Floor 2 towelette', 0), T(at('towelette', 43, 31), 'Floor 3 towelette', 0)], forbid: [T(at('checkpoint', 52, 26), 'Floor 4')] },
    { items: { boots: 1 }, open: [e => e.type === 'gate', e => e.ch === '4', e => e.type === 'rubble', e => e.ch === '7'], targets: [T(byType('seal', e => e.ch === 'A'), 'Seal III'), T(at('towelette', 34, 22), 'Floor 4 towelette', 0)], optional: [T(byType('page'), 'Journal page IV', 0)], forbid: [T(at('checkpoint', 22, 16), 'Battlements')] },
    { items: { boots: 1 }, open: [e => e.solid], targets: [T(byType('trigger'), 'Gilbert duel', 0), T(byType('exit'), 'Throne door')] },
  ] },
  { level: 4, stages: [
    { items: { boots: 1 }, targets: [], optional: [] },
  ] },
];

const only = process.argv.slice(2).find(a => /^\d+$/.test(a));
const showMap = process.argv.includes('--map');
let failed = 0;
for (const lv of STAGES) {
  if (only !== undefined && +only !== lv.level) continue;
  console.log(`\n== Level ${lv.level}: ${LEVELS[lv.level].name}`);
  for (const [si, st] of lv.stages.entries()) {
    const { L, ents, spawn } = setupLevel(lv.level, st);
    const mk = (list) => list.flatMap(tg => ents.filter(tg.pred).map((e, i, arr) => ({ name: arr.length > 1 ? `${tg.name} #${i + 1} (${Math.floor(e.x / TS)},${Math.floor(e.y / TS)})` : tg.name, box: e, pad: tg.pad })));
    const targets = mk(st.targets), optional = mk(st.optional || []), forbid = mk(st.forbid || []);
    let from = spawn;
    if (st.from) { const e = ents.find(st.from); from = { x: e.x + e.w / 2 - 5, y: e.y + e.h - 14 }; }
    const t0 = Date.now();
    const { reached, seen } = explore(from, !!st.items.boots, targets.concat(optional, forbid));
    const miss = targets.filter(t => !reached.has(t.name));
    const leak = forbid.filter(t => reached.has(t.name));
    const optMiss = optional.filter(t => !reached.has(t.name));
    console.log(`  stage ${si + 1}: ${seen.size} standing spots, ${((Date.now() - t0) / 1000).toFixed(1)}s` + (miss.length ? `  ✗ UNREACHABLE: ${miss.map(t => t.name).join(', ')}` : '  ✓ all required targets reachable'));
    if (optMiss.length) console.log(`           optional not reached: ${optMiss.map(t => t.name).join(', ')}`);
    if (leak.length) console.log(`           ✗ SEQUENCE BREAK — reachable too early: ${leak.map(t => t.name).join(', ')}`);
    failed += miss.length + leak.length;
    if (showMap) {
      const rows = L.grid.map(r => r.map(c => c === ' ' ? '·' : c));
      for (const k of seen.keys()) { const [x, y] = k.split(',').map(Number); if (rows[y - 1] && rows[y - 1][x] !== undefined) rows[y - 1][x] = '●'; }
      console.log(rows.map(r => r.join('')).join('\n'));
    }
  }
}
console.log(failed ? `\n${failed} required target(s) unreachable` : '\nAll levels completable.');
process.exit(failed ? 1 : 0);
