// hud.js — everything drawn over the game: cash and stars, health, the circular
// minimap, the mission objective banner, context prompts, toasts, the bust meter,
// the speedometer and the damage flash.
//
// The HUD is a thin skin over the DOM ids in index.html: the class looks them up
// once, then every setter only touches the node it owns. The minimap is the one
// canvas the game draws itself, every frame the main loop asks for it — a top-down
// slice of the city with the roads, the player arrow, traffic, police, the job
// marker and the hidden packages, all clipped to its circle.

/** World units shown across the minimap's diameter (the city plus a margin). */
const MAP_SPAN = 440;
/** How long a toast stays fully visible before it starts fading. */
const TOAST_HOLD = 2.0;
/** How long a toast takes to fade out once its hold expires. */
const TOAST_FADE = 0.6;

/** Format a cash amount the way the HUD shows it: $1,250, never $1250. */
function money(n) {
  return `$${Math.floor(n).toLocaleString('en-US')}`;
}

/** Seconds as m:ss for the objective timer. */
function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.cashEl = document.getElementById('cash');
    this.starsEl = document.getElementById('stars');
    this.packagesEl = document.getElementById('packages');
    this.healthFill = document.getElementById('healthfill');
    this.mapCanvas = document.getElementById('minimap');
    this.mapCtx = this.mapCanvas ? this.mapCanvas.getContext('2d') : null;
    this.objectiveEl = document.getElementById('objective');
    this.objTitle = this.objectiveEl ? this.objectiveEl.querySelector('.obj-title') : null;
    this.objText = this.objectiveEl ? this.objectiveEl.querySelector('.obj-text') : null;
    this.objTimer = this.objectiveEl ? this.objectiveEl.querySelector('.obj-timer') : null;
    this.promptEl = document.getElementById('prompt');
    this.toastEl = document.getElementById('toast');
    this.bustedEl = document.getElementById('bustedbar');
    this.bustedFill = document.getElementById('bustedfill');
    this.speedoEl = document.getElementById('speedo');
    this.speedNum = this.speedoEl ? this.speedoEl.querySelector('.num') : null;
    this.carNameEl = document.getElementById('carname');
    this.damageEl = document.getElementById('damageflash');
    this.toastT = 0;
    this.toastDur = 0;
    this.damageT = 0;
    this.lastStars = -1;
    this.lastCash = null;
  }

  /** Show or hide the whole HUD (title screen hides it, play shows it). */
  show(on) {
    if (this.root) this.root.classList.toggle('on', Boolean(on));
  }

  /** Cash readout, top right. */
  setCash(n) {
    if (!this.cashEl) return;
    const text = money(n);
    if (text !== this.lastCash) {
      this.cashEl.textContent = text;
      this.lastCash = text;
    }
  }

  /** Wanted stars: filled gold stars, the rest dimmed outlines. */
  setStars(n) {
    if (!this.starsEl) return;
    const stars = Math.max(0, Math.min(5, Math.floor(n)));
    if (stars === this.lastStars) return;
    this.lastStars = stars;
    let html = '';
    for (let i = 0; i < 5; i += 1) {
      html += i < stars ? '★' : '<span class="off">★</span>';
    }
    this.starsEl.innerHTML = html;
  }

  /** Hidden-package counter under the cash. */
  setPackages(found, total) {
    if (!this.packagesEl) return;
    this.packagesEl.textContent = total > 0 ? `◆ ${found}/${total} PACKAGES` : '';
  }

  /** Health bar fill, 0..100, with a colour shift as it drains. */
  setHealth(n) {
    if (!this.healthFill) return;
    const v = Math.max(0, Math.min(100, n));
    this.healthFill.style.width = `${v}%`;
    this.healthFill.style.background = v > 55
      ? 'linear-gradient(90deg, #ff5964, #ff8c42)'
      : v > 25
        ? 'linear-gradient(90deg, #ff8c42, #ffd94d)'
        : 'linear-gradient(90deg, #d93d3d, #ff5964)';
  }

  /**
   * Speedometer. Pass null to hide it (on foot); a number and the car's name to
   * show it. The name line hides with it.
   */
  setSpeed(mph, carName) {
    if (this.speedoEl) this.speedoEl.style.display = mph === null || mph === undefined ? 'none' : 'block';
    if (this.speedNum && mph !== null && mph !== undefined) {
      this.speedNum.textContent = String(Math.round(mph));
    }
    if (this.carNameEl) {
      this.carNameEl.style.display = mph === null || mph === undefined ? 'none' : 'block';
      if (carName) this.carNameEl.textContent = carName;
    }
  }

  /** Bust meter: null hides it, a 0..1 fraction fills it. */
  setBusted(frac) {
    if (!this.bustedEl || !this.bustedFill) return;
    if (frac === null || frac === undefined) {
      this.bustedEl.style.display = 'none';
      return;
    }
    this.bustedEl.style.display = 'block';
    this.bustedFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  /**
   * Objective banner. Null hides it; an object with title/text/timer shows it,
   * the timer line only while a countdown is running.
   */
  setObjective(obj) {
    if (!this.objectiveEl) return;
    if (!obj) {
      this.objectiveEl.style.display = 'none';
      return;
    }
    this.objectiveEl.style.display = 'block';
    if (this.objTitle) this.objTitle.textContent = obj.title || '';
    if (this.objText) this.objText.textContent = obj.text || '';
    if (this.objTimer) {
      this.objTimer.textContent = obj.timer > 0 ? clock(obj.timer) : '';
    }
  }

  /** Context prompt ("Press E — ...") above the bottom edge; null hides it. */
  setPrompt(html) {
    if (!this.promptEl) return;
    if (!html) {
      this.promptEl.style.display = 'none';
      return;
    }
    this.promptEl.style.display = 'block';
    this.promptEl.innerHTML = html;
  }

  /** Big centre toast with an optional gold sub-line. */
  showToast(title, sub, dur) {
    if (!this.toastEl) return;
    this.toastEl.innerHTML = '';
    const main = document.createElement('div');
    main.textContent = title;
    this.toastEl.appendChild(main);
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      this.toastEl.appendChild(small);
    }
    this.toastEl.style.opacity = '1';
    this.toastDur = (dur || TOAST_HOLD) + TOAST_FADE;
    this.toastT = this.toastDur;
  }

  /** Red edge flash for taking damage; update() fades it out. */
  flashDamage() {
    this.damageT = 1;
    if (this.damageEl) this.damageEl.style.opacity = '0.85';
  }

  /** Per-frame housekeeping: toast fade and damage-flash decay. */
  update(dt) {
    if (this.toastT > 0 && this.toastEl) {
      this.toastT -= dt;
      if (this.toastT <= TOAST_FADE) {
        this.toastEl.style.opacity = String(Math.max(0, this.toastT / TOAST_FADE));
      }
      if (this.toastT <= 0) this.toastEl.style.opacity = '0';
    }
    if (this.damageT > 0 && this.damageEl) {
      this.damageT = Math.max(0, this.damageT - dt * 1.8);
      this.damageEl.style.opacity = String(this.damageT * 0.85);
    }
  }

}

