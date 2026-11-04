const C = require(process.argv[2] || './engine.js');
const assert = require('assert');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const A = ['A1', 'A2', 'A3', 'A4'];
const B = ['B1', 'B2', 'B3', 'B4'];
function mk(over) {
  return C.createMatch(Object.assign({ teams: ['Alpha', 'Bravo'], players: [A, B], overs: 2 }, over || {}));
}
const open = (s, n) => ({ t: 'open', striker: s, nonStriker: n });
const bowl = (name) => ({ t: 'bowler', name });
const ball = (runs, extra, wicket, pen) => {
  const a = { t: 'ball', runs: runs || 0, extra: extra || null, wicket: wicket || null };
  if (pen !== undefined) a.pen = pen;
  return a;
};
function run(m, actions) {
  actions.forEach((a) => { m = C.apply(m, a); });
  return m;
}
const st = (m) => C.replay(m);
// innings 1 started, Alpha batting A1/A2, Bravo's B1 bowling
const start = (over) => run(mk(over), [open('A1', 'A2'), bowl('B1')]);

console.log('\nThe 19 checks from the reel');

check('1. counts runs, rotates strike', () => {
  let s = st(run(start(), [ball(1)])).cur;
  assert.strictEqual(s.runs, 1);
  assert.strictEqual(s.batters.A1.runs, 1);
  assert.strictEqual(s.striker, 'A2');
  s = st(run(start(), [ball(2)])).cur;
  assert.strictEqual(s.striker, 'A1');
  s = st(run(start(), [ball(3)])).cur;
  assert.strictEqual(s.striker, 'A2');
  s = st(run(start(), [ball(4), ball(6)])).cur;
  assert.strictEqual(s.striker, 'A1');
  assert.strictEqual(s.runs, 10);
  assert.strictEqual(s.batters.A1.fours, 1);
  assert.strictEqual(s.batters.A1.sixes, 1);
  // end of over rotates strike
  s = st(run(start(), [ball(0), ball(0), ball(0), ball(0), ball(0), ball(0)])).cur;
  assert.strictEqual(s.striker, 'A2');
  // single on the last ball: swap for the run, swap again for the over
  s = st(run(start(), [ball(0), ball(0), ball(0), ball(0), ball(0), ball(1)])).cur;
  assert.strictEqual(s.striker, 'A1');
});

check('2. wide and no-ball re-bowled', () => {
  const s = st(run(start(), [ball(0, 'wd'), ball(0, 'nb'), ball(0)])).cur;
  assert.strictEqual(s.legal, 1);
  assert.strictEqual(s.runs, 2);
  assert.strictEqual(C.oversText(s.legal), '0.1');
  // six wides do not end the over
  const six = st(run(start(), [ball(0, 'wd'), ball(0, 'wd'), ball(0, 'wd'), ball(0, 'wd'), ball(0, 'wd'), ball(0, 'wd')])).cur;
  assert.strictEqual(six.legal, 0);
  assert.strictEqual(six.needBowler, false);
  // wide is not a ball faced, no-ball is
  assert.strictEqual(s.batters.A1.balls, 2);
});

check('3. turn off the extra run', () => {
  let s = st(run(start({ extraRun: false }), [ball(0, 'wd'), ball(0, 'nb')])).cur;
  assert.strictEqual(s.runs, 0);
  assert.strictEqual(s.legal, 0);
  // per-ball switch while the match default stays on
  s = st(run(start(), [ball(0, 'wd', null, 0), ball(0, 'wd', null, 1)])).cur;
  assert.strictEqual(s.runs, 1);
  // switching it off mid-match only changes new balls
  let m = run(start(), [ball(0, 'wd', null, 1)]);
  m = C.setExtraRun(m, false);
  assert.strictEqual(st(m).cur.runs, 1);
});

