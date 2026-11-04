/* Gully Scorer engine.
 * The whole match is a list of actions. State is always rebuilt by replaying them,
 * so undo, "edit a past ball" and "undo into the first innings" are just list edits. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cricket = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUPER_WICKETS = 2;
  var WICKET_KINDS = ['bowled', 'caught', 'lbw', 'stumped', 'hitwicket', 'runout'];

  function oversText(legal) {
    return Math.floor(legal / 6) + '.' + (legal % 6);
  }

  function uniqueNames(list) {
    var seen = {};
    return list.map(function (n) {
      var name = n, k = 2;
      while (seen[name.toLowerCase()]) name = n + ' ' + k++;
      seen[name.toLowerCase()] = true;
      return name;
    });
  }

  function normalizeConfig(c) {
    c = c || {};
    var teams = [
      String((c.teams && c.teams[0]) || 'Team A').trim() || 'Team A',
      String((c.teams && c.teams[1]) || 'Team B').trim() || 'Team B'
    ];
    if (teams[0].toLowerCase() === teams[1].toLowerCase()) teams[1] = teams[1] + ' 2';
    var per = Math.max(2, parseInt(c.playersPerSide, 10) || 6);
    var players = [0, 1].map(function (t) {
      var given = (c.players && c.players[t]) || [];
      var list = given.map(function (s) { return String(s).trim(); }).filter(Boolean);
      if (!list.length) {
        for (var i = 1; i <= per; i++) list.push((t === 0 ? 'A' : 'B') + i);
      }
      return uniqueNames(list);
    });
    return {
      teams: teams,
      players: players,
      overs: parseInt(c.overs, 10) || 5,
      maxOversPerBowler: parseInt(c.maxOversPerBowler, 10) || 0,
      extraRun: c.extraRun === undefined ? true : !!c.extraRun,
      lastMan: !!c.lastMan,
      firstBat: c.firstBat === 1 ? 1 : 0,
      hands: (c.hands && typeof c.hands === 'object') ? c.hands : {}
    };
  }

  function validateConfig(cfg) {
    if (cfg.overs < 1 || cfg.overs > 50) return 'Overs must be between 1 and 50.';
    if (cfg.players[0].length < 2 || cfg.players[1].length < 2) return 'Each team needs at least 2 players.';
    if (cfg.maxOversPerBowler > 0) {
      for (var t = 0; t < 2; t++) {
        if (cfg.maxOversPerBowler * cfg.players[t].length < cfg.overs) {
          return cfg.teams[t] + ' only has ' + cfg.players[t].length + ' bowlers, so at ' +
            cfg.maxOversPerBowler + ' over(s) each they cannot cover ' + cfg.overs + ' overs.';
        }
      }
    }
    return null;
  }

  function createMatch(config) {
    var cfg = normalizeConfig(config);
    var err = validateConfig(cfg);
    if (err) throw new Error(err);
    return { config: cfg, actions: [] };
  }

  function freshBatter(name) {
    return { name: name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: '', bowler: '' };
  }

  function newInnings(st, idx) {
    var cfg = st.cfg;
    var round = idx < 2 ? 0 : Math.floor((idx - 2) / 2) + 1;
    var pos = idx < 2 ? idx : (idx - 2) % 2;
    var firstBat = (cfg.firstBat + (round % 2)) % 2;
    var bat = pos === 0 ? firstBat : 1 - firstBat;
    var isSuper = round > 0;
    var n = cfg.players[bat].length;
    var maxWk = isSuper ? Math.min(SUPER_WICKETS, n - 1) : (cfg.lastMan ? n : n - 1);
    return {
      idx: idx, round: round, pos: pos, bat: bat, bowl: 1 - bat, isSuper: isSuper,
      overs: isSuper ? 1 : cfg.overs, maxWk: maxWk,
      target: pos === 1 ? st.innings[idx - 1].runs + 1 : null,
      runs: 0, wkts: 0, legal: 0,
      extras: { wd: 0, nb: 0, b: 0, lb: 0 },
      balls: [], batters: {}, order: [],
      striker: null, nonStriker: null, solo: false,
      bowler: null, lastBowler: null, bowlers: {}, bowlerOrder: [],
      freeHit: false, needOpen: true, needBowler: true,
      closed: false, closeReason: null, done: false
    };
  }

  function closeInnings(cur, reason) {
    cur.closed = true;
    cur.closeReason = reason;
    cur.needBowler = false;
    cur.needOpen = false;
  }

  function swapEnds(cur) {
    var t = cur.striker;
    cur.striker = cur.nonStriker;
    cur.nonStriker = t;
  }

  function nextBatter(st, cur) {
    var roster = st.cfg.players[cur.bat];
    for (var i = 0; i < roster.length; i++) {
      if (!cur.batters[roster[i]]) return roster[i];
    }
    return null;
  }

  function dismissalText(kind, bowler) {
    switch (kind) {
      case 'bowled': return 'b ' + bowler;
      case 'caught': return 'c & b ' + bowler;
      case 'lbw': return 'lbw b ' + bowler;
      case 'stumped': return 'st b ' + bowler;
      case 'hitwicket': return 'hit wicket b ' + bowler;
      case 'runout': return 'run out';
    }
    return kind;
  }

  function doOpen(st, cur, a) {
    if (!cur.needOpen) throw new Error('Opening batters are already set');
    var roster = st.cfg.players[cur.bat];
    if (roster.indexOf(a.striker) < 0 || roster.indexOf(a.nonStriker) < 0) throw new Error('Pick batters from the batting team');
    if (a.striker === a.nonStriker) throw new Error('Pick two different batters');
    cur.striker = a.striker;
    cur.nonStriker = a.nonStriker;
    cur.batters[a.striker] = freshBatter(a.striker);
    cur.batters[a.nonStriker] = freshBatter(a.nonStriker);
    cur.order.push(a.striker, a.nonStriker);
    cur.needOpen = false;
  }

  function doBowler(st, cur, a) {
    if (cur.closed) throw new Error('Innings is over');
    if (cur.needOpen) throw new Error('Choose the opening batters first');
    if (!cur.needBowler) throw new Error('The over is still in progress');
    var roster = st.cfg.players[cur.bowl];
    if (roster.indexOf(a.name) < 0) throw new Error('Pick a bowler from the fielding team');
    var b = cur.bowlers[a.name];
    var cap = st.cfg.maxOversPerBowler;
    if (!cur.isSuper && cap && b && b.legal >= cap * 6) {
      throw new Error(a.name + ' has bowled the maximum ' + cap + ' over' + (cap === 1 ? '' : 's'));
    }
    if (!b) {
      cur.bowlers[a.name] = { name: a.name, legal: 0, runs: 0, wkts: 0, wd: 0, nb: 0 };
      cur.bowlerOrder.push(a.name);
    }
    cur.bowler = a.name;
    cur.needBowler = false;
  }

  function doBall(st, cur, a, actionIdx) {
    if (cur.closed) throw new Error('Innings is over');
    if (cur.needOpen) throw new Error('Choose the opening batters first');
    if (cur.needBowler) throw new Error('Choose a bowler first');
    var cfg = st.cfg;
    var runs = a.runs | 0;
    if (runs < 0 || runs > 7) throw new Error('Runs must be between 0 and 7');
    var extra = a.extra || null;
    if (extra && ['wd', 'nb', 'b', 'lb'].indexOf(extra) < 0) throw new Error('Unknown extra');
    var isWd = extra === 'wd', isNb = extra === 'nb', isBye = extra === 'b' || extra === 'lb';
    var legal = !(isWd || isNb);
    var pen = (isWd || isNb) ? ((a.pen === undefined ? cfg.extraRun : a.pen) ? 1 : 0) : 0;
    var freeHit = cur.freeHit;

    // Is the wicket valid for this delivery?
    var wk = a.wicket || null;
    var notOut = null;
    if (wk) {
      if (WICKET_KINDS.indexOf(wk.kind) < 0) throw new Error('Unknown dismissal');
      var k = wk.kind, allowed;
      if (k === 'runout') allowed = true;
      else if (isNb || freeHit) allowed = false;
      else if (isWd) allowed = (k === 'stumped' || k === 'hitwicket');
      else if (isBye) allowed = false;
      else allowed = true;
      if (!allowed) { notOut = k; wk = null; }
    }
    if (wk && wk.kind !== 'runout') runs = 0;

    var batRuns = 0, ext = 0, bowlerRuns = 0;
    if (isWd) { ext = pen + runs; cur.extras.wd += ext; bowlerRuns = ext; }
    else if (isNb) { batRuns = runs; ext = pen; cur.extras.nb += pen; bowlerRuns = pen + runs; }
    else if (isBye) { ext = runs; cur.extras[extra] += runs; }
    else { batRuns = runs; bowlerRuns = runs; }
    var total = batRuns + ext;

    var S = cur.striker;
    var bs = cur.batters[S];
    var bw = cur.bowlers[cur.bowler];
    if (!isWd) bs.balls++;
    if (!isBye && !isWd) {
      bs.runs += batRuns;
      if (batRuns === 4) bs.fours++;
      if (batRuns === 6) bs.sixes++;
    }
    bw.runs += bowlerRuns;
    if (legal) bw.legal++;
    if (isWd) bw.wd++;
    if (isNb) bw.nb++;

    var overNo = Math.floor(cur.legal / 6);
    if (legal) cur.legal++;
    cur.runs += total;

    // 1. strike changes on odd runs (nobody to swap with when the last man stands alone)
    if (runs % 2 === 1 && !cur.solo) swapEnds(cur);

    // 2. wicket: the new batter takes the end the dismissed batter was at
    var outName = null;
    if (wk) {
      if (wk.kind === 'runout') {
        outName = wk.out || cur.striker;
        if (outName !== cur.striker && outName !== cur.nonStriker) throw new Error('Pick one of the two batters at the crease');
      } else {
        outName = cur.striker;
      }
      var bo = cur.batters[outName];
      bo.out = true;
      bo.bowler = cur.bowler;
      bo.how = dismissalText(wk.kind, cur.bowler);
      cur.wkts++;
      if (wk.kind !== 'runout') bw.wkts++;
      if (cur.striker === outName) cur.striker = null; else cur.nonStriker = null;

      if (cur.wkts < cur.maxWk) {
        var n = cfg.players[cur.bat].length;
        if (!cur.isSuper && cfg.lastMan && cur.wkts === n - 1) {
          cur.striker = cur.striker || cur.nonStriker;
          cur.nonStriker = null;
          cur.solo = true;
        } else {
          var nx = nextBatter(st, cur);
          if (nx) {
            cur.batters[nx] = freshBatter(nx);
            cur.order.push(nx);
            if (cur.striker === null) cur.striker = nx; else cur.nonStriker = nx;
          } else {
            cur.maxWk = cur.wkts; // no one left to bat
          }
        }
      }
    }

    // 3. free hit
    if (isNb) cur.freeHit = true; else if (legal) cur.freeHit = false;

    // 4. end of over
    var overDone = legal && cur.legal % 6 === 0;
    if (overDone) {
      if (!cur.solo && cur.striker && cur.nonStriker) swapEnds(cur);
      cur.lastBowler = cur.bowler;
      cur.needBowler = true;
    }

    // label for the ball strip
    var parts = [];
    if (isWd) parts.push('Wd' + (runs ? '+' + runs : ''));
    else if (isNb) parts.push('Nb' + (batRuns ? '+' + batRuns : ''));
    else if (isBye) parts.push((extra === 'b' ? 'B' : 'Lb') + runs);
    else if (!wk) parts.push(runs === 0 ? '·' : String(runs));
    if (wk) parts.push((wk.kind === 'runout' ? 'RO' : 'W') + (runs && !isWd && !isNb && !isBye ? '+' + runs : ''));

    cur.balls.push({
      idx: actionIdx, over: overNo, legal: legal, label: parts.join(' '), total: total, batRuns: batRuns,
      extra: extra, batter: S, bowler: cur.bowlers[cur.bowler].name, freeHit: freeHit,
      wicket: wk ? { kind: wk.kind, out: outName } : null, notOut: notOut,
      shot: (a.shot && isFinite(a.shot.a) && isFinite(a.shot.r) && batRuns > 0) ? { a: +a.shot.a, r: +a.shot.r } : null,
      runsAfter: cur.runs, wktsAfter: cur.wkts, legalAfter: cur.legal,
      action: { t: 'ball', runs: a.runs | 0, extra: extra, pen: a.pen, wicket: a.wicket || null, shot: a.shot || null }
    });

    // 5. does the innings end?
    var reason = null;
    if (cur.target !== null && cur.runs >= cur.target) reason = 'target';
    else if (cur.wkts >= cur.maxWk) reason = 'allout';
    else if (cur.legal >= cur.overs * 6) reason = 'overs';
    if (reason) closeInnings(cur, reason);
  }

  function resolve(st, cur) {
    if (cur.pos === 0) {
      st.innings.push(newInnings(st, cur.idx + 1));
      return;
    }
    var first = st.innings[cur.idx - 1];
    var winner, margin;
    if (cur.runs > first.runs) {
      winner = cur.bat;
      margin = { type: 'wickets', n: Math.max(0, cur.maxWk - cur.wkts) };
    } else if (cur.runs < first.runs) {
      winner = first.bat;
      margin = { type: 'runs', n: first.runs - cur.runs };
    } else {
      st.innings.push(newInnings(st, cur.idx + 1)); // tied: super over
      return;
    }
    var team = st.cfg.teams[winner], text;
    if (cur.round > 0) text = team + ' won the super over';
    else if (margin.type === 'runs') text = team + ' won by ' + margin.n + ' run' + (margin.n === 1 ? '' : 's');
    else if (margin.n === 0) text = team + ' won off the last wicket';
    else text = team + ' won by ' + margin.n + ' wicket' + (margin.n === 1 ? '' : 's');
    st.finished = true;
    st.result = { winner: winner, team: team, margin: margin, round: cur.round, text: text };
  }

  function step(st, a, i) {
    var cur = st.innings[st.innings.length - 1];
    if (st.finished && a.t !== 'potm') throw new Error('The match is over');
    switch (a.t) {
      case 'open': doOpen(st, cur, a); break;
      case 'bowler': doBowler(st, cur, a); break;
      case 'ball': doBall(st, cur, a, i); break;
      case 'swap':
        if (cur.closed || cur.needOpen) throw new Error('No batters at the crease');
        if (cur.solo) throw new Error('Only one batter is left');
        swapEnds(cur);
        break;
      case 'endInnings':
        if (cur.closed) throw new Error('Innings is already over');
        closeInnings(cur, 'manual');
        break;
      case 'potm':
        if (!st.finished) throw new Error('The match is not over yet');
        st.potm = { team: a.team, name: a.name };
        break;
      default:
        throw new Error('Unknown action ' + a.t);
    }
    if (cur.closed && !cur.done) {
      cur.done = true;
      resolve(st, cur);
    }
  }

  function suggestPotm(st) {
    var score = {};
    function add(team, name, key, v) {
      var k = team + '|' + name;
      if (!score[k]) score[k] = { team: team, name: name, runs: 0, wkts: 0 };
      score[k][key] += v;
    }
    st.innings.forEach(function (inn) {
      Object.keys(inn.batters).forEach(function (n) { add(inn.bat, n, 'runs', inn.batters[n].runs); });
      Object.keys(inn.bowlers).forEach(function (n) { add(inn.bowl, n, 'wkts', inn.bowlers[n].wkts); });
    });
    var best = null, bestPts = -1;
    Object.keys(score).forEach(function (k) {
      var s = score[k], pts = s.runs + 20 * s.wkts;
      if (pts > bestPts) { best = s; bestPts = pts; }
    });
    return best;
  }

  function replay(match) {
    var cfg = match.config;
    var st = { cfg: cfg, innings: [], finished: false, result: null, potm: null, potmSuggest: null };
    st.innings.push(newInnings(st, 0));
    match.actions.forEach(function (a, i) { step(st, a, i); });
    st.cur = st.innings[st.innings.length - 1];
    if (st.finished) st.potmSuggest = suggestPotm(st);
    return st;
  }

  function apply(match, action) {
    var next = Object.assign({}, match, { actions: match.actions.concat([action]) });
    replay(next); // throws if the action is not valid
    return next;
  }

  function undo(match) {
    if (!match.actions.length) throw new Error('Nothing to undo');
    return Object.assign({}, match, { actions: match.actions.slice(0, -1) });
  }

  function editBall(match, actionIdx, patch) {
    var old = match.actions[actionIdx];
    if (!old || old.t !== 'ball') throw new Error('That is not a ball');
    var actions = match.actions.slice();
    actions[actionIdx] = Object.assign({}, old, patch);
    var next = Object.assign({}, match, { actions: actions });
    try {
      replay(next);
    } catch (e) {
      throw new Error('That change breaks a later ball (' + e.message + '). Undo back to it instead.');
    }
    return next;
  }

  function setExtraRun(match, on) {
    return Object.assign({}, match, { config: Object.assign({}, match.config, { extraRun: !!on }) });
  }

  /* ---------- shot zones, match stats, career stats ---------- */

  // Angle is measured from straight down the ground toward the bowler, clockwise,
  // so +90 is square on the right of the screen. For a right-hander that is the off side.
  var OFF_ZONES = ['Long off', 'Cover', 'Point', 'Third man'];
  var LEG_ZONES = ['Long on', 'Mid wicket', 'Square leg', 'Fine leg'];
  var ZONES = OFF_ZONES.concat(LEG_ZONES);

  function zoneOf(angle, hand) {
    var a = +angle;
    while (a > 180) a -= 360;
    while (a <= -180) a += 360;
    if (hand === 'L') a = -a;
    var idx = Math.min(3, Math.floor(Math.abs(a) / 45));
    return a >= 0 ? OFF_ZONES[idx] : LEG_ZONES[idx];
  }

  function handOf(cfg, name) {
    return (cfg.hands && cfg.hands[name] === 'L') ? 'L' : 'R';
  }

  function inningsStats(inn, cfg) {
    var overs = {}, zones = {}, shots = [], fow = [];
    var dots = 0, legalBalls = 0, fours = 0, sixes = 0, boundaryRuns = 0, scoring = 0;
    inn.balls.forEach(function (b) {
      var o = overs[b.over] || (overs[b.over] = { over: b.over + 1, runs: 0, wkts: 0 });
      o.runs += b.total;
      if (b.wicket) o.wkts++;
      if (b.legal) { legalBalls++; if (b.total === 0) dots++; }
      if (b.batRuns === 4) { fours++; boundaryRuns += 4; }
      if (b.batRuns === 6) { sixes++; boundaryRuns += 6; }
      if (b.batRuns > 0) {
        scoring++;
        if (b.shot) {
          var hand = handOf(cfg, b.batter), z = zoneOf(b.shot.a, hand);
          zones[z] = (zones[z] || 0) + b.batRuns;
          shots.push({ a: b.shot.a, r: b.shot.r, runs: b.batRuns, batter: b.batter, hand: hand, zone: z });
        }
      }
      if (b.wicket) fow.push({ n: b.wktsAfter, runs: b.runsAfter, out: b.wicket.out, over: oversText(b.legalAfter) });
    });
    return {
      overs: Object.keys(overs).map(function (k) { return overs[k]; }),
      zones: zones, shots: shots, fow: fow, dots: dots, legalBalls: legalBalls,
      fours: fours, sixes: sixes, boundaryRuns: boundaryRuns, scoring: scoring
    };
  }

  // matches: list of saved matches ({config, actions}). onlyNames: optional list, so
  // default names like A1/B1 from quick matches do not show up as players.
  function careerStats(matches, onlyNames) {
    var allow = null;
    if (onlyNames) { allow = {}; onlyNames.forEach(function (n) { allow[n] = true; }); }
    var out = {};
    function get(n) {
      if (allow && !allow[n]) return null;
      return out[n] || (out[n] = {
        name: n, matches: 0, wins: 0, potm: 0,
        bat: { inns: 0, runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, hs: 0, hsNo: false, zones: {}, shots: [] },
        bowl: { inns: 0, legal: 0, runs: 0, wkts: 0, best: null }
      });
    }
    matches.forEach(function (m) {
      var st;
      try { st = replay(m); } catch (e) { return; }
      if (!st.finished) return;
      var cfg = st.cfg;
      [0, 1].forEach(function (t) {
        cfg.players[t].forEach(function (n) {
          var p = get(n);
          if (!p) return;
          p.matches++;
          if (st.result && st.result.winner === t) p.wins++;
        });
      });
      if (st.potm) { var pp = get(st.potm.name); if (pp) pp.potm++; }
      st.innings.forEach(function (inn) {
        if (inn.isSuper) return;
        Object.keys(inn.batters).forEach(function (n) {
          var p = get(n), b = inn.batters[n];
          if (!p) return;
          var x = p.bat;
          x.inns++; x.runs += b.runs; x.balls += b.balls; x.fours += b.fours; x.sixes += b.sixes;
          if (b.out) x.outs++;
          if (b.runs > x.hs || (b.runs === x.hs && !b.out && x.hsNo === false && b.runs > 0)) { x.hs = b.runs; x.hsNo = !b.out; }
        });
        Object.keys(inn.bowlers).forEach(function (n) {
          var p = get(n), b = inn.bowlers[n];
          if (!p) return;
          var x = p.bowl;
          x.inns++; x.legal += b.legal; x.runs += b.runs; x.wkts += b.wkts;
          if (!x.best || b.wkts > x.best.w || (b.wkts === x.best.w && b.runs < x.best.r)) x.best = { w: b.wkts, r: b.runs };
        });
        inn.balls.forEach(function (b) {
          if (b.batRuns > 0 && b.shot) {
            var p = get(b.batter);
            if (!p) return;
            var hand = handOf(cfg, b.batter), z = zoneOf(b.shot.a, hand);
            p.bat.zones[z] = (p.bat.zones[z] || 0) + b.batRuns;
            p.bat.shots.push({ a: b.shot.a, r: b.shot.r, runs: b.batRuns, hand: hand, zone: z });
          }
        });
      });
    });
    return out;
  }

  function availableBowlers(st) {
    var cur = st.cur, cap = st.cfg.maxOversPerBowler;
    return st.cfg.players[cur.bowl].map(function (name) {
      var b = cur.bowlers[name];
      var legal = b ? b.legal : 0;
      var ok = cur.isSuper || !cap || legal < cap * 6;
      return { name: name, legal: legal, runs: b ? b.runs : 0, wkts: b ? b.wkts : 0, ok: ok };
    });
  }

  return {
    createMatch: createMatch, normalizeConfig: normalizeConfig, validateConfig: validateConfig,
    replay: replay, apply: apply, undo: undo, editBall: editBall, setExtraRun: setExtraRun,
    availableBowlers: availableBowlers, oversText: oversText, WICKET_KINDS: WICKET_KINDS,
    zoneOf: zoneOf, ZONES: ZONES, inningsStats: inningsStats, careerStats: careerStats
  };
});
