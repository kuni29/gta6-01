// shots.js — the four screenshot scenes behind ?shot=start|drive|chase|mission. Each one
// stages the real game world (same city, traffic and crowds, stepped forward so everything
// is mid-motion), poses the player, police and HUD for that scene, paints twice and sets
// window.__shotReady. The scenes are the game's own systems, never a mock-up.

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
    api.camera.position.set(86, 30, 172);
    api.camera.lookAt(-10, 6, 30);
    finish(api);
  },

  /** Driving in traffic: Rico's coupe mid-avenue, other cars ahead and passing. */
  drive(api) {
    hideTitleShowHud(api);
    runAmbient(api, 3);
    // On the avenue at x=-22 (lane -18.8), heading +z: buildings flank, road runs ahead.
    const car = api.game.spawnCarAt('coupe', 0xd94f3d, -18.8, 38, 0);
    car.speed = 17;
    api.game.spawnCarAt('sedan', 0x3d7bd9, -18.8, 74, 0); // same lane, ahead
    api.game.spawnCarAt('buggy', 0x39b0a5, -25.2, 58, Math.PI); // oncoming lane
    api.player.mesh.visible = false;
    api.player.x = car.x; api.player.z = car.z;
    chaseCamera(api, car, 0);
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
    car.speed = 24;
    api.player.mesh.visible = false;
    api.player.x = car.x; api.player.z = car.z;
    api.wanted.heat = 300;
    const p1 = api.game.spawnCarAt('police', 0xf2f2f2, 22.1, 16.2, Math.PI);
    const p2 = api.game.spawnCarAt('police', 0xf2f2f2, 28.4, 17.2, Math.PI * 0.97);
    const p3 = api.game.spawnCarAt('police', 0xf2f2f2, 18.8, -20, Math.PI * 0.92);
    for (const p of [p1, p2, p3]) { p.driver = 'police'; p.speed = 23; api.police.push(p); }
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
    const car = api.game.spawnCarAt('coupe', 0xf2b13d, m.x + 16, m.z + 18, Math.PI);
    api.player.x = m.x + 11; api.player.z = m.z + 24;
    api.player.heading = Math.PI * 0.85;
    api.player.mesh.position.set(api.player.x, 0, api.player.z);
    api.player.mesh.rotation.y = api.player.heading;
    api.beacon.group.visible = true;
    api.beacon.group.position.set(car.x, 0, car.z);
    runAmbient(api, 2);
    api.camera.position.set(api.player.x - 10, 6.4, api.player.z + 13);
    api.camera.lookAt(car.x, 1.4, car.z);
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