check('4. byes go to extras', () => {
  const s = st(run(start(), [ball(2, 'b'), ball(1, 'lb')])).cur;
  assert.strictEqual(s.runs, 3);
  assert.strictEqual(s.extras.b, 2);
  assert.strictEqual(s.extras.lb, 1);
  assert.strictEqual(s.batters.A1.runs, 0);
  assert.strictEqual(s.batters.A2.runs, 0);
  assert.strictEqual(s.bowlers.B1.runs, 0);
  assert.strictEqual(s.legal, 2);
  assert.strictEqual(s.striker, 'A2'); // odd leg bye swapped, even bye did not
});

check('5. end of over asks for a bowler', () => {
  const m = run(start(), [ball(0), ball(0), ball(0), ball(0), ball(0), ball(0)]);
  assert.strictEqual(st(m).cur.needBowler, true);
  assert.throws(() => C.apply(m, ball(1)), /bowler/i);
  const m2 = C.apply(m, bowl('B2'));
  assert.strictEqual(st(m2).cur.needBowler, false);
  assert.strictEqual(st(m2).cur.bowler, 'B2');
});

check('6. caps overs per bowler', () => {
  const six = Array(6).fill(ball(0));
  let m = run(start({ maxOversPerBowler: 1, overs: 3 }), six);
  assert.throws(() => C.apply(m, bowl('B1')), /maximum 1 over/);
  m = run(m, [bowl('B2')]);
  assert.strictEqual(C.availableBowlers(st(m)).find((b) => b.name === 'B1').ok, false);
  assert.throws(() => C.createMatch({ players: [A, B], overs: 6, maxOversPerBowler: 1 }), /cannot cover/);
});

check('7. manual strike swap', () => {
  let s = st(run(start(), [{ t: 'swap' }])).cur;
  assert.strictEqual(s.striker, 'A2');
  assert.strictEqual(s.runs, 0);
  s = st(run(start(), [{ t: 'swap' }, { t: 'swap' }])).cur;
  assert.strictEqual(s.striker, 'A1');
});

check('8. new batter at the out end', () => {
  // striker bowled: new batter takes the striker end
  let s = st(run(start(), [ball(0, null, { kind: 'bowled' })])).cur;
  assert.strictEqual(s.striker, 'A3');
  assert.strictEqual(s.nonStriker, 'A2');
  assert.strictEqual(s.wkts, 1);
  assert.strictEqual(s.bowlers.B1.wkts, 1);
  assert.strictEqual(s.batters.A1.how, 'b B1');
  // non-striker run out with no run: new batter takes the non-striker end
  s = st(run(start(), [ball(0, null, { kind: 'runout', out: 'A2' })])).cur;
  assert.strictEqual(s.striker, 'A1');
  assert.strictEqual(s.nonStriker, 'A3');
  assert.strictEqual(s.bowlers.B1.wkts, 0);
});

check('9. run out after a run', () => {
  // A1 and A2 cross once, then A1 is run out at the far end
  let s = st(run(start(), [ball(1, null, { kind: 'runout', out: 'A1' })])).cur;
  assert.strictEqual(s.runs, 1);
  assert.strictEqual(s.batters.A1.runs, 1);
  assert.strictEqual(s.batters.A1.out, true);
  assert.strictEqual(s.striker, 'A2');
  assert.strictEqual(s.nonStriker, 'A3');
  // the other batter is run out instead
  s = st(run(start(), [ball(1, null, { kind: 'runout', out: 'A2' })])).cur;
  assert.strictEqual(s.striker, 'A3');
  assert.strictEqual(s.nonStriker, 'A1');
  assert.throws(() => C.apply(start(), ball(0, null, { kind: 'runout', out: 'A4' })), /two batters/);
});

check('10. all out at players minus one', () => {
  const m = run(start({ overs: 5 }), [
    ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'caught' }), ball(0, null, { kind: 'lbw' })
  ]);
  const s = st(m).innings[0]; // the closed first innings (cur is now the chase)
  assert.strictEqual(s.wkts, 3);
  assert.strictEqual(s.closed, true);
  assert.strictEqual(s.closeReason, 'allout');
  assert.strictEqual(st(m).innings.length, 2);
  assert.strictEqual(st(m).cur.target, 1);
});

