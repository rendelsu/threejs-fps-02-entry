# DUSTFALL — Kestrel Yard

A round-based tactical FPS in three.js: Kestrels vs Wardens on an original
dusk freight yard. First to 5 rounds wins. Plant the charge on Crane Bay or
Silo Row, or eliminate the other team.

## How to play

Serve `game/` with any static server (`node serve.ts`, then open
http://localhost:8080) and click to play. No network needed.

- **WASD** move, **mouse** look, **click** fire, **R** reload
- **1–4** switch weapon, **5** throw frag, **6** throw smoke, **E** plant
  (hold, inside a site), **Ctrl** crouch, **Space** jump, **right-click**
  zoom with the DMR
- **Buy phase** (15 s before each round): spend your money on the VK-7
  carbine, Hornet SMG, Longbow DMR, grenades and a plate vest. Kills pay
  $300, a round win $3,250, a loss $1,900 and growing.

## The game

- 4v4 against bots with a four-state AI: patrol routes, alert on sound,
  engage with burst fire and strafing, hunt the last known position.
  Defenders hold the sites; attackers push three lanes to plant.
- Gunplay: hitscan with headshots, recoil and spread that punish firing on
  the move, crouch to steady your aim, movement with acceleration and
  collision against the map.
- Fixed 60 Hz simulation kept apart from rendering, one state object, no
  allocation in the hot loop (pooled tracers, scratch vectors).
- Sounds are synthesised with WebAudio — no audio files.

## Files

- `game/` — the game: `index.html` plus `src/` modules (one job each)
- `main.ts` — copies `game/` and `screenshots/` to `/output` and writes
  `dossier.json` with the vendored make.fun library
- `screenshots/` — real renders of the game in a browser

Built for the make.fun three.js tactical FPS bounty.

---

Referral: https://make.fun/r/rkkz4bh8
