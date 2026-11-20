// hud.js — everything the player reads: cash, wanted stars, health, the objective banner,
// prompts and toasts, the busted meter, the speedometer, and the circular minimap with
// blips for the objective, the police and traffic. Pure DOM/canvas 2D over the 3D view.

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.cash = document.getElementById('cash');
    this.stars = document.getElementById('stars');
    this.healthfill = document.getElementById('healthfill');
    this.objective = document.getElementById('objective');
    this.objTitle = this.objective.querySelector('.obj-title');
    this.objText = this.objective.querySelector('.obj-text');
    this.objTimer = this.objective.querySelector('.obj-timer');
    this.prompt = document.getElementById('prompt');
    this.toast = document.getElementById('toast');
    this.bustedbar = document.getElementById('bustedbar');
    this.bustedfill = document.getElementById('bustedfill');
    this.speedo = document.getElementById('speedo');
    this.speedNum = this.speedo.querySelector('.num');
    this.carname = document.getElementById('carname');
    this.damage = document.getElementById('damageflash');
    this.map = document.getElementById('minimap').getContext('2d');
    this.toastT = 0;
    this.lastStars = -1;
  }

  show(on) { this.root.classList.toggle('on', on); }

  setCash(n) { this.cash.textContent = `$${Math.max(0, Math.floor(n)).toLocaleString('en-US')}`; }

  setStars(stars) {
    if (stars === this.lastStars) return;
    this.lastStars = stars;
    let html = '';
    for (let i = 0; i < 5; i += 1) html += i < stars ? '★' : '<span class="off">★</span>';
    this.stars.innerHTML = html;
  }

  setHealth(h) { this.healthfill.style.width = `${Math.max(0, Math.min(100, h))}%`; }

  setObjective(obj) {
    if (!obj) { this.objective.style.display = 'none'; return; }
    this.objective.style.display = 'block';
    this.objTitle.textContent = obj.title;
    this.objText.textContent = obj.text;
    if (obj.timer > 0) {
      const s = Math.ceil(obj.timer);
      this.objTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.objTimer.style.display = 'block';
    } else this.objTimer.style.display = 'none';
  }

  setPrompt(html) {
    if (!html) { this.prompt.style.display = 'none'; return; }
    this.prompt.style.display = 'block';
    this.prompt.innerHTML = html;
  }

  showToast(big, small = '', seconds = 2.4) {
    this.toast.innerHTML = `${big}${small ? `<small>${small}</small>` : ''}`;
    this.toast.style.opacity = '1';
    this.toastT = seconds;
  }

  setBusted(v) {
    if (v === null || v <= 0) { this.bustedbar.style.display = 'none'; return; }
    this.bustedbar.style.display = 'block';
    this.bustedfill.style.width = `${Math.min(100, v * 100)}%`;
  }

  setSpeed(mph, carName) {
    if (mph === null) { this.speedo.style.display = 'none'; this.carname.style.display = 'none'; return; }
    this.speedo.style.display = 'block';
    this.carname.style.display = 'block';
    this.speedNum.textContent = String(Math.round(mph));
    this.carname.textContent = carName || '';
  }

  flashDamage() { this.damage.style.opacity = '1'; }

  /** Per-frame fades for the toast and the damage vignette. */
  update(dt) {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toast.style.opacity = '0';
    }
    const o = parseFloat(this.damage.style.opacity || '0');
    if (o > 0) this.damage.style.opacity = String(Math.max(0, o - dt * 2.2));
  }

  /**
   * The minimap: north-up, centred on the player, ~120 units across. Roads as pale lines,
   * the beach as sand, then blips — gold for the objective, red/blue for police, white for
   * traffic — and the player's own arrow, turned to his heading.
   */
  drawMinimap(view) {
    const g = this.map;
    const S = 168; const C = S / 2;
    const range = 120; // world units from centre to edge
    const scale = C / range;
    const { player, city } = view;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(C, C, C - 2, 0, 6.3); g.clip();
    g.fillStyle = '#2c4a3e';
    g.fillRect(0, 0, S, S);
    const toMap = (x, z) => [C + (x - player.x) * scale, C + (z - player.z) * scale];
    // Sand + sea to the south.
    const beach = toMap(-999, city.size / 2 - 8);
    g.fillStyle = '#d9bd7f';
    g.fillRect(0, beach[1], S, S - beach[1]);
    g.fillStyle = '#2e7fa8';
    const sea = toMap(-999, city.size / 2 + 6);
    g.fillRect(0, sea[1], S, S - sea[1]);
    // Blocks as soft squares, roads left as gaps.
    g.fillStyle = '#57755f';
    const lot = 30 * scale;
    for (let bz = 0; bz < 9; bz += 1) {
      for (let bx = 0; bx < 9; bx += 1) {
        const [mx, my] = toMap((bx - 4) * 44 - 15, (bz - 4) * 44 - 15);
        if (mx + lot < 0 || my + lot < 0 || mx > S || my > S) continue;
        g.fillRect(mx, my, lot, lot);
      }
    }
    // Blips.
    const dot = (x, z, color, r) => {
      const [mx, my] = toMap(x, z);
      if (mx < -6 || my < -6 || mx > S + 6 || my > S + 6) return;
      g.fillStyle = color;
      g.beginPath(); g.arc(mx, my, r, 0, 6.3); g.fill();
    };
    for (const c of view.traffic) dot(c.x, c.z, 'rgba(255,255,255,0.75)', 2);
    for (const c of view.police) dot(c.x, c.z, (Math.floor(view.time * 4) % 2 ? '#ff4040' : '#4d7dff'), 3.4);
    if (view.target) {
      const [mx, my] = toMap(view.target.x, view.target.z);
      const clamped = Math.hypot(mx - C, my - C) > C - 12;
      let dx = mx; let dy = my;
      if (clamped) {
        const a = Math.atan2(my - C, mx - C);
        dx = C + Math.cos(a) * (C - 12); dy = C + Math.sin(a) * (C - 12);
      }
      g.fillStyle = '#ffd94d';
      g.save();
      g.translate(dx, dy);
      g.rotate(Math.PI / 4);
      const s = 5 + Math.sin(view.time * 5) * 1.1;
      g.fillRect(-s / 2, -s / 2, s, s);
      g.restore();
    }
    // Player arrow.
    g.save();
    g.translate(C, C);
    g.rotate(Math.atan2(Math.sin(player.heading), Math.cos(player.heading)) * -1 + Math.PI);
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(4.6, 5); g.lineTo(0, 2.4); g.lineTo(-4.6, 5);
    g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.restore();
  }
}
