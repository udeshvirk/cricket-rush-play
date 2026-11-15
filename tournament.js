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
    if (o.ratings) s.ratings = JSON.parse(JSON.stringify(o.ratings));   // {teamId: {bat, bowl}}: simulated fixtures follow them
    if (o.kind === 'world') {
      // Two groups of five. Teams are drawn in pairs by list order (roughly strength), one of each pair to each group.
      var draw = hash('groups' + String(seed)), groups = [[], []];
      for (var k = 0; k < 10; k += 2) {
        var flip = (draw >>> (k / 2)) & 1;
        groups[flip].push(ids[k]); groups[1 - flip].push(ids[k + 1]);
      }
      s.groups = groups;
      // Five rounds of a five-team circle (one team rests each round); both groups play in every round.
      var rings = groups.map(function (five) { return five.concat([null]); });
      for (var gr = 1; gr <= 5; gr++) {
        for (var g = 0; g < 2; g++) {
          var slot = rings[g];
          for (var pr = 0; pr < 3; pr++) {
            var x = slot[pr], y = slot[5 - pr];
            if (x === null || y === null) continue;
            if (gr % 2 === 0) { var t = x; x = y; y = t; }
            s.fixtures.push({id: 'group-' + 'AB'[g] + '-' + gr + '-' + (pr + 1), a: x, b: y,
              stage: 'league', group: g, round: gr, result: null});
          }
          slot.splice(1, 0, slot.pop());
        }
      }
      return s;
    }
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
  // Pass a group number (0 = A, 1 = B) for one group's table; without it, every team ranked together.
  function standings(s, group) {
    var ids = group === undefined || !s.groups ? s.teamIds : s.groups[group];
    var rows = ids.map(function (id) {
      return {id: id, p: 0, w: 0, l: 0, t: 0, pts: 0, nrr: 0,
        runs: 0, balls: 0, against: 0, faced: 0};
    });
    s.fixtures.forEach(function (f) {
      if (f.stage !== 'league' || !f.result) return;
      var a = rows[ids.indexOf(f.a)], b = rows[ids.indexOf(f.b)], r = f.result;
      if (!a || !b) return;
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
    if (s.kind === 'world' && s.groups) {
      if (!find('sf1')) {
        var A = standings(s, 0), B = standings(s, 1);
        var top = add('sf1', A[0].id, B[1].id);
        add('sf2', B[0].id, A[1].id); return top;
      }
      if (!find('final')) return add('final', winner(find('sf1')), winner(find('sf2')));
    } else if (s.kind === 'world') {
      // A World Cup saved before groups: everyone played everyone, top four.
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
    // Level scores decided by a Super Over: the result names its winner, who takes the win (league) or advances (knockout).
    var superOver = result.superOver === true;
    if (superOver) {
      if (expected !== null || (result.winner !== f.a && result.winner !== f.b)) throw new Error('A Super Over needs level scores and a winning side');
      expected = result.winner;
    } else if (result.superOver !== undefined) throw new Error('Invalid Super Over flag');
    if (result.winner !== expected) throw new Error('Winner must match scores and fixture sides');
    var normalized = {a: a, b: b, winner: expected};
    if (superOver) normalized.superOver = true;
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
  // A fixture you don't play. With team ratings (s.ratings[id] = {bat, bowl}, 0-100, set by the game) the score follows them:
  // the scoring rate and how often wickets fall come from the batting side's batting against the other side's bowling,
  // fitted to whole matches the game's own engine plays between computer sides. Without ratings (old saves), plain chance.
  var RATE = [[1, 12], [2, 12], [5, 12.9], [20, 10.4], [50, 9.3]];          // runs an over between two average sides
  var WKT = [[1, 0.078], [5, 0.077], [20, 0.058], [50, 0.058]];             // wickets a ball
  var MID = {bat: 79, bowl: 81};
  function table(t, x) {
    for (var i = 1; i < t.length; i++) if (x <= t[i][0]) {
      var u = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][1] + Math.max(0, u) * (t[i][1] - t[i - 1][1]);
    }
    return t[t.length - 1][1];
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
    var R = s.ratings, ra = R && R[f.a], rb = R && R[f.b];
    if (!ra || !rb) {
      var a = {runs: Math.floor(balls * (0.65 + random() * 1.8)),
        wkts: Math.min(balls, Math.floor(random() * 10)), balls: balls};
      var targetRuns = Math.floor(balls * (0.65 + random() * 1.8));
      var b = {runs: targetRuns > a.runs ? a.runs + 1 + Math.floor(random() * 6) : targetRuns,
        wkts: Math.min(balls, Math.floor(random() * 10)), balls: balls};
      if (b.runs > a.runs) b.balls = Math.max(b.wkts, 1, Math.ceil(balls * (0.55 + random() * 0.45)));
      return {a: a, b: b, winner: a.runs === b.runs ? null : a.runs > b.runs ? f.a : f.b};
    }
    function gauss() { return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()); }
    function innings(bat, bowl, target) {
      var dB = bat.bat - MID.bat, dW = bowl.bowl - MID.bowl;
      var perBall = table(RATE, s.overs) / 6 * Math.exp(0.0075 * dB - 0.006 * dW + 0.12 * gauss());
      var wkPerBall = table(WKT, s.overs) * Math.exp(-0.017 * dB + 0.008 * dW);
      var allOut = Math.max(10, Math.round(10 / wkPerBall * Math.exp(0.3 * gauss())));   // balls until the tenth wicket
      var last = Math.min(balls, allOut);
      if (target !== undefined) {
        var need = Math.ceil(target / perBall);
        if (need <= last) {   // got there: the winning hit can go past the target
          return {runs: target + (random() < 0.3 ? Math.floor(random() * 5) : 0), balls: Math.max(1, need),
            wkts: Math.min(9, Math.floor(10 * need / allOut + random()))};
        }
      }
      var runs = Math.floor(perBall * last);
      if (target !== undefined && runs >= target) runs = target - 1;
      return {runs: runs, balls: last, wkts: allOut <= balls ? 10 : Math.min(9, Math.floor(10 * balls / allOut + random()))};
    }
    var first = innings(ra, rb), second = innings(rb, ra, first.runs + 1);
    return {a: first, b: second, winner: first.runs === second.runs ? null : first.runs > second.runs ? f.a : f.b};
  }
  return {create: create, next: next, record: record, standings: standings, simulate: simulate};
});
