# Gully Scorer

A cricket scorer for gully matches. Plain HTML, CSS and JavaScript. No install, no build step, no server.

## Run it
Easiest: open `gully-scorer-single.html`. It is the whole app in one file and works on its own.

To work with the separate files:
1. Put `index.html`, `style.css`, `engine.js` and `app.js` in ONE folder.
2. Double-click `index.html`. It opens in your browser.
   If you see a white page or a "could not start" message, one of those files is missing or in a different folder.
3. To use it on your phone, upload the folder to GitHub Pages or Netlify and open the link.
   (In VS Code, the "Live Server" extension also serves it on your Wi-Fi.)

## The files, and what each one is for
| File | Job |
|---|---|
| `index.html` | The skeleton. An empty box for the app, plus links to the other files. |
| `style.css` | How it looks. Colours are variables, so light and dark mode are just two sets of values. |
| `engine.js` | The cricket rules: runs, strike, wickets, free hit, results, super over, stats. Knows nothing about the screen. |
| `app.js` | The screens and buttons. Reads the state, builds HTML, reacts to taps, saves to the browser. |
| `make-single.js` | Optional. `node make-single.js` rebuilds `gully-scorer-single.html` from the four files above after you edit them. |
| `test.js` | 27 tests for `engine.js`. Run with `node test.js` (needs Node.js). Optional. |

Read them in this order to understand it: `index.html` (30 lines), then `style.css` (top comment and the first two blocks), then `engine.js` (top of the file), then `app.js` (top comment, then `render()`).

## Features
- Players list, each right or left-handed. Pick them into Team A or Team B for every match.
- Scoring with wides, no-balls, byes, free hits, wickets, run outs, undo, edit any past ball, super over on a tie.
- Wagon wheel: tap where each scoring shot went. Zones are named by batting hand.
- Per-match Analysis: wagon wheel, runs by zone, runs per over, boundaries, dot balls, fall of wickets.
- History: every finished match, open any one for its full scorecard and analysis.
- Stats: batting, bowling and wins tables, plus each player's career wagon wheel.
- Theme: Auto (follows your phone), Light or Dark. Tap "Theme" at the top.
- Backup: Players > Backup copies everything as text and can restore it.

## Important rules

### How the app scores
These are the rules built into `engine.js`. Agree on them with your group before the match, because the app will enforce them.

**Extras**
1. A wide or no-ball is not a legal ball. It is re-bowled and does not count toward the over.
2. A wide or no-ball adds 1 run to the total by default. Turn this off in the setup screen, or with the switch on the Score tab. Changing the switch mid-match only affects balls bowled after that.
3. Runs run off a wide or no-ball are added on top. Runs hit off the bat on a no-ball go to the batter. Runs on a wide go to extras.
4. Byes and leg byes are extras. They count as a legal ball and are not charged to the bowler or the batter.
5. A wide is not a ball faced by the batter. A no-ball is.

**Free hit**
6. The ball after a no-ball is a free hit. On a free hit only a run out can get a batter out. Any other dismissal is recorded as "not out".
7. A wide or no-ball bowled on a free hit does not use it up. The free hit carries over to the next legal ball.

**Wickets**
8. On a no-ball, only a run out counts. On a wide, only stumped, hit wicket or run out count. On byes and leg byes, only a run out counts.
9. For a run out you choose which batter is out and how many runs were completed first. A run out is not credited to the bowler.
10. The new batter takes the end where the dismissed batter was.
11. The innings ends when the wickets taken equal the number of players minus one, because a batter needs a partner. With Last man stands on, the last batter carries on alone and the innings ends only when everyone is out. The last man alone never changes strike.

**Strike**
12. Odd runs (1, 3, 5) swap the batters. The batters also swap at the end of every over.
13. Use Swap strike for anything the buttons do not cover, such as a crossed catch.

**Overs and bowlers**
14. Every over needs a bowler. The app asks for one at the start of each over.
15. If you set Max overs a bowler, a bowler who has reached the limit cannot be picked again. (The app does not stop the same bowler bowling two overs in a row.)
16. The innings ends when the overs are used up, everyone is out, or you tap End innings. Undo reopens it.

**Result**
17. The target is the first innings score plus one. The chase ends the moment the target is reached, even in the middle of an over.
18. The team batting first wins by runs. The team chasing wins by wickets, counted as the wickets it still had in hand.
19. A tie goes to a super over: one over each, a maximum of 2 wickets, and the team that batted second bats first. A tied super over is repeated until one team wins.
20. The player of the match is suggested from runs plus 20 for every wicket. You can pick anyone else.

**Undo and edits**
21. Undo takes back the last action, one at a time, and it can go back into the first innings or out of a finished match.
22. Tap any ball to edit it (runs, extra, wicket). Everything after it is replayed. If a later ball would become impossible, the edit is refused.

### How stats are counted
23. Only finished matches count. Undoing a finished match takes it out of History and Stats until it finishes again.
24. Only players on the Players list appear in Stats. Default names such as A1 and B1 are never counted.
25. Super over runs, balls and wickets are left out of career stats.
26. A shot direction is only asked for when the batter scores runs off the bat. Dot balls, byes and wides have no direction.
27. Deleting a match removes its runs and wickets from every player's stats.

### Using the app safely
28. Keep `index.html`, `style.css`, `engine.js` and `app.js` in the same folder. If you open `index.html` alone you get a "could not start" message. `gully-scorer-single.html` needs nothing else.
29. Your players, matches and stats live in the browser on that device. Clearing the browser's site data deletes them, and they do not move to another phone by themselves.
30. Use Players > Backup to copy your data after every few matches. Restore replaces the players and matches on that device, so only paste a backup you made yourself.
31. Do not open the same app in two tabs at once while scoring. Each tab keeps its own copy of the match and the last one to save wins.
32. Run `node test.js` after changing anything in `engine.js`. If a test fails, the scoring rules changed.

## Things worth knowing
- A match is stored as a list of actions (open, bowler, ball, swap, end innings). The engine replays the list to get the score. That is why undo, editing a ball, history and career stats all work: they are replays.
- Data is saved in the browser's localStorage. It stays on that device and browser, and clearing site data deletes it. Use the backup.
- Shot angle: 0 is straight toward the bowler, positive is clockwise. For a right-hander the right side of the screen is the off side. For a left-hander it flips.

## Try changing something
- Change the accent colour: in `style.css` edit `--accent` (light values at the top, dark values in the two dark blocks).
- Change the number of dismissal types: `WICKET_KINDS` in `engine.js`.
- Change the zone names: `OFF_ZONES` and `LEG_ZONES` in `engine.js`.
- Add a stat to the table: `statsView()` in `app.js` and `careerStats()` in `engine.js`.