// ------------------------------------------------------------------ minimap

/** Map a world coordinate onto the minimap canvas (square, centred on the city). */
function mapPoint(canvas, x, z) {
  const size = canvas.width;
  const scale = size / MAP_SPAN;
  return { x: size / 2 + x * scale, y: size / 2 + z * scale };
}

/**
 * The circular minimap. Drawn every few frames by the main loop: the road grid,
 * the park block, traffic as pale dots, police as flashing red/blue dots, hidden
 * packages as gold specks, the job marker as a pulsing gold diamond, and the
 * player as a white arrow that turns with their heading. Everything is clipped
 * to the circle so the corners never show.
 *
 * `view` is { player: {x, z, heading}, city, traffic, police, target, time,
 * packages } — traffic and police are car entities, packages are {x, z} spots.
 */
Hud.prototype.drawMinimap = function drawMinimap(view) {
  const ctx = this.mapCtx;
  const canvas = this.mapCanvas;
  if (!ctx || !canvas || !view || !view.city) return;
  const size = canvas.width;
  const half = size / 2;

  ctx.save();
  ctx.clearRect(0, 0, size, size);
  // Clip to the round face.
  ctx.beginPath();
  ctx.arc(half, half, half - 1, 0, Math.PI * 2);
  ctx.clip();

  // Sea-dark face, then the block grid in a lighter shade.
  ctx.fillStyle = '#22303c';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  const block = (view.city.cell || 44) * (size / MAP_SPAN);
  for (let gx = 0; gx < 9; gx += 1) {
    for (let gz = 0; gz < 9; gz += 1) {
      const px = half + ((gx - 4) * (view.city.cell || 44)) * (size / MAP_SPAN) - block / 2;
      const pz = half + ((gz - 4) * (view.city.cell || 44)) * (size / MAP_SPAN) - block / 2;
      ctx.fillRect(px, pz, block * 0.82, block * 0.82);
    }
  }

  // Roads: pale lines on the grid.
  ctx.strokeStyle = 'rgba(240,230,200,0.55)';
  ctx.lineWidth = 2;
  const roads = view.city.roads || [];
  for (const line of roads) {
    const p = mapPoint(canvas, line, 0);
    ctx.beginPath();
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, size);
    ctx.stroke();
    const q = mapPoint(canvas, 0, line);
    ctx.beginPath();
    ctx.moveTo(0, q.y);
    ctx.lineTo(size, q.y);
    ctx.stroke();
  }

  // The park block, a green square south-west of downtown.
  if (view.city.park) {
    const park = mapPoint(canvas, view.city.park.x, view.city.park.z);
    ctx.fillStyle = 'rgba(90,180,110,0.5)';
    ctx.fillRect(park.x - block / 2, park.y - block / 2, block, block);
  }

  // Hidden packages: small gold dots that vanish once collected (the caller
  // only passes live ones).
  ctx.fillStyle = '#ffc93d';
  for (const pkg of view.packages || []) {
    const p = mapPoint(canvas, pkg.x, pkg.z);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Job marker: a gold diamond that breathes with the clock.
  if (view.target) {
    const p = mapPoint(canvas, view.target.x, view.target.z);
    const pulse = 5 + Math.sin((view.time || 0) * 3.2) * 1.6;
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - pulse);
    ctx.lineTo(p.x + pulse, p.y);
    ctx.lineTo(p.x, p.y + pulse);
    ctx.lineTo(p.x - pulse, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Traffic: pale dots, two pixels wide.
  ctx.fillStyle = 'rgba(235,240,245,0.85)';
  for (const car of view.traffic || []) {
    const p = mapPoint(canvas, car.x, car.z);
    ctx.fillRect(p.x - 1, p.y - 1, 2.4, 2.4);
  }

  // Police: alternating red/blue, flashing with the clock so a chase reads
  // at a glance even at this size.
  const flashRed = Math.floor((view.time || 0) * 4) % 2 === 0;
  ctx.fillStyle = flashRed ? '#ff3b46' : '#3b82ff';
  for (const car of view.police || []) {
    const p = mapPoint(canvas, car.x, car.z);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // The player: a white arrow, rotated to the heading, with a dark rim so it
  // reads over any background.
  const me = mapPoint(canvas, view.player.x, view.player.z);
  ctx.save();
  ctx.translate(me.x, me.y);
  ctx.rotate(Math.PI - view.player.heading);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2.4);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  // The rim and a north tick, drawn outside the clip.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(half, half, half - 1.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', half, 13);
};
