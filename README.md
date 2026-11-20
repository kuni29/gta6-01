# Neon Coast Heat — an original open-world crime game for the browser

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/kuni29/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/kuni29/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A make.fun bounty entry for [gta6-01](https://make.fun/bounty/gta6-01).

An original open-world crime game that plays offline in a desktop browser from static files: a coastal city to explore on foot and by car, traffic and pedestrians, car theft, a wanted system with police chases, a short story mission chain, combat, a HUD with minimap, a start screen and save/load. Every name, place, character and line of story is original to this entry; no third-party game assets are used.

## Run it

Serve `game/` with any static file server and open `index.html` (for example `node serve.ts` from this repo, or `npx serve game`). No network requests are made at runtime.

## The game

You are **Rico Vega**, a wheelman down to his last twenty bucks in **Port Solano**, a sun-bleached coastal city of palms, marinas and bad decisions. Fixer **Marisol "Sol" Reyes** has work for a driver who doesn't ask questions.

- **Open city** — a 9×9-block coastal grid with downtown towers, a park, beaches, a marina and docks; explore on foot or behind the wheel.
- **Traffic & crowds** — AI traffic drives the grid and honks back; pedestrians stroll, flee and dive out of the way.
- **Any car is yours** — walk up and press E to steal anything, including PSPD interceptors (theft is a crime, if witnessed).
- **Wanted system** — crimes raise heat across 5 stars; police intercept, ram and, from 3 stars, shoot, their lightbars strobing red/blue (each car on its own phase) the whole time. Get caught and you're **BUSTED** (fined at the station); get killed and you're **WASTED** (hospital fee). Heat decays when you lie low — faster than it used to.
- **Story chain** — four jobs from Sol (First Wheels → Hot Package → Beach Run → The Big Score) with markers, timers, fail states and payouts, then repeatable side deliveries.
- **Hidden packages** — 12 gold caches stashed at the city's landmarks (marina, docks, bank, park, downtown intersections…). Each pays $75 on pickup and respawns a while later, the HUD counter and minimap diamonds track the set, and finding all 12 pays a completion bonus.
- **Combat** — fists (F) and a pistol (Space / click) with tracers, muzzle flash and hit reactions.
- **Full HUD** — cash, wanted stars, health, a hidden-package counter, objective banner with timer, prompts, toasts, speedometer and a live circular minimap (objective, police, traffic and package blips, with a north marker).
- **Sound** — fully synthesized WebAudio: engine, horns, two-tone sirens, gunfire, impacts, pickups and jingles. M mutes.
- **Save/load** — cash and story progress persist in localStorage; Continue from the title screen.
- **Performance** — the whole skyline is one merged, atlas-textured mesh; physics sub-steps keep game speed real-time, and an adaptive quality path (plus a software-renderer mode) keeps it playable on weak machines.

## Controls

WASD move / drive · E enter car / take job · Shift run · Space / click shoot · F punch · H horn · P / Esc pause · M mute

## Layout

- `game/` — the playable game (static files)
- `screenshots/` — 4 screenshots from the running game
- `main.ts` — hands the game + screenshots to the make.fun scorer as a dossier