check('11. last man stands', () => {
  let m = run(start({ overs: 5, lastMan: true }), [
    ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'caught' }), ball(0, null, { kind: 'lbw' })
  ]);
  let s = st(m).cur;
  assert.strictEqual(s.closed, false);
  assert.strictEqual(s.solo, true);
  assert.strictEqual(s.striker, 'A2'); // the one batter left
  assert.strictEqual(s.nonStriker, null);
  const survivor = s.striker;
  m = run(m, [ball(1), ball(3)]); // odd runs, no partner to swap with
  s = st(m).cur;
  assert.strictEqual(s.striker, survivor);
  assert.strictEqual(s.batters[survivor].runs, 4);
  assert.throws(() => C.apply(m, { t: 'swap' }), /Only one/);
  m = C.apply(m, ball(0, null, { kind: 'bowled' }));
  s = st(m).innings[0];
  assert.strictEqual(s.wkts, 4);
  assert.strictEqual(s.closeReason, 'allout');
  // over end with a lone batter keeps strike
  m = run(start({ overs: 5, lastMan: true }), [
    ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'caught' }), ball(0, null, { kind: 'lbw' }),
    ball(0), ball(0), ball(0)
  ]);
  assert.strictEqual(st(m).cur.needBowler, true);
  assert.strictEqual(st(m).cur.nonStriker, null);
});

check('12. free hit after a no-ball', () => {
  // the ball after a no-ball is a free hit: bowled is not out
  let s = st(run(start(), [ball(0, 'nb'), ball(0, null, { kind: 'bowled' })])).cur;
  assert.strictEqual(s.wkts, 0);
  assert.strictEqual(s.balls[1].notOut, 'bowled');
  assert.strictEqual(s.balls[1].freeHit, true);
  // free hit is used up by the legal ball, the next bowled is out
  s = st(run(start(), [ball(0, 'nb'), ball(2), ball(0, null, { kind: 'bowled' })])).cur;
  assert.strictEqual(s.wkts, 1);
  // a wide on the free hit keeps the free hit for the next legal ball
  s = st(run(start(), [ball(0, 'nb'), ball(0, 'wd'), ball(0, null, { kind: 'bowled' })])).cur;
  assert.strictEqual(s.wkts, 0);
  // run out is still out on a free hit
  s = st(run(start(), [ball(0, 'nb'), ball(0, null, { kind: 'runout', out: 'A1' })])).cur;
  assert.strictEqual(s.wkts, 1);
  // no-ball itself cannot be a bowled wicket
  s = st(run(start(), [ball(0, 'nb', { kind: 'caught' })])).cur;
  assert.strictEqual(s.wkts, 0);
});

check('13. chase ends at the target', () => {
  // Alpha: 6 off the over, 2 over match. Bravo chase 7.
  let m = run(start({ overs: 2 }), [ball(6), ball(0), ball(0), ball(0), ball(0), ball(0), { t: 'bowler', name: 'B2' }, ball(0), ball(0), ball(0), ball(0), ball(0), ball(0)]);
  let s = st(m);
  assert.strictEqual(s.innings[1].target, 7);
  m = run(m, [open('B1', 'B2'), bowl('A1'), ball(4), ball(2)]);
  s = st(m);
  assert.strictEqual(s.innings[1].runs, 6);
  assert.strictEqual(s.innings[1].closed, false);
  m = C.apply(m, ball(1));
  s = st(m);
  assert.strictEqual(s.innings[1].closeReason, 'target');
  assert.strictEqual(s.innings[1].legal, 3); // stopped mid-over
  assert.strictEqual(s.finished, true);
  assert.strictEqual(s.result.team, 'Bravo');
  assert.strictEqual(s.result.margin.type, 'wickets');
  assert.strictEqual(s.result.margin.n, 3);
  assert.throws(() => C.apply(m, ball(1)), /match is over/);
});

