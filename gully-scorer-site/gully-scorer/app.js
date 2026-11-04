/* app.js: everything you see and tap.

   How the page works, in four steps (the same idea most small web apps use):

   1. STATE    A few variables hold what the app knows: the match being scored (`match`),
               your players (`roster`), finished matches (`history`), which screen is open (`view`).
   2. RENDER   render() builds the whole screen as one big HTML string from that state and
               puts it in <div id="app">. Each screen has its own function that returns HTML
               (setupHTML, scoreTab, cardTab, statsView, historyView ...).
   3. EVENTS   Buttons carry a data-act="..." label. One click listener at the bottom reads it,
               changes the state, then calls render() again.
   4. SAVE     After a change the state is written to localStorage (the browser's small
               built-in storage) so it is still there next time you open the page.

   The cricket rules (runs, wickets, who is on strike, results, career stats) are NOT in this
   file. They are in engine.js, which knows nothing about the screen and can be tested alone.
   The look (colours, sizes, spacing) is in style.css. */


(function () {
  'use strict';
  var C = Cricket;
  var K = { match: 'gully-scorer-v1', roster: 'gully-roster-v1', hist: 'gully-history-v1', prefs: 'gully-prefs-v1' };

  /* ---------- state ---------- */
  var match = null, st = null, roster = [], history = [], prefs = { track: true, theme: 'auto' };
  var view = 'match', tab = 'score', mode = null, sheet = null, setupError = '', toastTimer = null;
  var anaInn = null, anaBat = '', statsTab = 'bat', selPlayer = null;
  var viewMatchId = null, htab = 'card';   // History screen: which past match is open, and its tab
  var draft = { tA: '', tB: '', per: 6, overs: 5, cap: 0, xr: true, lm: false, fb: '0', assign: {}, newName: '' };

  /* ---------- storage (a convenience only; the page works without it) ---------- */
  function lsGet(k, fallback) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(k, v) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
  }
  function saveMatch() { lsSet(K.match, match); }
  function saveRoster() { lsSet(K.roster, roster); }
  function saveHist() { lsSet(K.hist, history); }
  function savePrefs() { lsSet(K.prefs, prefs); }

  function cleanRoster(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (p) {
      var name = p && typeof p.name === 'string' ? p.name.trim() : '';
      if (!name || seen[name.toLowerCase()]) return;
      seen[name.toLowerCase()] = true;
      out.push({ name: name, hand: p.hand === 'L' ? 'L' : 'R' });
    });
    return out;
  }
  function cleanHistory(list) {
    return (Array.isArray(list) ? list : []).filter(function (m) {
      try { return m && m.config && Array.isArray(m.actions) && C.replay(m).finished; } catch (e) { return false; }
    });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function flash(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }
  function team(i) { return st.cfg.teams[i]; }
  function innLabel(inn) {
    if (inn.isSuper) return 'Super over' + (inn.round > 1 ? ' ' + inn.round : '') + ' · ' + (inn.pos ? '2nd' : '1st') + ' bat';
    return inn.pos ? '2nd innings' : '1st innings';
  }
  function ovs(n) { return C.oversText(n); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function pct(a, b) { return b ? Math.round(a * 100 / b) + '%' : '-'; }
  function handOfName(name) {
    for (var i = 0; i < roster.length; i++) if (roster[i].name === name) return roster[i].hand;
    return 'R';
  }
  function newId() { return 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  function syncHistory() {
    if (!match || !match.id) return;
    var i = -1;
    history.forEach(function (h, k) { if (h.id === match.id) i = k; });
    if (st.finished) {
      var copy = { config: match.config, actions: match.actions, id: match.id, date: match.date };
      if (i >= 0) history[i] = copy; else history.push(copy);
      saveHist();
    } else if (i >= 0) {
      history.splice(i, 1);
      saveHist();
    }
  }
  function commitState() { st = C.replay(match); saveMatch(); syncHistory(); }

  function act(a) {
    try {
      match = C.apply(match, a);
      if (a.t === 'ball') mode = null;
      sheet = null;
      commitState();
    } catch (e) { flash(e.message); }
    render();
  }


  /* ---------- light / dark theme ----------
     The colours live in style.css as variables. 'auto' follows the phone's setting.
     'light' or 'dark' puts data-theme="..." on <html>, which style.css listens for. */
  var THEME_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  function applyTheme() {
    var root = document.documentElement;
    if (prefs.theme === 'light' || prefs.theme === 'dark') root.setAttribute('data-theme', prefs.theme);
    else root.removeAttribute('data-theme');
  }
  function cycleTheme() {
    prefs.theme = prefs.theme === 'auto' ? 'light' : prefs.theme === 'light' ? 'dark' : 'auto';
    savePrefs();
    applyTheme();
  }

  /* ---------- wagon wheel ---------- */
  var VB = 160, RAD = 140;
  function wheelSVG(shots, labelHand, interactive) {
    var s = '<svg viewBox="-' + VB + ' -' + VB + ' ' + (VB * 2) + ' ' + (VB * 2) + '" class="wheel' + (interactive ? ' tap' : '') + '"' +
      (interactive ? ' data-act="field"' : '') + ' role="img" aria-label="Cricket field seen from above, bowler’s end at the top">';
    s += '<circle class="gr" r="' + RAD + '"/><circle class="inr" r="' + Math.round(RAD * 0.55) + '"/>';
    for (var k = 0; k < 4; k++) {
      var ang = k * 45 * Math.PI / 180;
      var x = (RAD * Math.sin(ang)).toFixed(1), y = (-RAD * Math.cos(ang)).toFixed(1);
      s += '<line class="sp" x1="' + (-x) + '" y1="' + (-y) + '" x2="' + x + '" y2="' + y + '"/>';
    }
    s += '<rect class="pt" x="-6" y="-32" width="12" height="64" rx="2"/>';
    if (labelHand) {
      [22.5, 67.5, 112.5, 157.5, -22.5, -67.5, -112.5, -157.5].forEach(function (a) {
        var r = a > 0 || a < 0 ? 112 : 0, rad = a * Math.PI / 180;
        s += '<text x="' + (r * Math.sin(rad)).toFixed(1) + '" y="' + (-r * Math.cos(rad)).toFixed(1) + '">' + C.zoneOf(a, labelHand) + '</text>';
      });
      s += '<text class="side" x="' + (labelHand === 'L' ? -138 : 138) + '" y="0" transform="rotate(' + (labelHand === 'L' ? -90 : 90) + ' ' + (labelHand === 'L' ? -138 : 138) + ' 0)">OFF</text>';
      s += '<text class="side" x="' + (labelHand === 'L' ? 138 : -138) + '" y="0" transform="rotate(' + (labelHand === 'L' ? 90 : -90) + ' ' + (labelHand === 'L' ? 138 : -138) + ' 0)">LEG</text>';
    }
    (shots || []).forEach(function (h) {
      var r = h.runs >= 4 ? 1 : Math.max(0.12, Math.min(1, h.r));
      var rad = h.a * Math.PI / 180;
      var x2 = (r * RAD * Math.sin(rad)).toFixed(1), y2 = (-r * RAD * Math.cos(rad)).toFixed(1);
      var cls = h.runs === 6 ? 's6' : h.runs === 4 ? 's4' : 's1';
      s += '<line class="' + cls + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '"/><circle class="' + cls + '" cx="' + x2 + '" cy="' + y2 + '" r="3"/>';
    });
    return s + '</svg>';
  }
  function legend() {
    return '<div class="legend"><span><i class="k1"></i>1 to 3</span><span><i class="k4"></i>Four</span><span><i class="k6"></i>Six</span></div>';
  }
  function zoneRows(zones) {
    var total = 0;
    C.ZONES.forEach(function (z) { total += zones[z] || 0; });
    if (!total) return '<p class="muted" style="font-size:14px">No shot directions yet. Turn on shot tracking on the Score tab and tap where each scoring shot went.</p>';
    var sorted = C.ZONES.slice().sort(function (a, b) { return (zones[b] || 0) - (zones[a] || 0); });
    return '<div class="opts" style="gap:6px">' + sorted.map(function (z) {
      var v = zones[z] || 0;
      return '<div class="zrow"><span>' + z + '</span><span class="zbar"><i style="width:' + Math.round(v * 100 / total) + '%"></i></span><span class="n">' + v + ' <span class="muted">' + Math.round(v * 100 / total) + '%</span></span></div>';
    }).join('') + '</div>';
  }

  /* ---------- setup ---------- */
  function readDraft() {
    var v = function (id) { return document.getElementById(id); };
    if (v('newName')) draft.newName = v('newName').value;
    if (!v('tA')) return;
    draft.tA = v('tA').value; draft.tB = v('tB').value;
    draft.per = v('per').value; draft.overs = v('overs').value; draft.cap = v('cap').value;
    draft.fb = v('fb').value; draft.xr = v('xr').checked; draft.lm = v('lm').checked;
  }

  function setupHTML() {
    var d = draft, nA = 0, nB = 0;
    roster.forEach(function (p) { if (d.assign[p.name] === 'A') nA++; if (d.assign[p.name] === 'B') nB++; });
    var rows = roster.map(function (p) {
      var as = d.assign[p.name] || '';
      var b = function (v, label, extra) {
        return '<button class="' + (extra || '') + '" data-act="assign" data-n="' + esc(p.name) + '" data-v="' + v + '" aria-pressed="' + (as === v) + '">' + label + '</button>';
      };
      return '<div class="prow"><span class="pn">' + esc(p.name) + (p.hand === 'L' ? '<small>left-handed</small>' : '') + '</span>' +
        '<div class="seg" role="group" aria-label="Team for ' + esc(p.name) + '">' + b('', 'Out') + b('A', 'A') + b('B', 'B', 'bb') + '</div></div>';
    }).join('');
    var pickBlock = roster.length ?
      '<div class="counts"><span class="count">Team A: ' + nA + '</span><span class="count">Team B: ' + nB + '</span></div>' + '<div>' + rows + '</div>' +
      '<div class="tools" style="grid-template-columns:1fr 1fr"><button class="btn sm" data-act="shuffle">Shuffle into two teams</button><button class="btn sm" data-act="clearassign">Clear picks</button></div>' :
      '<p class="muted">No saved players yet. Add your group below, or use the Players tab. With nobody picked the teams get default names (A1, A2… and B1, B2…).</p>';
    return '' +
      '<section class="card"><h2>Pick the teams</h2>' + pickBlock +
      '<div class="field"><label for="newName">Add players (separate with commas)</label><div class="row2"><input id="newName" type="text" placeholder="Sahil, Ravi, Imran" value="' + esc(d.newName) + '" autocomplete="off"><button class="btn" data-act="addplayers">Add</button></div></div></section>' +
      '<section class="card"><h2>Match</h2>' +
      '<div class="two"><div class="field"><label for="tA">Team A name</label><input id="tA" type="text" placeholder="Team A" value="' + esc(d.tA) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="tB">Team B name</label><input id="tB" type="text" placeholder="Team B" value="' + esc(d.tB) + '" autocomplete="off"></div></div>' +
      '<div class="two"><div class="field"><label for="overs">Overs</label><input id="overs" type="number" min="1" max="50" inputmode="numeric" value="' + esc(d.overs) + '"></div>' +
      '<div class="field"><label for="cap">Max overs a bowler</label><input id="cap" type="number" min="0" max="50" inputmode="numeric" value="' + esc(d.cap) + '"></div></div>' +
      '<div class="two"><div class="field"><label for="fb">Who bats first</label><select id="fb"><option value="0"' + (d.fb === '0' ? ' selected' : '') + '>Team A</option><option value="1"' + (d.fb === '1' ? ' selected' : '') + '>Team B</option></select></div>' +
      '<div class="field"><label for="per">Players a side</label><input id="per" type="number" min="2" max="15" inputmode="numeric" value="' + esc(d.per) + '"></div></div>' +
      '<p class="muted" style="font-size:14px">Players a side only applies when nobody is picked. Max overs 0 means no limit.</p>' +
      '<label class="check"><input id="xr" type="checkbox"' + (d.xr ? ' checked' : '') + '><span><b>Wide and no-ball give 1 run</b><small>Turn off for gully rules where they only get re-bowled. You can flip this during the match too.</small></span></label>' +
      '<label class="check"><input id="lm" type="checkbox"' + (d.lm ? ' checked' : '') + '><span><b>Last man stands</b><small>The last batter carries on alone. Everyone must be out to end the innings.</small></span></label>' +
      (setupError ? '<p class="err" role="alert">' + esc(setupError) + '</p>' : '') +
      '<button class="btn primary" data-act="start" style="min-height:54px;font-size:18px">Start match</button></section>';
  }

  function addPlayers(text) {
    var names = String(text || '').split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var added = 0;
    names.forEach(function (n) {
      if (roster.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })) return;
      roster.push({ name: n, hand: 'R' });
      added++;
    });
    saveRoster();
    return added;
  }

  function startMatch() {
    readDraft();
    var d = draft, lists = [[], []], hands = {};
    roster.forEach(function (p) {
      if (d.assign[p.name] === 'A') lists[0].push(p.name);
      if (d.assign[p.name] === 'B') lists[1].push(p.name);
      if (p.hand === 'L') hands[p.name] = 'L';
    });
    try {
      var m = C.createMatch({
        teams: [d.tA, d.tB], players: lists, playersPerSide: +d.per, overs: +d.overs, maxOversPerBowler: +d.cap,
        extraRun: d.xr, lastMan: d.lm, firstBat: d.fb === '1' ? 1 : 0, hands: hands
      });
      m.id = newId();
      m.date = new Date().toISOString();
      match = m;
      st = C.replay(match);
      setupError = '';
      tab = 'score'; mode = null; sheet = null; anaInn = null; anaBat = '';
      saveMatch();
    } catch (e) { setupError = e.message; match = null; st = null; }
    render();
  }

  /* ---------- score tab ---------- */
  function board(c) {
    var rate = c.legal ? (c.runs * 6 / c.legal).toFixed(2) : '0.00';
    var need = '';
    if (c.target !== null && !c.closed) {
      var left = c.overs * 6 - c.legal, r = c.target - c.runs;
      need = '<div class="need">Need ' + r + ' off ' + plural(left, 'ball') + (left ? ' · RRR ' + (r * 6 / left).toFixed(2) : '') + '</div>';
    } else if (c.target !== null) {
      need = '<div class="need">Target was ' + c.target + '</div>';
    }
    var prev = st.innings.filter(function (i) { return i !== c && i.closed; }).map(function (i) {
      return '<span>' + esc(team(i.bat)) + ' ' + i.runs + '/' + i.wkts + ' (' + ovs(i.legal) + ') · ' + esc(innLabel(i).toLowerCase()) + '</span>';
    }).join('');
    return '<section class="board" aria-label="Scoreboard"><div class="top"><span class="team">' + esc(team(c.bat)) + '</span><span class="inn">' + esc(innLabel(c)) +
      (c.freeHit && !c.closed ? ' &nbsp;<span class="pill">Free hit</span>' : '') + '</span></div>' +
      '<div class="row"><div class="score num">' + c.runs + '<small>/' + c.wkts + '</small></div>' +
      '<div class="ov num">' + ovs(c.legal) + ' <span style="font-size:18px;color:var(--board-dim)">/ ' + c.overs + '</span><small>CRR ' + rate + '</small></div></div>' + need +
      (prev ? '<div class="prev">' + prev + '</div>' : '') + '</section>';
  }

  function chipHTML(b) {
    var cls = 'chip';
    if (b.wicket) cls += ' w';
    else if (b.extra) cls += ' x';
    else if (b.batRuns >= 4) cls += ' b';
    else if (b.label === '·') cls += ' d';
    var title = b.notOut ? 'Not out (' + b.notOut + (b.freeHit ? ' on a free hit' : '') + ')' : 'Edit this ball';
    return '<button class="' + cls + '" data-act="editball" data-i="' + b.idx + '" title="' + esc(title) + '" aria-label="' + esc(title + ': ' + b.label) + '">' + esc(b.label) + (b.notOut ? '<i>NO</i>' : '') + '</button>';
  }

  function overStrip(c) {
    var overNo = (c.needBowler && c.legal > 0) ? c.legal / 6 - 1 : Math.floor(c.legal / 6);
    var balls = c.balls.filter(function (b) { return b.over === overNo; });
    return '<div class="strip">' + (balls.length ? balls.map(chipHTML).join('') : '<span class="empty-strip">No balls in this over yet</span>') + '</div>';
  }

  function crease(c) {
    var s = c.batters[c.striker];
    var rows = '<div class="line"><span class="nm on">' + esc(c.striker) + '</span><span class="st num">' + s.runs + ' <small>(' + s.balls + ')</small></span></div>';
    if (c.nonStriker) {
      var n = c.batters[c.nonStriker];
      rows += '<div class="line"><span class="nm">' + esc(c.nonStriker) + '</span><span class="st num">' + n.runs + ' <small>(' + n.balls + ')</small></span></div>';
    } else {
      rows += '<div class="line"><span class="muted">Last man standing, no partner</span></div>';
    }
    var b = c.bowlers[c.bowler];
    rows += '<div class="line bw"><span class="nm">' + esc(c.bowler) + ' bowling</span><span class="num">' + ovs(b.legal) + '-' + b.runs + '-' + b.wkts + '</span></div>';
    return '<section class="card"><div class="crease">' + rows + '</div>' + overStrip(c) + '</section>';
  }

  function hintText() {
    if (mode === 'wd') return 'Wide: tap the runs run off it (0 if none).';
    if (mode === 'nb') return 'No-ball: tap the runs the batter hit.';
    if (mode === 'b') return 'Byes: tap how many were run.';
    if (mode === 'lb') return 'Leg byes: tap how many were run.';
    return prefs.track ? 'Tap the runs. You will be asked where the shot went.' : '';
  }

  function pad(c) {
    var m = function (v, label) { return '<button data-act="mode" data-v="' + v + '" aria-pressed="' + (mode === v) + '">' + label + '</button>'; };
    var runs = [0, 1, 2, 3, 4, 5, 6].map(function (n) {
      return '<button class="runbtn' + (n === 4 || n === 6 ? ' hit' : '') + '" data-act="run" data-n="' + n + '" aria-label="' + (mode ? 'Record ' + n + ' with ' + mode : n + ' runs') + '">' + n + '</button>';
    }).join('');
    return '<section class="pad" aria-label="Score a ball"><div class="mods">' + m('wd', 'Wide') + m('nb', 'No ball') + m('b', 'Bye') + m('lb', 'Leg bye') + '</div>' +
      '<div class="hint">' + hintText() + '</div>' +
      '<div class="runs">' + runs + '<button class="runbtn wk" data-act="wicket">Out</button></div>' +
      '<div class="tools"><button class="btn" data-act="swap"' + (c.solo ? ' disabled' : '') + '>Swap strike</button><button class="btn" data-act="undo"' + (match.actions.length ? '' : ' disabled') + '>Undo</button><button class="btn" data-act="end">End innings</button></div>' +
      '<div class="toggle-row"><span>Wide / no-ball adds 1 run</span><button class="switch" data-act="xr" aria-pressed="' + match.config.extraRun + '">' + (match.config.extraRun ? 'ON' : 'OFF') + '</button></div>' +
      '<div class="toggle-row"><span>Ask where the shot went (wagon wheel)</span><button class="switch" data-act="track" aria-pressed="' + prefs.track + '">' + (prefs.track ? 'ON' : 'OFF') + '</button></div></section>';
  }

  function openersHTML(c) {
    var roster2 = st.cfg.players[c.bat];
    var opts = function (sel) { return roster2.map(function (n, i) { return '<option value="' + esc(n) + '"' + (i === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); };
    return '<section class="card"><h2>' + esc(team(c.bat)) + ' to bat</h2>' +
      (c.target !== null ? '<p class="muted">Target ' + c.target + ' in ' + plural(c.overs, 'over') + '.</p>' : '') +
      '<div class="field"><label for="opS">On strike</label><select id="opS">' + opts(0) + '</select></div>' +
      '<div class="field"><label for="opN">Other end</label><select id="opN">' + opts(1) + '</select></div>' +
      '<button class="btn primary" data-act="open" style="min-height:52px;font-size:17px">Start innings</button>' +
      (match.actions.length ? '<button class="btn" data-act="undo">Undo last ball of the previous innings</button>' : '') + '</section>';
  }

  function bowlerHTML(c) {
    var list = C.availableBowlers(st).map(function (b) {
      return '<button class="opt" data-act="bowler" data-n="' + esc(b.name) + '"' + (b.ok ? '' : ' disabled') + '><b>' + esc(b.name) + '</b><small class="num">' +
        (b.ok ? ovs(b.legal) + ' ov · ' + b.runs + ' runs · ' + b.wkts + ' wkts' : 'bowled the maximum') + '</small></button>';
    }).join('');
    var head = c.legal > 0 ? 'Over ' + (c.legal / 6) + ' done' : 'Who bowls first?';
    return '<section class="card"><h2>' + head + '</h2>' + (c.legal > 0 ? overStrip(c) : '') +
      '<p class="eyebrow">Next bowler</p><div class="opts">' + list + '</div>' +
      '<div class="tools" style="grid-template-columns:1fr 1fr"><button class="btn" data-act="undo">Undo last ball</button><button class="btn" data-act="end">End innings</button></div></section>';
  }

  function resultHTML() {
    var r = st.result;
    var lines = st.innings.map(function (i) {
      return '<div class="line" style="display:flex;justify-content:space-between;gap:10px"><span>' + esc(team(i.bat)) + ' <span class="muted">' + esc(innLabel(i)) + '</span></span><b class="num">' + i.runs + '/' + i.wkts + ' (' + ovs(i.legal) + ')</b></div>';
    }).join('');
    var sug = st.potmSuggest, chosen = st.potm;
    var pick = chosen || (sug ? { team: sug.team, name: sug.name } : null);
    var all = [0, 1].map(function (t) {
      return st.cfg.players[t].map(function (n) {
        var on = pick && pick.team === t && pick.name === n;
        return '<button class="sel" data-act="potm" data-team="' + t + '" data-n="' + esc(n) + '" aria-pressed="' + on + '">' + esc(n) + ' <small style="opacity:.7">' + esc(team(t)) + '</small></button>';
      }).join('');
    }).join('');
    return '<section class="card"><p class="eyebrow">Result</p><h2 style="font-size:30px;line-height:1.05">' + esc(r.text) + '</h2>' + lines +
      '<p class="muted" style="font-size:14px">Saved to Stats. Player stats update from this match.</p></section>' +
      '<section class="card"><h2>Player of the match</h2>' +
      (chosen ? '<p><b>' + esc(chosen.name) + '</b> <span class="muted">(' + esc(team(chosen.team)) + ')</span></p>' :
        (sug ? '<p class="muted">Suggested: <b style="color:var(--ink)">' + esc(sug.name) + '</b> (' + sug.runs + ' runs, ' + plural(sug.wkts, 'wicket') + '). Tap a name to confirm or pick someone else.</p>' : '')) +
      '<div class="pills">' + all + '</div></section>' +
      '<div class="tools" style="grid-template-columns:1fr 1fr"><button class="btn" data-act="undo">Undo last ball</button><button class="btn primary" data-act="newmatch">New match</button></div>';
  }

  function scoreTab() {
    var c = st.cur, h = board(c);
    if (st.finished) return h + resultHTML();
    if (c.needOpen) return h + openersHTML(c);
    if (c.needBowler) return h + bowlerHTML(c);
    return h + crease(c) + pad(c);
  }

  /* ---------- scorecard tab ---------- */
  function cardTab() {
    return st.innings.map(function (inn) {
      var rosterIn = st.cfg.players[inn.bat];
      var bat = inn.order.map(function (n) {
        var b = inn.batters[n];
        var how = b.out ? b.how : (inn.closed ? 'not out' : (n === inn.striker || n === inn.nonStriker ? 'batting' : ''));
        return '<tr><td><b>' + esc(n) + '</b><small>' + esc(how) + '</small></td><td class="r n">' + b.runs + '</td><td class="n">' + b.balls + '</td><td class="n">' + b.fours + '</td><td class="n">' + b.sixes + '</td><td class="n">' + (b.balls ? Math.round(b.runs * 100 / b.balls) : '-') + '</td></tr>';
      }).join('');
      var dnb = rosterIn.filter(function (n) { return !inn.batters[n]; });
      var ex = inn.extras, exTotal = ex.wd + ex.nb + ex.b + ex.lb;
      var bowl = inn.bowlerOrder.map(function (n) {
        var b = inn.bowlers[n];
        return '<tr><td><b>' + esc(n) + '</b></td><td class="n">' + ovs(b.legal) + '</td><td class="n">' + b.runs + '</td><td class="r n">' + b.wkts + '</td><td class="n">' + (b.legal ? (b.runs * 6 / b.legal).toFixed(1) : '-') + '</td></tr>';
      }).join('');
      return '<section class="card"><div><p class="eyebrow">' + esc(innLabel(inn)) + '</p><h2>' + esc(team(inn.bat)) + ' ' + inn.runs + '/' + inn.wkts + ' <span class="muted" style="font-size:16px;text-transform:none">(' + ovs(inn.legal) + ' ov)</span></h2></div>' +
        (bat ? '<div class="tbl"><table><thead><tr><th>Batting</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>' + bat + '</tbody></table></div>' : '<p class="muted">Openers not picked yet.</p>') +
        '<p class="muted" style="font-size:14px">Extras ' + exTotal + ' (wd ' + ex.wd + ', nb ' + ex.nb + ', b ' + ex.b + ', lb ' + ex.lb + ')' + (dnb.length && bat ? '<br>Did not bat: ' + esc(dnb.join(', ')) : '') + '</p>' +
        (bowl ? '<div class="tbl"><table><thead><tr><th>Bowling</th><th>O</th><th>R</th><th>W</th><th>Eco</th></tr></thead><tbody>' + bowl + '</tbody></table></div>' : '') + '</section>';
    }).join('');
  }

  /* ---------- balls tab ---------- */
  function ballsTab() {
    return st.innings.map(function (inn) {
      var byOver = {};
      inn.balls.forEach(function (b) { (byOver[b.over] = byOver[b.over] || []).push(b); });
      var rows = Object.keys(byOver).map(function (k) {
        var list = byOver[k], runs = list.reduce(function (s, b) { return s + b.total; }, 0);
        return '<div class="ballrow"><div class="who num"><b>Over ' + (+k + 1) + '</b> · ' + esc(list[0].bowler) + ' · ' + runs + ' runs</div><div class="strip">' + list.map(chipHTML).join('') + '</div></div>';
      }).join('');
      return '<section class="card"><div><p class="eyebrow">' + esc(innLabel(inn)) + '</p><h2>' + esc(team(inn.bat)) + ' ' + inn.runs + '/' + inn.wkts + '</h2></div>' +
        (rows || '<p class="muted">No balls yet.</p>') + '</section>';
    }).join('') + '<p class="muted" style="font-size:14px;text-align:center">Tap any ball to correct it.</p>';
  }

  /* ---------- analysis tab (this match) ---------- */
  function analysisTab() {
    var list = st.innings.filter(function (i) { return i.balls.length; });
    if (!list.length) return '<section class="card"><h2>Analysis</h2><p class="muted">Score a few balls and the wagon wheel, zones and over-by-over runs appear here.</p></section>';
    var idx = anaInn === null || !list.some(function (i) { return i.idx === anaInn; }) ? list[list.length - 1].idx : anaInn;
    var inn = st.innings[idx];
    var s = C.inningsStats(inn, st.cfg);
    var batterNames = inn.order.filter(function (n) { return s.shots.some(function (h) { return h.batter === n; }); });
    if (anaBat && batterNames.indexOf(anaBat) < 0) anaBat = '';
    var shots = anaBat ? s.shots.filter(function (h) { return h.batter === anaBat; }) : s.shots;
    var zones = {};
    shots.forEach(function (h) { zones[h.zone] = (zones[h.zone] || 0) + h.runs; });
    var labelHand = null;
    if (anaBat) labelHand = (st.cfg.hands && st.cfg.hands[anaBat] === 'L') ? 'L' : 'R';
    else if (shots.length && shots.every(function (h) { return h.hand === 'R'; })) labelHand = 'R';
    else if (!shots.length) labelHand = 'R';

    var innPills = list.map(function (i) {
      return '<button class="sel" data-act="anainn" data-i="' + i.idx + '" aria-pressed="' + (i.idx === idx) + '">' + esc(team(i.bat)) + (i.isSuper ? ' SO' : '') + '</button>';
    }).join('');
    var batPills = '<button class="sel" data-act="anabat" data-n="" aria-pressed="' + (!anaBat) + '">All batters</button>' + batterNames.map(function (n) {
      return '<button class="sel" data-act="anabat" data-n="' + esc(n) + '" aria-pressed="' + (anaBat === n) + '">' + esc(n) + '</button>';
    }).join('');

    var maxRuns = Math.max.apply(null, s.overs.map(function (o) { return o.runs; }).concat([1]));
    var bars = s.overs.map(function (o) {
      return '<div class="col"><span class="bv">' + o.runs + (o.wkts ? '<span style="color:var(--wicket)"> W' + (o.wkts > 1 ? o.wkts : '') + '</span>' : '') + '</span><div class="fill' + (o.wkts ? ' w' : '') + '" style="height:' + Math.max(3, Math.round(o.runs / maxRuns * 96)) + 'px"></div><span class="bl">' + o.over + '</span></div>';
    }).join('');
    var extras = inn.extras.wd + inn.extras.nb + inn.extras.b + inn.extras.lb;
    var fow = s.fow.length ? '<div class="list">' + s.fow.map(function (f) {
      return '<div class="li"><span>' + f.n + '-' + f.runs + '</span><span><b>' + esc(f.out) + '</b> <span class="muted">' + f.over + ' ov</span></span></div>';
    }).join('') + '</div>' : '<p class="muted" style="font-size:14px">No wickets.</p>';

    return '<section class="card"><div><p class="eyebrow">Analysis</p><h2>' + esc(team(inn.bat)) + ' ' + inn.runs + '/' + inn.wkts + '</h2></div>' +
      '<div class="pills">' + innPills + '</div>' +
      '<div class="tiles"><div class="tile"><b>' + s.fours + '</b><span>Fours</span></div><div class="tile"><b>' + s.sixes + '</b><span>Sixes</span></div><div class="tile"><b>' + pct(s.dots, s.legalBalls) + '</b><span>Dot balls</span></div>' +
      '<div class="tile"><b>' + pct(s.boundaryRuns, inn.runs) + '</b><span>Runs in boundaries</span></div><div class="tile"><b>' + extras + '</b><span>Extras</span></div><div class="tile"><b>' + (inn.legal ? (inn.runs * 6 / inn.legal).toFixed(1) : '0.0') + '</b><span>Run rate</span></div></div></section>' +
      '<section class="card"><h2>Wagon wheel</h2>' + (batterNames.length ? '<div class="pills">' + batPills + '</div>' : '') +
      wheelSVG(shots, labelHand, false) + legend() +
      '<p class="muted" style="font-size:14px;text-align:center">' + shots.length + ' of ' + s.scoring + ' scoring shots tracked. Bowler’s end is at the top.' + (labelHand === null ? ' Zone names are hidden because the shots mix left and right-handers.' : '') + '</p></section>' +
      '<section class="card"><h2>Runs by zone</h2>' + zoneRows(zones) + '</section>' +
      '<section class="card"><h2>Runs per over</h2><div class="bars">' + bars + '</div></section>' +
      '<section class="card"><h2>Fall of wickets</h2>' + fow + '</section>';
  }

  /* ---------- players view ---------- */
  function playersView() {
    var rows = roster.map(function (p) {
      return '<div class="prow"><span class="pn">' + esc(p.name) + '</span><div class="seg" role="group" aria-label="Batting hand of ' + esc(p.name) + '">' +
        '<button data-act="hand" data-n="' + esc(p.name) + '" data-v="R" aria-pressed="' + (p.hand !== 'L') + '">Right</button><button data-act="hand" data-n="' + esc(p.name) + '" data-v="L" aria-pressed="' + (p.hand === 'L') + '">Left</button></div>' +
        '<button class="link" data-act="delplayer" data-n="' + esc(p.name) + '">Remove</button></div>';
    }).join('');
    return '<section class="card"><h2>Players</h2>' +
      '<p class="muted" style="font-size:14px">Your group, saved on this device. Pick them into Team A or Team B when you start a match. The batting hand decides which side counts as off and which as leg for the wagon wheel.</p>' +
      (rows ? '<div>' + rows + '</div>' : '<p class="muted">Nobody yet. Add your group below.</p>') +
      '<div class="field"><label for="newName">Add players (separate with commas)</label><div class="row2"><input id="newName" type="text" placeholder="Sahil, Ravi, Imran" value="' + esc(draft.newName) + '" autocomplete="off"><button class="btn" data-act="addplayers">Add</button></div></div></section>' +
      '<section class="card"><h2>Backup</h2><p class="muted" style="font-size:14px">Everything lives in this browser. Copy a backup now and then, or move your data to another phone.</p>' +
      '<button class="btn" data-act="backup">Backup or restore</button></section>';
  }

  /* ---------- stats view ---------- */
  function statsList() {
    var names = roster.map(function (p) { return p.name; });
    var cs = C.careerStats(history, names);
    return names.map(function (n) { return cs[n]; }).filter(Boolean);
  }
  function avg(b) { return b.outs ? (b.runs / b.outs).toFixed(1) : (b.inns ? b.runs.toFixed(1) + '*' : '-'); }
  function sr(b) { return b.balls ? (b.runs * 100 / b.balls).toFixed(0) : '-'; }
  function eco(b) { return b.legal ? (b.runs * 6 / b.legal).toFixed(1) : '-'; }

  function matchSummary(m) {
    var s = C.replay(m), c = s.cfg;
    var parts = s.innings.filter(function (i) { return !i.isSuper; }).map(function (i) { return c.teams[i.bat] + ' ' + i.runs + '/' + i.wkts; });
    return { line: parts.join(' v '), result: s.result.text, potm: s.potm };
  }

  function statsView() {
    if (!history.length) {
      return '<section class="card"><h2>Stats</h2><p class="muted">Finish a match and it is saved here. Runs, wickets, averages and every player’s wagon wheel build up over time.</p></section>';
    }
    var list = statsList();
    var tabs = '<div class="pills"><button class="sel" data-act="statstab" data-v="bat" aria-pressed="' + (statsTab === 'bat') + '">Batting</button><button class="sel" data-act="statstab" data-v="bowl" aria-pressed="' + (statsTab === 'bowl') + '">Bowling</button><button class="sel" data-act="statstab" data-v="team" aria-pressed="' + (statsTab === 'team') + '">Teamwork</button></div>';
    var table;
    if (statsTab === 'bat') {
      var rows = list.filter(function (p) { return p.bat.inns; }).sort(function (a, b) { return b.bat.runs - a.bat.runs; }).map(function (p) {
        var b = p.bat;
        return '<tr><td><button class="rowbtn" data-act="selplayer" data-n="' + esc(p.name) + '">' + esc(p.name) + '</button></td><td class="n">' + p.matches + '</td><td class="n">' + b.inns + '</td><td class="r n">' + b.runs + '</td><td class="n">' + b.hs + (b.hsNo ? '*' : '') + '</td><td class="n">' + avg(b) + '</td><td class="n">' + sr(b) + '</td><td class="n">' + b.fours + '</td><td class="n">' + b.sixes + '</td></tr>';
      }).join('');
      table = rows ? '<div class="tbl"><table><thead><tr><th>Player</th><th>M</th><th>Inn</th><th>Runs</th><th>HS</th><th>Avg</th><th>SR</th><th>4s</th><th>6s</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted">No batting yet for the players on your list.</p>';
    } else if (statsTab === 'bowl') {
      var brows = list.filter(function (p) { return p.bowl.legal; }).sort(function (a, b) { return b.bowl.wkts - a.bowl.wkts || (a.bowl.runs / a.bowl.legal) - (b.bowl.runs / b.bowl.legal); }).map(function (p) {
        var b = p.bowl;
        return '<tr><td><button class="rowbtn" data-act="selplayer" data-n="' + esc(p.name) + '">' + esc(p.name) + '</button></td><td class="n">' + b.inns + '</td><td class="n">' + ovs(b.legal) + '</td><td class="n">' + b.runs + '</td><td class="r n">' + b.wkts + '</td><td class="n">' + (b.best ? b.best.w + '/' + b.best.r : '-') + '</td><td class="n">' + eco(b) + '</td></tr>';
      }).join('');
      table = brows ? '<div class="tbl"><table><thead><tr><th>Player</th><th>Inn</th><th>O</th><th>R</th><th>W</th><th>Best</th><th>Eco</th></tr></thead><tbody>' + brows + '</tbody></table></div>' : '<p class="muted">No bowling yet for the players on your list.</p>';
    } else {
      var trows = list.sort(function (a, b) { return b.wins - a.wins || b.potm - a.potm; }).map(function (p) {
        return '<tr><td><button class="rowbtn" data-act="selplayer" data-n="' + esc(p.name) + '">' + esc(p.name) + '</button></td><td class="n">' + p.matches + '</td><td class="r n">' + p.wins + '</td><td class="n">' + pct(p.wins, p.matches) + '</td><td class="n">' + p.potm + '</td></tr>';
      }).join('');
      table = '<div class="tbl"><table><thead><tr><th>Player</th><th>M</th><th>Won</th><th>Win %</th><th>POTM</th></tr></thead><tbody>' + trows + '</tbody></table></div>';
    }
    var detail = '';
    if (selPlayer) {
      var p = list.filter(function (x) { return x.name === selPlayer; })[0];
      if (p) {
        var hand = handOfName(p.name);
        detail = '<section class="card"><div><p class="eyebrow">Player</p><h2>' + esc(p.name) + ' <span class="muted" style="font-size:15px;text-transform:none">' + (hand === 'L' ? 'left-hander' : 'right-hander') + '</span></h2></div>' +
          '<div class="tiles"><div class="tile"><b>' + p.matches + '</b><span>Matches</span></div><div class="tile"><b>' + p.bat.runs + '</b><span>Runs</span></div><div class="tile"><b>' + p.bowl.wkts + '</b><span>Wickets</span></div>' +
          '<div class="tile"><b>' + avg(p.bat) + '</b><span>Bat avg</span></div><div class="tile"><b>' + sr(p.bat) + '</b><span>Strike rate</span></div><div class="tile"><b>' + eco(p.bowl) + '</b><span>Economy</span></div></div>' +
          '<h2 style="margin-top:4px">Where ' + esc(p.name) + ' scores</h2>' + wheelSVG(p.bat.shots, hand, false) + legend() +
          '<p class="muted" style="font-size:14px;text-align:center">' + p.bat.shots.length + ' tracked shots across all matches.</p>' + zoneRows(p.bat.zones) +
          '<button class="btn sm" data-act="selplayer" data-n="">Close</button></section>';
      }
    }
    return '<section class="card"><h2>Career stats</h2>' + tabs + table +
      '<p class="muted" style="font-size:13px">Only players on your Players list are counted. Super overs are left out. Tap a name for their wagon wheel. Every match is listed under History.</p></section>' + detail;
  }

  /* ---------- history view: every finished match, open any of them ---------- */
  function dateText(m) {
    return m.date ? new Date(m.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  // Run fn() while the page-wide `st` points at another match. This lets the same
  // scorecard and analysis code that draws the live match also draw an old one.
  function withMatch(m, fn) {
    var saved = st;
    st = C.replay(m);
    try { return fn(); } finally { st = saved; }
  }

  function historyDetail(m) {
    return withMatch(m, function () {
      var lines = st.innings.map(function (i) {
        return '<div class="li"><span>' + esc(team(i.bat)) + ' <span class="muted">' + esc(innLabel(i)) + '</span></span><b class="num">' + i.runs + '/' + i.wkts + ' (' + ovs(i.legal) + ')</b></div>';
      }).join('');
      var rules = plural(st.cfg.overs, 'over') + (st.cfg.maxOversPerBowler ? ', ' + st.cfg.maxOversPerBowler + ' per bowler' : '') + (st.cfg.lastMan ? ', last man stands' : '') + (st.cfg.extraRun ? '' : ', no extra run on wides');
      var head = '<button class="link" data-act="closematch">← All matches</button>' +
        '<section class="card"><p class="eyebrow">' + esc(dateText(m)) + '</p><h2 style="font-size:28px;line-height:1.05">' + esc(st.result.text) + '</h2>' +
        '<div class="list">' + lines + '</div>' +
        (st.potm ? '<p>Player of the match: <b>' + esc(st.potm.name) + '</b> <span class="muted">(' + esc(team(st.potm.team)) + ')</span></p>' : '') +
        '<p class="muted" style="font-size:14px">' + esc(rules) + '</p>' +
        '<button class="btn sm" data-act="delmatch" data-id="' + esc(m.id) + '">Delete this match</button></section>';
      var tabs = '<div class="pills"><button class="sel" data-act="htab" data-v="card" aria-pressed="' + (htab === 'card') + '">Scorecard</button>' +
        '<button class="sel" data-act="htab" data-v="ana" aria-pressed="' + (htab === 'ana') + '">Analysis</button></div>';
      return head + tabs + (htab === 'ana' ? analysisTab() : cardTab());
    });
  }

  function historyView() {
    var open = null;
    history.forEach(function (h) { if (h.id === viewMatchId) open = h; });
    if (open) return historyDetail(open);
    viewMatchId = null;
    if (!history.length) {
      return '<section class="card"><h2>Match history</h2><p class="muted">Finished matches are saved here. Open one to see its full scorecard, wagon wheel and over-by-over runs.</p></section>';
    }
    var rows = history.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }).map(function (m) {
      var s = matchSummary(m);
      var bits = [s.line, dateText(m)].concat(s.potm ? ['POTM ' + s.potm.name] : []).filter(Boolean).join(' · ');
      return '<div class="hrow"><span class="t"><button class="rowbtn" data-act="openmatch" data-id="' + esc(m.id) + '">' + esc(s.result) + '</button><small>' + esc(bits) + '</small></span>' +
        '<button class="link" data-act="delmatch" data-id="' + esc(m.id) + '">Delete</button></div>';
    }).join('');
    return '<section class="card"><h2>Match history (' + history.length + ')</h2>' + rows + '</section>';
  }

  /* ---------- sheets ---------- */
  var KIND_LABEL = { bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', stumped: 'Stumped', hitwicket: 'Hit wicket', runout: 'Run out' };

  function kindPills(prefix, current) {
    return C.WICKET_KINDS.map(function (k) {
      return '<button class="sel red" data-act="' + prefix + '-kind" data-v="' + k + '" aria-pressed="' + (current === k) + '">' + KIND_LABEL[k] + '</button>';
    }).join('');
  }

  function wicketSheet(c) {
    var s = sheet;
    var out = '';
    if (s.kind === 'runout') {
      var two = [c.striker].concat(c.nonStriker ? [c.nonStriker] : []);
      out = '<div class="blk"><span class="lbl">Who is out</span><div class="pills">' + two.map(function (n) {
        return '<button class="sel red" data-act="wk-out" data-n="' + esc(n) + '" aria-pressed="' + (s.out === n) + '">' + esc(n) + '</button>';
      }).join('') + '</div></div><div class="blk"><span class="lbl">Runs completed first</span><div class="pills">' + [0, 1, 2, 3].map(function (n) {
        return '<button class="sel" data-act="wk-runs" data-n="' + n + '" aria-pressed="' + (s.runs === n) + '">' + n + '</button>';
      }).join('') + '</div></div>';
    }
    var warn = '';
    if (s.kind && s.kind !== 'runout' && (c.freeHit || mode === 'nb')) warn = '<p class="err">Free hit or no-ball: only a run out counts. This ball will be marked not out.</p>';
    else if (s.kind && s.kind !== 'runout' && mode === 'wd' && s.kind !== 'stumped' && s.kind !== 'hitwicket') warn = '<p class="err">On a wide only stumped, hit wicket or run out count.</p>';
    else if (s.kind && s.kind !== 'runout' && (mode === 'b' || mode === 'lb')) warn = '<p class="err">Not out on a bye. Only a run out counts here.</p>';
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Wicket"><div class="in"><h2>Wicket</h2>' +
      (mode ? '<p class="muted">On a ' + { wd: 'wide', nb: 'no-ball', b: 'bye', lb: 'leg bye' }[mode] + '.</p>' : '') +
      '<div class="blk"><span class="lbl">How</span><div class="pills">' + kindPills('wk', s.kind) + '</div></div>' + out + warn +
      '<div class="acts"><button class="btn" data-act="closesheet">Cancel</button><button class="btn danger" data-act="wk-confirm"' + (s.kind ? '' : ' disabled') + '>Confirm out</button></div></div></div>';
  }

  function editSheet() {
    var s = sheet;
    var inn = st.innings.filter(function (i) { return i.balls.some(function (b) { return b.idx === s.idx; }); })[0];
    var rosterIn = st.cfg.players[inn.bat];
    var extras = [[null, 'None'], ['wd', 'Wide'], ['nb', 'No ball'], ['b', 'Bye'], ['lb', 'Leg bye']];
    var outPick = '';
    if (s.kind === 'runout') {
      outPick = '<div class="blk"><span class="lbl">Who is out</span><select id="edOut">' + rosterIn.map(function (n) {
        return '<option value="' + esc(n) + '"' + (s.out === n ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('') + '</select></div>';
    }
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Edit ball"><div class="in"><h2>Edit this ball</h2>' +
      '<div class="blk"><span class="lbl">Runs</span><div class="pills">' + [0, 1, 2, 3, 4, 5, 6].map(function (n) {
        return '<button class="sel" data-act="ed-runs" data-n="' + n + '" aria-pressed="' + (s.runs === n) + '">' + n + '</button>';
      }).join('') + '</div></div>' +
      '<div class="blk"><span class="lbl">Extra</span><div class="pills">' + extras.map(function (e) {
        return '<button class="sel" data-act="ed-extra" data-v="' + (e[0] || '') + '" aria-pressed="' + (s.extra === e[0]) + '">' + e[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="blk"><span class="lbl">Wicket</span><div class="pills"><button class="sel red" data-act="ed-kind" data-v="" aria-pressed="' + (!s.kind) + '">No wicket</button>' + kindPills('ed', s.kind) + '</div></div>' + outPick +
      '<p class="muted" style="font-size:14px">Everything after this ball is replayed. If a later ball can no longer happen, the change is refused. The shot direction stays as it was.</p>' +
      '<div class="acts"><button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="ed-save">Save ball</button></div></div></div>';
  }

  function shotSheet() {
    var c = st.cur, hand = (st.cfg.hands && st.cfg.hands[c.striker] === 'L') ? 'L' : 'R';
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Shot direction"><div class="in"><h2>Where did the ' + (sheet.n === 1 ? 'single' : sheet.n) + ' go?</h2>' +
      '<p class="muted" style="font-size:14px">' + esc(c.striker) + ', ' + (hand === 'L' ? 'left' : 'right') + '-handed. Tap the spot on the field. Bowler’s end is at the top. Tap near the edge for a boundary.</p>' +
      wheelSVG([], hand, true) +
      '<div class="acts"><button class="btn" data-act="closesheet">Cancel</button><button class="btn" data-act="shot-skip">Skip direction</button></div></div></div>';
  }

  function backupSheet() {
    var data = JSON.stringify({ app: 'gully-scorer', version: 1, roster: roster, history: history });
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Backup"><div class="in"><h2>Backup</h2>' +
      '<p class="muted" style="font-size:14px">This is all your players and finished matches. Copy it somewhere safe. To restore, paste a backup into the box and tap Restore. Restoring replaces the players and matches on this device.</p>' +
      '<textarea id="bkText" class="code" spellcheck="false">' + esc(data) + '</textarea>' +
      '<div class="acts"><button class="btn" data-act="bk-copy">Copy</button><button class="btn danger" data-act="bk-restore">Restore from box</button></div>' +
      '<button class="btn" data-act="closesheet">Close</button></div></div>';
  }

  function simpleSheet(title, text, yesLabel, yesAct, danger, data) {
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="' + esc(title) + '"><div class="in"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
      '<div class="acts"><button class="btn" data-act="closesheet">Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-act="' + yesAct + '"' + (data ? ' data-id="' + esc(data) + '" data-n="' + esc(data) + '"' : '') + '>' + esc(yesLabel) + '</button></div></div></div>';
  }

  function sheetHTML() {
    if (!sheet) return '';
    switch (sheet.type) {
      case 'wicket': return wicketSheet(st.cur);
      case 'edit': return editSheet();
      case 'shot': return shotSheet();
      case 'backup': return backupSheet();
      case 'end': return simpleSheet('End innings?', 'This closes ' + team(st.cur.bat) + "'s innings at " + st.cur.runs + '/' + st.cur.wkts + '. You can undo it.', 'End innings', 'end-confirm', false);
      case 'new': return simpleSheet('Start a new match?', st.finished ? 'This match is already saved in Stats.' : 'The match in progress will be removed from this device.', 'New match', 'new-confirm', true);
      case 'delmatch': return simpleSheet('Delete this match?', 'Its runs and wickets are taken out of every player’s stats.', 'Delete', 'delmatch-confirm', true, sheet.id);
      case 'delplayer': return simpleSheet('Remove ' + sheet.name + '?', 'They leave your list. Past matches stay saved, but the stats page only counts players on the list.', 'Remove', 'delplayer-confirm', true, sheet.name);
    }
    return '';
  }

  /* ---------- render ---------- */
  function render() {
    var app = document.getElementById('app');
    if (!match && view === 'match') readDraft();
    if (view === 'players') readDraft();
    var nav = [['match', 'Match'], ['history', 'History'], ['stats', 'Stats'], ['players', 'Players']].map(function (t) {
      return '<button role="tab" data-act="nav" data-v="' + t[0] + '" aria-selected="' + (view === t[0]) + '">' + t[1] + '</button>';
    }).join('');
    var body;
    if (view === 'stats') body = statsView();
    else if (view === 'history') body = historyView();
    else if (view === 'players') body = playersView();
    else if (!match) body = setupHTML();
    else {
      var tabs = [['score', 'Score'], ['card', 'Scorecard'], ['balls', 'Balls'], ['ana', 'Analysis']].map(function (t) {
        return '<button role="tab" data-act="tab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>';
      }).join('');
      body = '<div class="tabs t4" role="tablist">' + tabs + '</div>' +
        (tab === 'score' ? scoreTab() : tab === 'card' ? cardTab() : tab === 'balls' ? ballsTab() : analysisTab());
    }
    app.innerHTML = '<div class="bar"><span class="brand">Gully Scorer</span><span class="barbtns">' +
      (match && view === 'match' ? '<button class="link" data-act="newmatch">New match</button>' : '') +
      '<button class="link" data-act="theme" aria-label="Change colour theme, now ' + THEME_LABEL[prefs.theme] + '">Theme: ' + THEME_LABEL[prefs.theme] + '</button></span></div>' +
      '<div class="tabs t4 nav" role="tablist">' + nav + '</div>' + body + sheetHTML();
  }

  /* ---------- events ---------- */
  function commitRun(n, shot) {
    var a = { t: 'ball', runs: n, extra: mode };
    if (mode === 'wd' || mode === 'nb') a.pen = st.cfg.extraRun ? 1 : 0;
    if (shot) a.shot = shot;
    act(a);
  }
  function recordRun(n) {
    if (prefs.track && n > 0 && (mode === null || mode === 'nb')) { sheet = { type: 'shot', n: n }; render(); return; }
    commitRun(n, null);
  }

  function findBall(idx) {
    for (var i = 0; i < st.innings.length; i++) {
      for (var j = 0; j < st.innings[i].balls.length; j++) {
        if (st.innings[i].balls[j].idx === idx) return st.innings[i].balls[j];
      }
    }
    return null;
  }

  function shotFromEvent(e, svg) {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var x = ((e.clientX - r.left) / r.width * 2 - 1) * VB;
    var y = ((e.clientY - r.top) / r.height * 2 - 1) * VB;
    var dist = Math.sqrt(x * x + y * y) / RAD;
    return { a: Math.round(Math.atan2(x, -y) * 180 / Math.PI * 10) / 10, r: Math.round(Math.min(dist, 1) * 100) / 100 };
  }

  function restoreBackup() {
    var el = document.getElementById('bkText');
    try {
      var data = JSON.parse(el.value);
      if (!data || data.app !== 'gully-scorer') throw new Error('That is not a Gully Scorer backup.');
      roster = cleanRoster(data.roster);
      history = cleanHistory(data.history);
      saveRoster(); saveHist();
      sheet = null;
      flash('Restored ' + roster.length + ' players and ' + history.length + ' matches');
    } catch (err) { flash(err.message || 'Could not read that backup'); }
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    var d = t.dataset, c = st && st.cur;
    switch (d.act) {
      case 'nav': readDraft(); view = d.v; sheet = null; viewMatchId = null; break;
      case 'theme': cycleTheme(); break;
      case 'openmatch': viewMatchId = d.id; htab = 'card'; anaInn = null; anaBat = ''; break;
      case 'closematch': viewMatchId = null; anaInn = null; anaBat = ''; break;
      case 'htab': htab = d.v; anaInn = null; anaBat = ''; break;
      case 'start': startMatch(); return;
      case 'assign': readDraft(); if (d.v) draft.assign[d.n] = d.v; else delete draft.assign[d.n]; break;
      case 'shuffle': {
        readDraft();
        var order = roster.map(function (p) { return p.name; });
        for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
        draft.assign = {};
        order.forEach(function (n, k) { draft.assign[n] = k % 2 === 0 ? 'A' : 'B'; });
        break;
      }
      case 'clearassign': readDraft(); draft.assign = {}; break;
      case 'addplayers': {
        readDraft();
        var added = addPlayers(draft.newName);
        draft.newName = '';
        flash(added ? 'Added ' + plural(added, 'player') : 'Nothing new to add');
        break;
      }
      case 'hand': roster.forEach(function (p) { if (p.name === d.n) p.hand = d.v === 'L' ? 'L' : 'R'; }); saveRoster(); break;
      case 'delplayer': sheet = { type: 'delplayer', name: d.n }; break;
      case 'delplayer-confirm':
        roster = roster.filter(function (p) { return p.name !== d.n; });
        delete draft.assign[d.n];
        saveRoster(); sheet = null; if (selPlayer === d.n) selPlayer = null;
        break;
      case 'backup': sheet = { type: 'backup' }; break;
      case 'bk-copy': {
        var box = document.getElementById('bkText');
        box.select();
        try { navigator.clipboard.writeText(box.value).then(function () { flash('Backup copied'); }, function () { flash('Press and hold the text to copy it'); }); }
        catch (err) { flash('Press and hold the text to copy it'); }
        return;
      }
      case 'bk-restore': restoreBackup(); break;
      case 'statstab': statsTab = d.v; break;
      case 'selplayer': selPlayer = d.n || null; break;
      case 'delmatch': sheet = { type: 'delmatch', id: d.id }; break;
      case 'delmatch-confirm':
        history = history.filter(function (m) { return m.id !== d.id; });
        if (viewMatchId === d.id) viewMatchId = null;
        if (match && match.id === d.id) { match = null; st = null; saveMatch(); }
        saveHist(); sheet = null;
        break;
      case 'tab': tab = d.v; break;
      case 'anainn': anaInn = +d.i; anaBat = ''; break;
      case 'anabat': anaBat = d.n; break;
      case 'mode': mode = mode === d.v ? null : d.v; break;
      case 'run': recordRun(+d.n); return;
      case 'field': {
        if (!sheet || sheet.type !== 'shot') return;
        var shot = shotFromEvent(e, t);
        if (!shot) return;
        commitRun(sheet.n, shot);
        return;
      }
      case 'shot-skip': commitRun(sheet.n, null); return;
      case 'track': prefs.track = !prefs.track; savePrefs(); break;
      case 'wicket': sheet = { type: 'wicket', kind: null, out: c.striker, runs: 0 }; break;
      case 'wk-kind': sheet.kind = d.v; break;
      case 'wk-out': sheet.out = d.n; break;
      case 'wk-runs': sheet.runs = +d.n; break;
      case 'wk-confirm': {
        var s = sheet, a = { t: 'ball', runs: s.kind === 'runout' ? s.runs : 0, extra: mode, wicket: { kind: s.kind } };
        if (s.kind === 'runout') a.wicket.out = s.out;
        if (mode === 'wd' || mode === 'nb') a.pen = st.cfg.extraRun ? 1 : 0;
        act(a); return;
      }
      case 'swap': act({ t: 'swap' }); return;
      case 'undo':
        try { match = C.undo(match); mode = null; sheet = null; commitState(); flash('Undone'); } catch (err) { flash(err.message); }
        break;
      case 'end': sheet = { type: 'end' }; break;
      case 'end-confirm': act({ t: 'endInnings' }); return;
      case 'xr': match = C.setExtraRun(match, !match.config.extraRun); commitState(); break;
      case 'open': {
        var so = document.getElementById('opS').value, no = document.getElementById('opN').value;
        act({ t: 'open', striker: so, nonStriker: no }); return;
      }
      case 'bowler': act({ t: 'bowler', name: d.n }); return;
      case 'potm': act({ t: 'potm', team: +d.team, name: d.n }); return;
      case 'newmatch': sheet = { type: 'new' }; break;
      case 'new-confirm': match = null; st = null; sheet = null; mode = null; saveMatch(); view = 'match'; break;
      case 'closesheet': sheet = null; break;
      case 'editball': {
        var b = findBall(+d.i);
        if (!b) return;
        sheet = { type: 'edit', idx: b.idx, runs: b.action.runs, extra: b.action.extra, kind: b.action.wicket ? b.action.wicket.kind : null,
          out: b.action.wicket && b.action.wicket.out ? b.action.wicket.out : b.batter, pen: b.action.pen };
        break;
      }
      case 'ed-runs': sheet.runs = +d.n; break;
      case 'ed-extra': sheet.extra = d.v || null; break;
      case 'ed-kind': sheet.kind = d.v || null; break;
      case 'ed-save': {
        var es = sheet, outEl = document.getElementById('edOut');
        var patch = { runs: es.runs, extra: es.extra, wicket: es.kind ? { kind: es.kind } : null };
        if (es.kind === 'runout') patch.wicket.out = outEl ? outEl.value : es.out;
        patch.pen = (es.extra === 'wd' || es.extra === 'nb') ? (es.pen !== undefined ? es.pen : (st.cfg.extraRun ? 1 : 0)) : undefined;
        try { match = C.editBall(match, es.idx, patch); sheet = null; commitState(); flash('Ball updated'); } catch (err) { flash(err.message); }
        break;
      }
    }
    render();
  });

  /* ---------- boot ---------- */
  roster = cleanRoster(lsGet(K.roster, []));
  history = cleanHistory(lsGet(K.hist, []));
  var p = lsGet(K.prefs, null);
  if (p && typeof p.track === 'boolean') prefs.track = p.track;
  if (p && (p.theme === 'light' || p.theme === 'dark' || p.theme === 'auto')) prefs.theme = p.theme;
  applyTheme();
  var saved = lsGet(K.match, null);
  try { if (saved && saved.config) { C.replay(saved); match = saved; } } catch (e) { match = null; }
  if (match) st = C.replay(match);
  render();
})();
