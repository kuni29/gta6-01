// shots.js — the four screenshot scenes behind ?shot=start|drive|chase|mission. Each one
// stages the real game world (same city, traffic and crowds, stepped forward so everything
// is mid-motion), poses the player, police and HUD for that scene, paints twice and sets
// window.__shotReady. The scenes are the game's own systems, never a mock-up.

import { syncCarMesh } from './vehicles.js';

function finish(api) {
  let painted = 0;
  function paint() {
    api.renderer.render(api.scene, api.camera);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function hideTitleShowHud(api) {
  document.getElementById('title-screen').classList.remove('on');
  api.hud.show(true);
}

function runAmbient(api, seconds) {
  const steps = Math.floor(seconds * 60);
  for (let i = 0; i < steps; i += 1) api.stepAmbient(1 / 60);
}

function chaseCamera(api, focus, heading, dist = 13, height = 5.2) {
  api.camera.position.set(
    focus.x - Math.sin(heading) * dist,
    height,
    focus.z - Math.cos(heading) * dist,
  );
  api.camera.lookAt(focus.x + Math.sin(heading) * 7, 1.6, focus.z + Math.cos(heading) * 7);
}

const SCENES = {
  /** The title screen over the living city, seen from the beach side at golden hour. */
  start(api) {
    runAmbient(api, 2.5);
    // Round 2: lower and closer than round 1's high survey shot — the skyline looms
    // over the title instead of shrinking under it, and the sun glow sits in frame.
    api.camera.position.set(58, 15, 166);
    api.camera.lookAt(-20, 12, 0);
    finish(api);
  },

  /** Driving in traffic: Rico's coupe mid-avenue, other cars ahead and passing. */
  drive(api) {
    hideTitleShowHud(api);
    runAmbient(api, 3);
    // On the avenue at x=-22 (lane -18.8), heading +z: buildings flank, road runs ahead.
    const car = api.game.spawnCarAt('coupe', 0xd94f3d, -18.8, 38, 0);
    car.speed = 19;
    api.game.spawnCarAt('sedan', 0x3d7bd9, -18.8, 74, 0); // same lane, ahead
    api.game.spawnCarAt('buggy', 0x39b0a5, -25.2, 58, Math.PI); // oncoming lane
    api.game.spawnCarAt('sedan', 0x5a6a7a, -18.8, 13, 0); // same lane, trailing behind
    api.player.mesh.visible = false;
    api.player.x = car.x; api.player.z = car.z;
    chaseCamera(api, car, 0, 11, 4.3); // lower and tighter than round 1: speed reads better
    api.hud.setCash(170);
    api.hud.setStars(0);
    api.hud.setHealth(100);
    api.hud.setSpeed(38, car.name);
    api.hud.setObjective({ title: 'JOB 1 — FIRST WHEELS', text: "Take Sol's coupe to the docks", timer: 0 });
    api.hud.drawMinimap({ player: { x: car.x, z: car.z, heading: 0 }, city: api.city, traffic: api.cars, police: [], target: api.placePosition('docks'), time: 2 });
    finish(api);
  },

  /** A police chase: three stars, two cruisers flanking Rico's tail inside the frame. */
  chase(api) {
    hideTitleShowHud(api);
    runAmbient(api, 1.2);
    // On the avenue at x=22, hero heading -z (pi). Camera rides 13 behind the hero, so the
    // two pursuit cars sit 8-11 behind him, offset to each side — inside the frame.
    const car = api.game.spawnCarAt('sedan', 0x3d7bd9, 25.2, 10, Math.PI);
    car.speed = 26;
    api.player.mesh.visible = false;
    api.player.x = car.x; api.player.z = car.z;
    api.wanted.heat = 300;
    const p1 = api.game.spawnCarAt('police', 0xf2f2f2, 22.1, 16.2, Math.PI);
    const p2 = api.game.spawnCarAt('police', 0xf2f2f2, 28.4, 17.2, Math.PI * 0.97);
    const p3 = api.game.spawnCarAt('police', 0xf2f2f2, 21.5, -13, Math.PI * 0.95); // cutting in ahead, in frame
    for (const p of [p1, p2, p3]) { p.driver = 'police'; p.speed = 23; api.police.push(p); }
    // Freeze the new strobes mid-alternation — p1 and p3 caught on red, p2 on blue —
    // so the still shows the flash the old bobbing lightbar never could.
    for (const [p, t] of [[p1, 0.05], [p2, 0.2], [p3, 0.05]]) { p.strobeSeed = 0; syncCarMesh(p, t); }
    chaseCamera(api, car, Math.PI, 14, 5.9);
    api.hud.setCash(470);
    api.hud.setStars(3);
    api.hud.setHealth(72);
    api.hud.setSpeed(57, car.name);
    api.hud.setObjective({ title: 'HOT PACKAGE', text: 'Deliver to Marina Verde — lose them or outrun them', timer: 96 });
    api.hud.drawMinimap({ player: { x: car.x, z: car.z, heading: Math.PI }, city: api.city, traffic: api.cars, police: api.police, target: api.placePosition('marina'), time: 3 });
    finish(api);
  },

  /** A mission moment: the marked gold coupe waits at Marina Verde, beacon up, Rico on foot. */
  mission(api) {
    hideTitleShowHud(api);
    const m = api.placePosition('marina');
    // Restaged on the marina road: round 1 sat the coupe on open sand and the frame was
    // half empty beach. Now the coupe waits in the eastbound lane (road centre is
    // m.z - 22, lanes ±3.2), Rico stands at the kerb a few steps short of it, and the
    // eastern skyline fills the background behind the beacon.
    const car = api.game.spawnCarAt('coupe', 0xf2b13d, m.x + 16, m.z - 25.2, Math.PI / 2);
    api.game.spawnCarAt('sedan', 0x5a6a7a, m.x - 40, m.z - 18.8, -Math.PI / 2); // westbound lane, far down the road
    api.player.x = m.x + 6; api.player.z = m.z - 28.5;
    api.player.heading = Math.PI / 2;
    api.player.mesh.position.set(api.player.x, 0, api.player.z);
    api.player.mesh.rotation.y = api.player.heading;
    api.beacon.group.visible = true;
    api.beacon.group.position.set(car.x, 0, car.z);
    runAmbient(api, 2);
    // The camera stands mid-road east of the action (asphalt is guaranteed clear of
    // buildings — the first staging put it inside a marina block and filled the left
    // of the frame with a wall) and looks west: Rico, the coupe and the beacon in
    // frame, the sunset glow behind them.
    api.camera.position.set(m.x + 24, 4.6, m.z - 20);
    api.camera.lookAt(m.x + 12, 1.3, m.z - 25.4);
    api.hud.setCash(20);
    api.hud.setStars(0);
    api.hud.setHealth(100);
    api.hud.setObjective({ title: 'FIRST WHEELS', text: 'Get in the marked coupe', timer: 0 });
    api.hud.setPrompt('Press <b>E</b> — get in the Solano Coupe');
    api.hud.drawMinimap({ player: api.player, city: api.city, traffic: api.cars, police: [], target: { x: car.x, z: car.z }, time: 2 });
    finish(api);
  },
};

/** Stage the named scene (any unknown name is the start scene). */
export function stageShot(name, api) {
  const scene = SCENES[name] || SCENES.start;
  scene(api);
}