check('14. defending team wins by runs', () => {
  const firstInnings = [open('A1', 'A2'), bowl('B1'), ball(6), ball(4), ball(0), ball(0), ball(0), ball(0), bowl('B2'), ball(0), ball(0), ball(0), ball(0), ball(0), ball(0)];
  let m = run(mk({ overs: 2 }), firstInnings);
  m = run(m, [open('B1', 'B2'), bowl('A1'), ball(1), ball(0), ball(0), ball(0), ball(0), ball(0), bowl('A2'), ball(2), ball(0), ball(0), ball(0), ball(0), ball(0)]);
  const s = st(m);
  assert.strictEqual(s.finished, true);
  assert.strictEqual(s.result.team, 'Alpha');
  assert.deepStrictEqual(s.result.margin, { type: 'runs', n: 7 });
  assert.strictEqual(s.result.text, 'Alpha won by 7 runs');
  // all out defends too
  m = run(mk({ overs: 5 }), [open('A1', 'A2'), bowl('B1'), ball(6), ball(6), ball(6), ball(6), ball(6), ball(6), bowl('B2'), ball(0)]);
  m = run(m, [{ t: 'endInnings' }, open('B1', 'B2'), bowl('A1'), ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'bowled' })]);
  assert.strictEqual(st(m).result.text, 'Alpha won by 36 runs');
});

check('15. tie, then super over', () => {
  const inn = (runsFirstBall) => [ball(runsFirstBall), ball(0), ball(0), ball(0), ball(0), ball(0)];
  let m = run(mk({ overs: 1 }), [open('A1', 'A2'), bowl('B1'), ...inn(4)]);
  m = run(m, [open('B1', 'B2'), bowl('A1'), ...inn(4)]);
  let s = st(m);
  assert.strictEqual(s.finished, false);
  assert.strictEqual(s.innings.length, 3);
  const so = s.cur;
  assert.strictEqual(so.isSuper, true);
  assert.strictEqual(so.overs, 1);
  assert.strictEqual(so.bat, 1); // team that batted second goes first
  assert.strictEqual(so.maxWk, 2);
  m = run(m, [open('B1', 'B2'), bowl('A1'), ball(6), ball(4), ball(0), ball(0), ball(0), ball(0)]);
  s = st(m);
  assert.strictEqual(s.innings.length, 4);
  assert.strictEqual(s.cur.target, 11);
  assert.strictEqual(s.cur.bat, 0);
  m = run(m, [open('A1', 'A2'), bowl('B1'), ball(6), ball(4), ball(1)]);
  s = st(m);
  assert.strictEqual(s.finished, true);
  assert.strictEqual(s.result.team, 'Alpha');
  assert.strictEqual(s.result.text, 'Alpha won the super over');
  // super over is over after two wickets
  const m2 = run(mk({ overs: 1 }), [open('A1', 'A2'), bowl('B1'), ...inn(4), open('B1', 'B2'), bowl('A1'), ...inn(4), open('B1', 'B2'), bowl('A1'), ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'bowled' })]);
  assert.strictEqual(st(m2).innings[2].closeReason, 'allout');
  assert.strictEqual(st(m2).innings.length, 4);
  // tied super over goes to another one
  const m3 = run(m, []);
  const tie = run(mk({ overs: 1 }), [open('A1', 'A2'), bowl('B1'), ...inn(4), open('B1', 'B2'), bowl('A1'), ...inn(4),
    open('B1', 'B2'), bowl('A1'), ball(2), ball(0), ball(0), ball(0), ball(0), ball(0),
    open('A1', 'A2'), bowl('B1'), ball(2), ball(0), ball(0), ball(0), ball(0), ball(0)]);
  assert.strictEqual(st(tie).finished, false);
  assert.strictEqual(st(tie).innings.length, 5);
  assert.strictEqual(st(tie).cur.bat, 0);
});

