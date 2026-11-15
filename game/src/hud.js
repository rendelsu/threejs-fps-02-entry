// HUD: health, ammo, money, timer, score, kill feed, hitmarker, the buy
// menu, round banners and a live minimap. Pure DOM and one 2D canvas;
// the game never rebuilds these nodes in the loop, it only writes text.
import { WEAPONS, GRENADE_FRAG, GRENADE_SMOKE, GRENADE_FLASH, VEST, HELMET } from './state.js';

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    health: $('health-value'), healthBar: $('health-bar'),
    money: $('money-value'), score: $('score-value'), timer: $('timer-value'),
    roundLabel: $('round-label'), killfeed: $('killfeed'), banner: $('banner'),
    bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    bomb: $('bomb-status'), overlay: $('overlay'), overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'), play: $('play'), buyList: $('buy-list'),
    keysList: $('keys-list'), minimap: $('minimap'),
  };
  const mapCtx = els.minimap.getContext('2d');
  let hitTimer = null;
  let bannerTimer = null;

  const BUY_ITEMS = [
    { key: '1', id: 'vk7', name: WEAPONS.vk7.name, price: WEAPONS.vk7.price, desc: '30-round auto carbine' },
    { key: '2', id: 'hornet', name: WEAPONS.hornet.name, price: WEAPONS.hornet.price, desc: 'Fast close-range SMG' },
    { key: '3', id: 'longbow', name: WEAPONS.longbow.name, price: WEAPONS.longbow.price, desc: 'One-shot DMR, right-click to zoom' },
    { key: '4', id: 'frag', name: GRENADE_FRAG.name, price: GRENADE_FRAG.price, desc: 'Frag grenade — press 4 to throw' },
    { key: '5', id: 'smoke', name: GRENADE_SMOKE.name, price: GRENADE_SMOKE.price, desc: 'Smoke grenade — press 5 to throw' },
    { key: '6', id: 'vest', name: VEST.name, price: VEST.price, desc: 'Halves all damage taken' },
    { key: '7', id: 'flash', name: GRENADE_FLASH.name, price: GRENADE_FLASH.price, desc: 'Flash grenade — press 7 to throw; blinds anyone facing it' },
    { key: '8', id: 'helmet', name: HELMET.name, price: HELMET.price, desc: 'Halves headshot damage' },
  ];

  function renderBuy(money, owned) {
    els.buyList.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const ownedMark = owned[item.id] ? ' — owned' : '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-item';
      btn.dataset.buy = item.id;
      btn.disabled = money < item.price;
      btn.innerHTML = `<b>[${item.key}] ${item.name}</b><span>$${item.price}${ownedMark}</span><i>${item.desc}</i>`;
      els.buyList.appendChild(btn);
    }
  }

  function showOverlay(kind, data) {
    els.overlay.hidden = false;
    els.buyList.style.display = 'none';
    els.keysList.style.display = 'none';
    if (kind === 'start') {
      els.overlayTitle.textContent = 'DUSTFALL';
      els.overlayCopy.textContent = 'Kestrel Yard at dusk. Plant the charge on Crane Bay or Silo Row — or wipe the Wardens out. First to 5 rounds takes the yard.';
      els.play.textContent = 'Click to play';
      els.keysList.style.display = 'grid';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = `Round ${data.round} — Kestrels ${data.score.kestrel} : ${data.score.warden} Wardens`;
      els.play.textContent = 'Resume';
    } else if (kind === 'buy') {
      els.overlayTitle.textContent = `Buy — Round ${data.round}`;
      els.overlayCopy.textContent = `You have $${data.money}. Weapons stay with you while you live; dying loses the primary.`;
      els.play.textContent = 'Start round';
      els.buyList.style.display = 'grid';
      renderBuy(data.money, data.owned);
    } else if (kind === 'end') {
      els.overlayTitle.textContent = data.title;
      els.overlayCopy.textContent = data.sub;
      els.play.textContent = 'Play again';
    }
  }

  function drawMinimap(state) {
    const c = mapCtx;
    const W = 168;
    const H = 128;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20, 22, 26, 0.82)';
    c.fillRect(0, 0, W, H);
    const sx = (x) => ((x + 24) / 48) * W;
    const sz = (z) => ((z + 18) / 36) * H;
    c.fillStyle = '#4a4238';
    for (const r of world.minimapRects) c.fillRect(sx(r.x), sz(r.z), Math.max(1, (r.w / 48) * W), Math.max(1, (r.d / 36) * H));
    c.font = 'bold 11px sans-serif';
    c.textAlign = 'center';
    for (const site of world.sites) {
      c.fillStyle = '#f0a830';
      c.fillText(site.id, sx(site.x), sz(site.z) + 4);
      c.strokeStyle = '#f0a830';
      c.beginPath();
      c.arc(sx(site.x), sz(site.z), 8, 0, Math.PI * 2);
      c.stroke();
    }
    const dot = (x, z, color, r = 3) => {
      c.fillStyle = color;
      c.beginPath();
      c.arc(sx(x), sz(z), r, 0, Math.PI * 2);
      c.fill();
    };
    for (const bot of state.bots) {
      if (!bot.alive) continue;
      if (bot.team === 'kestrel') dot(bot.body.position.x, bot.body.position.z, '#2fa8a0');
      else if (bot.ai && bot.ai.target) dot(bot.body.position.x, bot.body.position.z, '#c25a3a');
    }
    const p = state.player;
    if (p) {
      dot(p.body.position.x, p.body.position.z, '#e9e2d2', 3.5);
      // Facing tick.
      c.strokeStyle = '#e9e2d2';
      c.beginPath();
      c.moveTo(sx(p.body.position.x), sz(p.body.position.z));
      c.lineTo(sx(p.body.position.x - Math.sin(p.yaw) * 4), sz(p.body.position.z - Math.cos(p.yaw) * 4));
      c.stroke();
    }
    if (state.bomb.state === 'dropped') dot(state.bomb.x, state.bomb.z, '#f0a830', 4);
    if (state.bomb.state === 'planted') {
      c.fillStyle = '#f0a830';
      c.font = 'bold 12px sans-serif';
      c.fillText('!', sx(state.bomb.x), sz(state.bomb.z) + 4);
    }
  }

  // A flash grenade whites out the screen, fading over the given seconds.
  // The element is created once and reused; the fade runs on CSS, so no
  // per-frame work is needed to clear it.
  let flashEl = null;
  let flashTimer = null;
  function flashBlind(seconds) {
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.id = 'flash';
      document.getElementById('hud').appendChild(flashEl);
    }
    flashEl.style.transition = 'none';
    flashEl.style.opacity = '0.95';
    if (flashTimer) clearTimeout(flashTimer);
    flashEl.style.transition = `opacity ${seconds}s linear`;
    requestAnimationFrame(() => { flashEl.style.opacity = '0'; });
    flashTimer = setTimeout(() => { flashEl.style.opacity = '0'; }, seconds * 1000 + 50);
  }

  return {
    setAmmo(mag, reserve, reloading) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammo.classList.toggle('empty', mag === 0);
      els.ammo.classList.toggle('reloading', !!reloading);
    },
    setHealth(hp) {
      els.health.textContent = hp;
      els.healthBar.style.width = `${hp}%`;
      els.healthBar.style.background = hp > 50 ? '#2fa8a0' : hp > 25 ? '#f0a830' : '#c25a3a';
    },
    setMoney(m) { els.money.textContent = `$${m}`; },
    setScore(k, w, round) {
      els.score.innerHTML = `KESTRELS <b>${k}</b> : <b>${w}</b> WARDENS`;
      els.roundLabel.textContent = `ROUND ${round}`;
    },
    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.timer.style.color = planted || s <= 10 ? '#c25a3a' : '#e9e2d2';
    },
    setBomb(text) { els.bomb.textContent = text; },
    setCrosshairGap(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(head) {
      els.hitmarker.classList.add('on');
      els.hitmarker.style.color = head ? '#c25a3a' : '#f0a830';
      if (hitTimer) clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on'), 120);
    },
    setKillfeed(lines) {
      els.killfeed.innerHTML = '';
      for (const line of lines) {
        const div = document.createElement('div');
        div.textContent = line;
        els.killfeed.appendChild(div);
      }
    },
    showBanner(title, sub, ms = 3000) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.hidden = false;
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { els.banner.hidden = true; }, ms);
    },
    hideBanner() { els.banner.hidden = true; },
    showOverlay, hideOverlay() { els.overlay.hidden = true; },
    flashBlind,
    onPlay(fn) { els.play.addEventListener('click', fn); },
    onBuy(fn) { els.buyList.addEventListener('click', (e) => { const b = e.target.closest('[data-buy]'); if (b) fn(b.dataset.buy); }); },
    drawMinimap,
  };
}
