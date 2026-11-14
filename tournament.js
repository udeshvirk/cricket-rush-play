// Standalone, JSON-saveable tournament rules. No team data or browser dependencies.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CricketTournament = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function integer(n, min, max) {
    return Number.isSafeInteger(n) && n >= min && n <= max;
  }
  function hash(value) {
    var h = 2166136261;
    for (var i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function create(options) {
    var o = options || {}, ids = o.teamIds;
    if (o.kind !== 'world' && o.kind !== 'ipl') throw new Error('Invalid tournament kind');
    if (!Array.isArray(ids) || ids.length !== 10 || new Set(ids).size !== 10 ||
        !ids.every(function (id) { return integer(id, 0, Number.MAX_SAFE_INTEGER); }))
      throw new Error('Exactly ten distinct numeric team indices required');
    if (ids.indexOf(o.userId) < 0) throw new Error('User team must be a participant');
    if (!integer(o.overs, 1, 50)) throw new Error('Overs must be an integer from 1 to 50');
    var diff = o.diff === undefined ? 'normal' : o.diff;
    if (!(typeof diff === 'string' || (typeof diff === 'number' && Number.isFinite(diff))))
      throw new Error('Difficulty must be a string or finite number');
    var seed = o.seed === undefined ? 1 : o.seed;
    if (!(typeof seed === 'string' || (typeof seed === 'number' && Number.isFinite(seed))))
      throw new Error('Seed must be a string or finite number');
    var s = {v: 1, id: o.kind + '-' + hash(JSON.stringify([ids, o.userId, o.overs, diff, seed])).toString(16),
      kind: o.kind, teamIds: ids.slice(), userId: o.userId, overs: o.overs, diff: diff,
      fixtures: [], finished: false, winner: null, rng: hash(String(seed))};
    var ring = ids.slice();
    for (var round = 1; round <= 9; round++) {
      for (var pair = 0; pair < 5; pair++) {
        var a = ring[pair], b = ring[9 - pair];
        if (round % 2 === 0) { var swap = a; a = b; b = swap; }
        s.fixtures.push({id: 'league-' + round + '-' + (pair + 1), a: a, b: b,
          stage: 'league', round: round, result: null});
      }
      ring.splice(1, 0, ring.pop());
    }
    return s;
  }
  function standings(s) {
    var rows = s.teamIds.map(function (id) {
      return {id: id, p: 0, w: 0, l: 0, t: 0, pts: 0, nrr: 0,
        runs: 0, balls: 0, against: 0, faced: 0};
    });
    s.fixtures.forEach(function (f) {
      if (f.stage !== 'league' || !f.result) return;
      var a = rows[s.teamIds.indexOf(f.a)], b = rows[s.teamIds.indexOf(f.b)], r = f.result;
      a.p++; b.p++;
      if (r.winner === null) { a.t++; b.t++; a.pts++; b.pts++; }
      else {
        var win = r.winner === f.a ? a : b, lose = win === a ? b : a;
        win.w++; win.pts += 2; lose.l++;
      }
      var ab = r.a.wkts >= 10 ? s.overs * 6 : r.a.balls;
      var bb = r.b.wkts >= 10 ? s.overs * 6 : r.b.balls;
      a.runs += r.a.runs; a.balls += ab; a.against += r.b.runs; a.faced += bb;
      b.runs += r.b.runs; b.balls += bb; b.against += r.a.runs; b.faced += ab;
    });
    rows.forEach(function (r) {
      // A zero cumulative legal-ball denominator contributes a rate of zero.
      // Runs still accumulate and count once that team has legal balls recorded.
      r.nrr = (r.balls ? 6 * r.runs / r.balls : 0) - (r.faced ? 6 * r.against / r.faced : 0);
    });
    rows.sort(function (a, b) {
      return b.pts - a.pts || b.nrr - a.nrr || b.w - a.w || s.teamIds.indexOf(a.id) - s.teamIds.indexOf(b.id);
    });
    return rows.map(function (r) { return {id: r.id, p: r.p, w: r.w, l: r.l, t: r.t, pts: r.pts, nrr: r.nrr}; });
  }
  function next(s) {
    if (s.finished) return null;
    var pending = s.fixtures.find(function (f) { return f.result === null; });
    if (pending) return pending;
    var ranks = standings(s).map(function (r) { return r.id; });
    function find(stage) { return s.fixtures.find(function (f) { return f.stage === stage; }); }
    function add(stage, a, b) {
      var f = {id: stage, a: a, b: b, stage: stage, result: null};
      s.fixtures.push(f); return f;
    }
    function winner(f) { return f.result.advance; }
    if (s.kind === 'world') {
      if (!find('sf1')) {
        var first = add('sf1', ranks[0], ranks[3]);
        add('sf2', ranks[1], ranks[2]); return first;
      }
      if (!find('final')) return add('final', winner(find('sf1')), winner(find('sf2')));
    } else {
      if (!find('q1')) {
        var q1 = add('q1', ranks[0], ranks[1]);
        add('eliminator', ranks[2], ranks[3]); return q1;
      }
      if (!find('q2')) {
        var q = find('q1'), loser = winner(q) === q.a ? q.b : q.a;
        return add('q2', loser, winner(find('eliminator')));
      }
      if (!find('final')) return add('final', winner(find('q1')), winner(find('q2')));
    }
    s.finished = true; s.winner = winner(find('final')); return null;
  }
  function record(s, fixtureId, result) {
    var f = s.fixtures.find(function (item) { return item.id === fixtureId; });
    if (!f) throw new Error('Unknown fixture');
    if (f.result !== null) return f.result;
    function score(x) {
      if (!x || !integer(x.runs, 0, Number.MAX_SAFE_INTEGER) || !integer(x.wkts, 0, 10) ||
          !integer(x.balls, 0, s.overs * 6))
        throw new Error('Invalid innings score');
      // Wides can score runs and take wickets without consuming legal balls.
      return {runs: x.runs, wkts: x.wkts, balls: x.balls};
    }
    if (!result) throw new Error('Result required');
    var a = score(result.a), b = score(result.b);
    var expected = a.runs === b.runs ? null : a.runs > b.runs ? f.a : f.b;
    if (result.winner !== expected) throw new Error('Winner must match scores and fixture sides');
    var normalized = {a: a, b: b, winner: expected};
    if (f.stage !== 'league') {
      var ranks = standings(s).map(function (r) { return r.id; });
      normalized.advance = expected === null ? (ranks.indexOf(f.a) < ranks.indexOf(f.b) ? f.a : f.b) : expected;
      if (result.advance !== undefined && result.advance !== normalized.advance) throw new Error('Invalid advancing team');
    } else if (result.advance !== undefined) throw new Error('League results have no advancing team');
    // Commit only after every validation has succeeded. Copy inputs to prevent aliasing.
    f.result = normalized;
    if (f.stage === 'final') { s.finished = true; s.winner = normalized.advance; }
    return normalized;
  }
  function simulate(s, fixture) {
    var f = s.fixtures.find(function (item) { return fixture && item.id === fixture.id; });
    if (!f || f.a !== fixture.a || f.b !== fixture.b) throw new Error('Unknown fixture');
    if (f.result) return JSON.parse(JSON.stringify(f.result));
    function random() {
      s.rng = (s.rng + 0x6D2B79F5) >>> 0;
      var t = s.rng;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    var balls = s.overs * 6;
    var a = {runs: Math.floor(balls * (0.65 + random() * 1.8)),
      wkts: Math.min(balls, Math.floor(random() * 10)), balls: balls};
    var targetRuns = Math.floor(balls * (0.65 + random() * 1.8));
    var b = {runs: targetRuns > a.runs ? a.runs + 1 + Math.floor(random() * 6) : targetRuns,
      wkts: Math.min(balls, Math.floor(random() * 10)), balls: balls};
    if (b.runs > a.runs) b.balls = Math.max(b.wkts, 1, Math.ceil(balls * (0.55 + random() * 0.45)));
    return {a: a, b: b, winner: a.runs === b.runs ? null : a.runs > b.runs ? f.a : f.b};
  }
  return {create: create, next: next, record: record, standings: standings, simulate: simulate};
});