check('16. undo into the first innings', () => {
  // innings 1 finishes on its last ball; undo reopens it
  let m = run(mk({ overs: 1 }), [open('A1', 'A2'), bowl('B1'), ball(1), ball(2), ball(0), ball(0), ball(0), ball(4)]);
  let s = st(m);
  assert.strictEqual(s.innings.length, 2);
  assert.strictEqual(s.innings[0].closed, true);
  assert.strictEqual(s.innings[1].target, 8);
  m = C.undo(m);
  s = st(m);
  assert.strictEqual(s.innings.length, 1);
  assert.strictEqual(s.innings[0].closed, false);
  assert.strictEqual(s.innings[0].runs, 3);
  assert.strictEqual(s.innings[0].legal, 5);
  // keep scoring the first innings from there
  m = C.apply(m, ball(6));
  assert.strictEqual(st(m).innings[1].target, 10);
  // undo from deep in the second innings, step by step, all the way back
  m = run(m, [open('B1', 'B2'), bowl('A1'), ball(4), ball(1)]);
  assert.strictEqual(st(m).innings[1].runs, 5);
  m = C.undo(C.undo(m));
  assert.strictEqual(st(m).innings[1].runs, 0);
  m = C.undo(C.undo(C.undo(m))); // bowler, open, last ball of innings 1
  s = st(m);
  assert.strictEqual(s.innings.length, 1);
  assert.strictEqual(s.cur.runs, 3);
  assert.strictEqual(s.cur.closed, false);
  // a finished match can be undone back into the chase
  m = run(mk({ overs: 1 }), [open('A1', 'A2'), bowl('B1'), ball(6), ball(0), ball(0), ball(0), ball(0), ball(0), open('B1', 'B2'), bowl('A1'), ball(4), ball(4)]);
  assert.strictEqual(st(m).finished, true);
  m = C.undo(m);
  assert.strictEqual(st(m).finished, false);
  assert.strictEqual(st(m).cur.legal, 1);
  assert.strictEqual(st(m).cur.runs, 4);
});

check('17. end innings, undo reopens', () => {
  let m = run(start({ overs: 5 }), [ball(4), { t: 'endInnings' }]);
  let s = st(m);
  assert.strictEqual(s.innings[0].closeReason, 'manual');
  assert.strictEqual(s.innings.length, 2);
  assert.strictEqual(s.innings[1].target, 5);
  m = C.undo(m);
  s = st(m);
  assert.strictEqual(s.innings.length, 1);
  assert.strictEqual(s.cur.closed, false);
  m = C.apply(m, ball(2));
  assert.strictEqual(st(m).cur.runs, 6);
  // ending both innings with nothing scored is a tie, so a super over follows
  const both = run(start({ overs: 5 }), [{ t: 'endInnings' }, { t: 'endInnings' }]);
  assert.strictEqual(st(both).finished, false);
  assert.strictEqual(st(both).cur.isSuper, true);
});

check('18. edit a past ball', () => {
  let m = run(start({ overs: 5 }), [ball(1), ball(2), ball(0)]);
  assert.strictEqual(st(m).cur.runs, 3);
  const idx = st(m).cur.balls[1].idx;
  m = C.editBall(m, idx, { runs: 4 });
  let s = st(m).cur;
  assert.strictEqual(s.runs, 5);
  assert.strictEqual(s.batters.A1.runs, 1);
  assert.strictEqual(s.batters.A2.runs, 4);
  assert.strictEqual(s.striker, 'A2');
  // turn a run into a wicket
  m = C.editBall(m, st(m).cur.balls[2].idx, { runs: 0, wicket: { kind: 'bowled' } });
  assert.strictEqual(st(m).cur.wkts, 1);
  // turn a ball into a wide: the over now has one more ball to go
  m = C.editBall(m, st(m).cur.balls[0].idx, { extra: 'wd' });
  assert.strictEqual(st(m).cur.legal, 2);
  // an edit that would break a later action is rejected
  let m2 = run(start({ overs: 3 }), [ball(0), ball(0), ball(0), ball(0), ball(0), ball(0), bowl('B2'), ball(1)]);
  assert.throws(() => C.editBall(m2, st(m2).cur.balls[0].idx, { extra: 'wd' }), /breaks a later ball/);
  assert.throws(() => C.editBall(m, 0, { runs: 1 }), /not a ball/);
});

