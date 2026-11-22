// scene.js — everything three.js draws for the static world: the sunset sky dome, the sun
// and lights, the ground (one big canvas texture painting roads, sidewalks, the park and
// the beach), window-textured buildings, palms and dock crates. Dynamic things (cars,
// people, markers) live in their own modules; this file only builds the set they play on.

import { CITY } from './config.js';

/** Shared geometries and materials, created once by buildScene and reused by every mesh. */
export const Shared = {
  box: null,
  mats: {},
  buildingSides: [],
  buildingRoof: null,
};

/**
 * The facade atlas: four window-pattern tiles on one canvas, drawn light so each
 * building's pastel colour can tint them through vertex colours. A white strip along
 * the bottom is where roof faces point, so roofs take their own vertex colour pure.
 * Tiles in UV space (canvas is flipY): tile v occupies x [v%2 * .5, +0.5], y as below.
 */
const TILE_H = 496 / 1024;
function facadeAtlas(rng) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 1024;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 1024);
  for (let v = 0; v < 4; v += 1) {
    const ox = (v % 2) * 512;
    const oy = Math.floor(v / 2) * 496;
    g.fillStyle = '#e7dfd0'; g.fillRect(ox, oy, 512, 496);
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(ox, oy + 478, 512, 18);
    const cols = 5 + v; const rows = 8 + v;
    const ww = 512 / cols; const hh = 496 / rows;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const lit = rng.next() < 0.3;
        g.fillStyle = lit ? '#ffd98a' : (rng.next() < 0.5 ? '#8fb0c2' : '#7498ab');
        g.fillRect(ox + x * ww + 6, oy + y * hh + 7, ww - 12, hh - 14);
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillRect(ox + x * ww + 6, oy + y * hh + 7, ww - 12, 4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

/** UV rect of atlas tile v: {u0, v0, u1, v1} with v measured from the bottom (flipY). */
function tileRect(v) {
  const u0 = (v % 2) * 0.5;
  const vTop = 1 - Math.floor(v / 2) * TILE_H;
  return { u0, u1: u0 + 0.5, v0: vTop - TILE_H, v1: vTop };
}

/** Paint the whole city floor onto one 1024px canvas: lots, roads, markings, beach, sea edge. */
function groundTexture(city) {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const half = city.size / 2;
  const px = (w) => (w + half) / city.size * S;       // world -> canvas
  const pw = (w) => w / city.size * S;                // world width -> canvas width
  // Base: sun-baked pavement under everything.
  g.fillStyle = '#9aa0a3'; g.fillRect(0, 0, S, S);
  // Beach: the strip south of the last road is sand, then a foam line.
  const beachZ = half - CITY.cell / 2 + CITY.roadWidth / 2;
  g.fillStyle = '#ecd29a';
  g.fillRect(0, px(beachZ), S, S - px(beachZ));
  g.fillStyle = '#f7ecd0';
  g.fillRect(0, px(half + 2), S, 7);
  // Park block: grass.
  g.fillStyle = '#69a854';
  g.fillRect(px(city.park.x - 20), px(city.park.z - 20), pw(40), pw(40));
  // Building lots: pale concrete pads.
  g.fillStyle = '#c9c2b4';
  const lot = CITY.cell - CITY.roadWidth;
  for (let bz = 0; bz < CITY.blocksPerSide; bz += 1) {
    for (let bx = 0; bx < CITY.blocksPerSide; bx += 1) {
      const cx = (bx - 4) * CITY.cell; const cz = (bz - 4) * CITY.cell;
      g.fillRect(px(cx - lot / 2 - 2), px(cz - lot / 2 - 2), pw(lot + 4), pw(lot + 4));
    }
  }
  // Roads: asphalt bands along every centre-line, with dashes and crosswalks.
  g.fillStyle = '#3c4147';
  for (const line of city.roads) {
    g.fillRect(px(line - CITY.roadWidth / 2), 0, pw(CITY.roadWidth), S);
    g.fillRect(0, px(line - CITY.roadWidth / 2), S, pw(CITY.roadWidth));
  }
  g.strokeStyle = '#e8e4da';
  g.lineWidth = 2.4;
  g.setLineDash([16, 14]);
  for (const line of city.roads) {
    g.beginPath(); g.moveTo(px(line), 0); g.lineTo(px(line), S); g.stroke();
    g.beginPath(); g.moveTo(0, px(line)); g.lineTo(S, px(line)); g.stroke();
  }
  g.setLineDash([]);
  // Crosswalk stripes at each intersection corner.
  g.fillStyle = 'rgba(240,238,230,0.75)';
  for (const vx of city.roads) {
    for (const hz of city.roads) {
      for (let s = -3; s <= 3; s += 1) {
        g.fillRect(px(vx - CITY.roadWidth / 2 + 1 + (s + 3) * 1.8), px(hz - CITY.roadWidth / 2 - 3.4), 4.5, 5);
        g.fillRect(px(vx - CITY.roadWidth / 2 - 3.4), px(hz - CITY.roadWidth / 2 + 1 + (s + 3) * 1.8), 5, 4.5);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

/** Merge already-transformed geometries into one (palms, buildings: a handful of meshes). */
export function mergeGeos(items) {
  // items: {geo, matrix} — geo is cloned, transformed, and concatenated (non-indexed).
  // A per-item `color` attribute is carried through when present (white when absent).
  let total = 0;
  const geos = items.map(({ geo, matrix }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) g.applyMatrix4(matrix);
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let off = 0; let off2 = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, off2 * 2);
    if (g.attributes.color) col.set(g.attributes.color.array, off * 3);
    else col.fill(1, off * 3, (off + n) * 3);
    off += n;
    off2 += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Merge translated, coloured box parts into one geometry (for cars and people). */
export function mergeParts(parts) {
  // parts: {w,h,d, x,y,z, color, ry?} — returns a BufferGeometry with vertex colours.
  let total = 0;
  const geos = parts.map((p) => {
    const geo = new THREE.BoxGeometry(p.w, p.h, p.d).toNonIndexed();
    const m = new THREE.Matrix4().makeRotationY(p.ry || 0);
    m.setPosition(p.x, p.y, p.z);
    geo.applyMatrix4(m);
    const count = geo.attributes.position.count;
    total += count;
    const col = new THREE.Color(p.color);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let off = 0;
  for (const geo of geos) {
    pos.set(geo.attributes.position.array, off * 3);
    nor.set(geo.attributes.normal.array, off * 3);
    col.set(geo.attributes.color.array, off * 3);
    off += geo.attributes.position.count;
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** The shared vertex-colour material every merged mesh uses. */
export function partMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/**
 * Build the static world into `scene`: sky, lights, ground, water, buildings, palms,
 * crates. Returns handles the game loop animates (water, sun sprite).
 */
export function buildScene(scene, city, rng) {
  // Sky: a big gradient dome, warm at the horizon, blue up top — golden hour forever.
  const skyGeo = new THREE.SphereGeometry(900, 16, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // The grade: a warm gradient, a hot glow around the sun's azimuth (it sits low over
    // the north-west, where buildScene's directional light lives), and a magenta neon
    // band hugging the horizon — the two-tone sunset the title art promises.
    fragmentShader: 'varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y; vec3 top = vec3(0.33, 0.53, 0.82); vec3 mid = vec3(0.99, 0.71, 0.44); vec3 low = vec3(1.0, 0.47, 0.4); vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(low, mid, smoothstep(-0.08, 0.12, h)); vec3 sunDir = normalize(vec3(-0.53, 0.6, -0.34)); float sunAmt = pow(max(dot(d, sunDir), 0.0), 16.0); c += vec3(1.0, 0.6, 0.28) * sunAmt * 0.55; float horizon = pow(1.0 - abs(h), 6.0); c += vec3(0.42, 0.08, 0.3) * horizon * 0.38; gl_FragColor = vec4(c, 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xeeb287, 120, 620);

  const hemi = new THREE.HemisphereLight(0xbdd8ff, 0x9a7050, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdfae, 1.25);
  sun.position.set(-140, 190, -90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -105; sun.shadow.camera.right = 105;
  sun.shadow.camera.top = 105; sun.shadow.camera.bottom = -105;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  // Ground and sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(city.size, city.size),
    new THREE.MeshLambertMaterial({ map: groundTexture(city) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 420),
    // A whisper of emissive so the water holds a sunset sheen even in shadow.
    new THREE.MeshLambertMaterial({ color: 0x2e7fa8, emissive: 0x0a2e3d, transparent: true, opacity: 0.94 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.35, city.size / 2 + 208);
  scene.add(sea);
  const sea2 = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 420),
    new THREE.MeshLambertMaterial({ color: 0x49a3c4, transparent: true, opacity: 0.35 }),
  );
  sea2.rotation.x = -Math.PI / 2;
  sea2.position.set(0, -0.15, city.size / 2 + 190);
  scene.add(sea2);

  // Buildings: EVERY building merged into one mesh — side faces sample the facade atlas
  // (tinted by the building's pastel colour), top/bottom faces sample the atlas's white
  // strip (tinted by the roof colour). One material, one draw call for the whole skyline.
  Shared.box = new THREE.BoxGeometry(1, 1, 1);
  const atlas = facadeAtlas(rng);
  const buildingGeos = [];
  const clutterParts = [];
  for (const b of city.buildings) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
    const rect = tileRect(b.tex);
    const uvAttr = geo.attributes.uv;
    const colAttr = new Float32Array(uvAttr.count * 3);
    const facade = new THREE.Color(b.color);
    const roof = new THREE.Color(b.roof);
    const vScale = Math.min(1, b.h / 26);
    for (let i = 0; i < uvAttr.count; i += 1) {
      const face = Math.floor(i / 6); // 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z
      if (face === 2 || face === 3) {
        uvAttr.setXY(i, 0.5, 0.008); // the atlas's white strip
        colAttr.set([roof.r, roof.g, roof.b], i * 3);
      } else {
        uvAttr.setXY(i,
          rect.u0 + uvAttr.getX(i) * (rect.u1 - rect.u0),
          rect.v0 + uvAttr.getY(i) * vScale * (rect.v1 - rect.v0));
        colAttr.set([facade.r, facade.g, facade.b], i * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colAttr, 3));
    const m = new THREE.Matrix4().makeTranslation(b.x, b.h / 2, b.z);
    buildingGeos.push({ geo, matrix: m });
    // Rooftop clutter on taller blocks: a water tank or AC box silhouette (merged later).
    if (b.h > 15 && rng.next() < 0.6) {
      clutterParts.push({
        w: b.w * 0.22, h: 1.6, d: b.d * 0.22,
        x: b.x + (rng.next() - 0.5) * b.w * 0.4, y: b.h + 0.8, z: b.z + (rng.next() - 0.5) * b.d * 0.4,
        color: b.roof,
      });
    }
  }
  const buildingsMesh = new THREE.Mesh(
    mergeGeos(buildingGeos),
    new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true }),
  );
  buildingsMesh.castShadow = true;
  buildingsMesh.receiveShadow = true;
  scene.add(buildingsMesh);
  if (clutterParts.length) {
    const clutter = new THREE.Mesh(mergeParts(clutterParts), partMaterial());
    clutter.castShadow = true;
    scene.add(clutter);
  }

  // Palms: one tilted cylinder trunk and a flattened frond cone each, but merged into just
  // two meshes for the whole city — they never move, so they never needed to be separate.
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.6, 6);
  const frondGeo = new THREE.ConeGeometry(2.6, 1.5, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
  const trunks = [];
  const fronds = [];
  const M = () => new THREE.Matrix4();
  for (const p of city.palms) {
    const rot = rng.next() * 6.28;
    // world = translate(palm) · rotY · scale(s) · child transform
    const base = M().makeRotationY(rot).premultiply(M().makeTranslation(p.x, 0, p.z));
    const scaled = M().makeScale(p.s, p.s, p.s).premultiply(base);
    const trunkM = M().makeRotationZ(0.09).premultiply(M().makeTranslation(0, 2.8, 0)).premultiply(scaled);
    trunks.push({ geo: trunkGeo, matrix: trunkM });
    const frondM = M().makeScale(1, 0.75, 1).premultiply(M().makeTranslation(0.5, 5.9, 0)).premultiply(scaled);
    fronds.push({ geo: frondGeo, matrix: frondM });
  }
  const trunkMesh = new THREE.Mesh(mergeGeos(trunks), trunkMat);
  trunkMesh.castShadow = true;
  scene.add(trunkMesh);
  const frondMesh = new THREE.Mesh(mergeGeos(fronds), frondMat);
  frondMesh.castShadow = true;
  scene.add(frondMesh);

  // Dock crates.
  const crateMat = new THREE.MeshLambertMaterial({ color: 0xa4713d });
  const crateMat2 = new THREE.MeshLambertMaterial({ color: 0x5f7d8c });
  city.crates.forEach((c, i) => {
    const m = new THREE.Mesh(Shared.box, i % 2 ? crateMat : crateMat2);
    m.scale.set(2.4, 2.4, 2.4);
    m.position.set(c.x, 1.2, c.z);
    m.rotation.y = c.r;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    city.colliders.push({ minX: c.x - 1.3, maxX: c.x + 1.3, minZ: c.z - 1.3, maxZ: c.z + 1.3, h: 2.4 });
  });

  // Beach umbrellas on the open sand south of the last road: a cone canopy on a
  // thin pole, one per open beach lot, so the beach reads as a place, not a void.
  const umbrellaColors = [0xff6b6b, 0xffd94d, 0x4ecdc4];
  const umbrellaPoleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 5);
  const umbrellaTopGeo = new THREE.ConeGeometry(1.9, 0.8, 8);
  const umbrellaPoleMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  for (let i = 0; i < 3; i += 1) {
    const ux = -132 + i * 132;
    const uz = 190 + (i % 2) * 3;
    const canopy = new THREE.Mesh(umbrellaTopGeo, new THREE.MeshLambertMaterial({ color: umbrellaColors[i] }));
    canopy.position.set(ux, 2.6, uz);
    canopy.castShadow = true;
    scene.add(canopy);
    const pole = new THREE.Mesh(umbrellaPoleGeo, umbrellaPoleMat);
    pole.position.set(ux, 1.2, uz);
    scene.add(pole);
  }

  return { sun, sea, sea2 };
}

/** A glowing mission beacon: translucent pillar + ground ring, gently pulsing. */
export function makeBeacon(color) {
  const group = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 26, 18, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.position.y = 13;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 3.4, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  // A soft pool of light on the ground inside the ring: it grounds the beacon in the
  // world (and in screenshots) instead of leaving it floating as pure UI.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.1;
  group.add(pillar); group.add(ring); group.add(pool);
  group.visible = false;
  return { group, pillar, ring, pool };
}
