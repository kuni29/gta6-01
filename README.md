# Neon Coast Heat

An open-world crime game in the browser, set in **Port Solano** — a sun-bleached
coastal city of palms, marinas, pastel facades and bad decisions. You are
**Rico Vega**, a wheelman down to his last twenty bucks. The fixer
**Marisol "Sol" Reyes** has work for a driver who doesn't ask questions. Run
her jobs, stack cash, and remember: in Port Solano the heat is never just the
weather.

The game is plain static files under `game/` — no build step, no network. Open
`game/index.html` in desktop Chrome and play. Three.js is vendored under
`game/vendor/`; everything else is the game's own code.

## How to play

| Key | Action |
| --- | ------ |
| W A S D | Move on foot / drive |
| Shift | Run |
| E | Enter a car / take a job from Sol |
| Space / Click | Shoot |
| F | Punch |
| H | Horn |
| P / Esc | Pause |
| M | Mute |

Progress saves automatically in the browser. NEW GAME starts fresh; CONTINUE
picks up cash, jobs and hidden packages where you left off.

## The city

Port Solano is a 9×9 block grid, 396 units across, with the ocean along its
south edge. Landmarks anchor the map: Sol's Alley, Port Solano Docks, Marina
Verde, Solano Trust Bank, the Chop Shop Garage, St. Lucia Hospital, the PSPD
Station and Solano Beach, plus Solano Green park downtown. Traffic follows the
road grid from intersection to intersection and brakes for the car ahead;
pedestrians stroll the sidewalk rings, idle, and scatter when a crime goes off
in front of them.

Cars are stealable — walk up to one and press E. Each model drives
differently: the Solano Coupe is quick, the Palmetto Sedan is steady, the Dune
Buggy is loose, the Marina Van is slow, and the PSPD Interceptor (if you dare
steal one) is the fastest thing on the road. Wreck a car and it stays wrecked
until you find another.

## Wanted

Heat is a 0–500 meter; every 100 is one wanted star, up to five. Crimes add
heat — stealing a car, hitting a pedestrian, shooting, punching — and a crime
nobody sees counts for less than one everybody saw. Heat cools over time, and
it cools much faster while no officer has eyes on you, so ducking into an
alley and lying low is a real tactic.

Two pursuit cars arrive per star. At low heat they chase and ram; at higher
heat some cut across your path to intercept you, and from three stars up the
officers shoot from their windows. Get cornered while slow and the bust meter
fills — fill it and you walk out of the PSPD station lighter by a quarter of
your cash. Get hurt instead and you wake up at St. Lucia Hospital with a bill.

## Jobs and story

Sol's jobs form a five-mission story, each one a small graph of steps — drive
somewhere, get in a particular car, grab a package, collect crates, lose the
heat — with timers on the tight ones and a payout at the end:

1. **First Wheels** — take Sol's coupe to the docks. ($150)
2. **Hot Package** — lift a package at the docks, run it to the marina with
   the PSPD on your tail. ($320)
3. **Beach Salvage** — haul three crates off Solano Beach to the chop shop.
   ($420)
4. **The Bank Run** — reach the bank inside ninety seconds, then vanish.
   ($650)
5. **The Big Score** — steal the armored van, hit the bank, run the cash to
   the marina, lose the heat. ($1,200)

Finish the story and Sol keeps dealing side work: fares, courier runs and
lookout posts, rolled fresh from the city's landmarks each time.

Twelve hidden packages are stashed around the city — $75 each, plus a $250
bonus for the full set. A collected stash restocks after a while, so the cash
loop never dries up.

## HUD and sound

The HUD shows cash, wanted stars, health, the package count, a circular
minimap (roads, traffic, flashing police, the job marker and live packages),
the current objective with its countdown, context prompts, toasts and the bust
meter, plus a speedometer when driving. Damage flashes red at the screen
edges.

All sound is synthesised live with the Web Audio API — no audio files. The
engine hums and rises with speed, the siren wails in two tones, and every
shot, crash, pickup and fanfare is an oscillator or a burst of filtered noise
shaped by an envelope. Press M to mute.

## Files

- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to the output
  directory, checks the size caps and writes `dossier.json`.
- `serve.ts` — serves `game/` on http://localhost:8080 for local play.
- `game/index.html` — the page: canvas, HUD DOM, title / pause / end screens.
- `game/src/main.js` — the conductor: state machine, frame loop, camera, save.
- `game/src/city.js` — the city layout: blocks, roads, landmarks, collision.
- `game/src/scene.js` — the three.js world: buildings, sea, sun, the beacon.
- `game/src/vehicles.js` — cars: models, arcade driving, traffic AI.
- `game/src/people.js` — Rico on foot and the pedestrian crowd AI.
- `game/src/police.js` — the wanted system and police pursuit AI.
- `game/src/missions.js` — Sol's jobs as a graph of steps, plus side work.
- `game/src/hud.js` — HUD, minimap, toasts and the damage flash.
- `game/src/audio.js` — the procedural sound bank (Web Audio, no files).
- `game/src/input.js` — keyboard / mouse state, one-shot action flags.
- `game/src/random.js` — the seeded RNG behind the city and the crowds.
- `game/src/shots.js` — the four screenshot scenes (`?shot=…`).
- `game/src/config.js` — every tuning constant in one place.
- `game/vendor/three.min.js` — vendored three.js.
- `screenshots/` — four renders of the game itself (start, drive, chase,
  mission); the first by name is the cover.
- `shots.json` — the screenshot list the staging scenes use.
- `vendor/makefun-game.ts` — the kit's dossier library (unchanged).

## Build and submit

```sh
node serve.ts            # play at http://localhost:8080
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # write out/ + dossier.json
```

`main.ts` needs Node 22.18 or later. It copies `game/` and `screenshots/`,
refuses anything past the caps (game/ at most 993 entries / 48 MiB,
screenshots at most 4 files of 256 KiB each), builds `dossier.json` with the
kit's `buildDossier`, and prints a short summary. Running it twice into two
directories produces byte-identical output.

## License

MIT — see `LICENSE`.