check('19. player of the match', () => {
  let m = run(mk({ overs: 1 }), [open('A1', 'A2'), bowl('B1'), ball(6), ball(4), ball(1), ball(0), ball(0), ball(0), open('B1', 'B2'), bowl('A1'), ball(0, null, { kind: 'bowled' }), ball(1), ball(0), ball(0), ball(0), ball(0)]);
  let s = st(m);
  assert.strictEqual(s.finished, true);
  assert.strictEqual(s.potm, null);
  assert.deepStrictEqual([s.potmSuggest.team, s.potmSuggest.name], [0, 'A1']);
  assert.throws(() => C.apply(start(), { t: 'potm', team: 0, name: 'A1' }), /not over/);
  m = C.apply(m, { t: 'potm', team: 1, name: 'B2' });
  assert.deepStrictEqual(st(m).potm, { team: 1, name: 'B2' });
});

console.log('\nThe four that failed in the reel (extra edge cases)');

check('A. counting runs through a full over with mixed deliveries', () => {
  const m = run(start({ overs: 3 }), [ball(1), ball(0, 'wd'), ball(2), ball(0, 'nb'), ball(4), ball(3, 'b'), ball(0), ball(1)]);
  const s = st(m).cur;
  // 1 + wd 1 + 2 + nb 1 + 4 + bye 3 + 0 + 1 = 13 on 6 legal balls
  assert.strictEqual(s.runs, 13);
  assert.strictEqual(s.legal, 6);
  assert.strictEqual(s.needBowler, true);
  assert.strictEqual(s.striker, 'A1'); // odd bye, odd single, then end-of-over swap
  assert.strictEqual(C.oversText(s.legal), '1.0');
});

check('B. chase ends exactly on the target and on the last ball', () => {
  const first = [open('A1', 'A2'), bowl('B1'), ball(4), ball(0), ball(0), ball(0), ball(0), ball(0)];
  let m = run(mk({ overs: 1 }), [...first, open('B1', 'B2'), bowl('A1'), ball(4), ball(0), ball(0), ball(0), ball(0), ball(1)]);
  assert.strictEqual(st(m).result.text, 'Bravo won by 3 wickets');
  // one short of the target on the last ball is a tie, not a win
  m = run(mk({ overs: 1 }), [...first, open('B1', 'B2'), bowl('A1'), ball(4), ball(0), ball(0), ball(0), ball(0), ball(0)]);
  assert.strictEqual(st(m).finished, false);
  assert.strictEqual(st(m).cur.isSuper, true);
  // chase fails after being all out
  m = run(mk({ overs: 5 }), [open('A1', 'A2'), bowl('B1'), ball(6), ball(6), { t: 'endInnings' }, open('B1', 'B2'), bowl('A1'), ball(1), ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'bowled' }), ball(0, null, { kind: 'bowled' })]);
  assert.strictEqual(st(m).result.text, 'Alpha won by 11 runs');
});

check('C. tie then super over carries the right teams and scores', () => {
  const six = (r) => [ball(r), ball(0), ball(0), ball(0), ball(0), ball(0)];
  let m = run(mk({ overs: 1, firstBat: 1 }), [open('B1', 'B2'), bowl('A1'), ...six(3), open('A1', 'A2'), bowl('B1'), ...six(3)]);
  let s = st(m);
  assert.strictEqual(s.innings[0].bat, 1);
  assert.strictEqual(s.innings[1].bat, 0);
  assert.strictEqual(s.cur.bat, 0); // the second-innings team opens the super over
  m = run(m, [open('A1', 'A2'), bowl('B1'), ...six(5), open('B1', 'B2'), bowl('A1'), ball(4), ball(0), ball(0), ball(0), ball(0), ball(0)]);
  assert.strictEqual(st(m).result.text, 'Alpha won the super over');
});

check('D. undo into the first innings after a wicket and an over change', () => {
  let m = run(mk({ overs: 2 }), [
    open('A1', 'A2'), bowl('B1'), ball(0, null, { kind: 'bowled' }), ball(1), ball(0), ball(0), ball(0), ball(0),
    bowl('B2'), ball(2), ball(0), ball(0), ball(0), ball(0), ball(0)
  ]);
  assert.strictEqual(st(m).innings.length, 2);
  m = C.undo(m);
  const s = st(m);
  assert.strictEqual(s.innings.length, 1);
  assert.strictEqual(s.cur.legal, 11);
  assert.strictEqual(s.cur.runs, 3);
  assert.strictEqual(s.cur.wkts, 1);
  assert.strictEqual(s.cur.bowlers.B2.legal, 5);
});


console.log('\nPlayer list, shots and stats');

check('E. zones depend on batting hand', () => {
  assert.strictEqual(C.zoneOf(10, 'R'), 'Long off');
  assert.strictEqual(C.zoneOf(60, 'R'), 'Cover');
  assert.strictEqual(C.zoneOf(100, 'R'), 'Point');
  assert.strictEqual(C.zoneOf(170, 'R'), 'Third man');
  assert.strictEqual(C.zoneOf(-10, 'R'), 'Long on');
  assert.strictEqual(C.zoneOf(-60, 'R'), 'Mid wicket');
  assert.strictEqual(C.zoneOf(-100, 'R'), 'Square leg');
  assert.strictEqual(C.zoneOf(-170, 'R'), 'Fine leg');
  assert.strictEqual(C.zoneOf(60, 'L'), 'Mid wicket'); // mirrored for a left-hander
  assert.strictEqual(C.zoneOf(-100, 'L'), 'Point');
  assert.strictEqual(C.zoneOf(-180, 'R'), 'Third man');
});

check('F. shots are kept on scoring balls only', () => {
  const sh = (a, r) => ({ a, r });
  let m = run(start({ overs: 5 }), [
    Object.assign(ball(4), { shot: sh(60, 1) }),
    Object.assign(ball(0), { shot: sh(10, .5) }),          // dot ball: ignored
    Object.assign(ball(2, 'b'), { shot: sh(10, .5) }),      // bye: ignored
    Object.assign(ball(1, 'nb'), { shot: sh(-100, .6) }),   // no-ball with bat runs: kept
    Object.assign(ball(1), { shot: { a: 'x', r: 1 } })      // junk: ignored
  ]);
  const balls = st(m).cur.balls;
  assert.deepStrictEqual(balls[0].shot, { a: 60, r: 1 });
  assert.strictEqual(balls[1].shot, null);
  assert.strictEqual(balls[2].shot, null);
  assert.deepStrictEqual(balls[3].shot, { a: -100, r: .6 });
  assert.strictEqual(balls[4].shot, null);
  // shot survives an edit of the runs and is dropped when runs become 0
  m = C.editBall(m, balls[0].idx, { runs: 6 });
  assert.deepStrictEqual(st(m).cur.balls[0].shot, { a: 60, r: 1 });
  m = C.editBall(m, balls[0].idx, { runs: 0 });
  assert.strictEqual(st(m).cur.balls[0].shot, null);
  // match metadata (id, date) survives apply / undo / edit
  let tagged = Object.assign(start(), { id: 'abc', date: 'd' });
  tagged = C.apply(tagged, ball(1));
  assert.strictEqual(tagged.id, 'abc');
  assert.strictEqual(C.undo(tagged).id, 'abc');
  assert.strictEqual(C.setExtraRun(tagged, false).date, 'd');
});

check('G. innings stats: zones, overs, wickets, dots', () => {
  const m = run(start({ overs: 3, hands: { A1: 'L' } }), [
    Object.assign(ball(4), { shot: { a: 60, r: 1 } }),         // A1 is left-handed: Mid wicket
    ball(0),
    Object.assign(ball(1), { shot: { a: -100, r: .4 } }),      // still A1, left-handed, so the mirror of Square leg is Point
    ball(0, null, { kind: 'bowled' }),
    ball(0, 'wd'),
    ball(6, null, null),
  ]);
  const inn = st(m).cur;
  const s = C.inningsStats(inn, st(m).cfg);
  assert.strictEqual(s.zones['Mid wicket'], 4);
  assert.strictEqual(s.zones['Point'], 1);
  assert.strictEqual(s.fours, 1);
  assert.strictEqual(s.sixes, 1);
  assert.strictEqual(s.boundaryRuns, 10);
  assert.strictEqual(s.legalBalls, 5);
  assert.strictEqual(s.dots, 2);
  assert.strictEqual(s.overs.length, 1);
  assert.strictEqual(s.overs[0].runs, inn.runs);
  assert.strictEqual(s.overs[0].wkts, 1);
  assert.strictEqual(s.fow.length, 1);
  assert.deepStrictEqual([s.fow[0].n, s.fow[0].runs, s.fow[0].out, s.fow[0].over], [1, 5, 'A2', '0.4']);
  assert.strictEqual(s.shots.length, 2);
});

check('H. career stats add up across matches', () => {
  const play = (aWins) => {
    // Alpha bat first: A1 makes 6 (a four and two singles), then Bravo chase
    let m = run(mk({ overs: 1, hands: { A1: 'R' } }), [open('A1', 'A2'), bowl('B1'),
      Object.assign(ball(4), { shot: { a: 30, r: 1 } }), ball(1), ball(1), ball(0), ball(0), ball(0)]);
    m = run(m, [open('B1', 'B2'), bowl('A1')].concat(aWins ? [ball(0), ball(0), ball(0), ball(0), ball(0), ball(0)] : [ball(6), ball(1)]));
    return m;
  };
  let m1 = play(true), m2 = play(false);
  assert.strictEqual(st(m1).finished, true);
  m1 = C.apply(m1, { t: 'potm', team: 0, name: 'A1' });
  const cs = C.careerStats([m1, m2], ['A1', 'A2', 'B1', 'B2']);
  assert.strictEqual(cs.A1.matches, 2);
  assert.strictEqual(cs.A1.wins, 1);
  assert.strictEqual(cs.A1.potm, 1);
  assert.strictEqual(cs.A1.bat.runs, 5 + 5);       // 4 + 1 each time (A2 had the second single)
  assert.strictEqual(cs.A1.bat.fours, 2);
  assert.strictEqual(cs.A1.bat.inns, 2);
  assert.strictEqual(cs.A1.bat.hs, 5);
  assert.strictEqual(cs.A1.bat.shots.length, 2);
  assert.strictEqual(cs.A1.bat.zones['Long off'], 8);
  assert.strictEqual(cs.B1.matches, 2);
  assert.strictEqual(cs.B1.wins, 1);
  assert.strictEqual(cs.B1.bowl.runs, 12);           // 6 conceded each time he bowled
  assert.strictEqual(cs.B1.bowl.legal, 12);
  assert.strictEqual(cs.A3, undefined);              // only listed names are tracked
  // unfinished matches and super overs do not count
  const open1 = start({ overs: 5 });
  assert.deepStrictEqual(Object.keys(C.careerStats([open1], ['A1'])), []);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
