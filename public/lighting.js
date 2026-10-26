// lighting.js — Dynamic lighting + fog of war berbasis dinding (dipakai DM, player, dan layar TV).
//
// Semua koordinat dinding/lampu/token disimpan dalam PERSEN (0–100) dari lebar/tinggi peta,
// jadi tetap pas di layar mana pun (HP, laptop, TV). Perhitungan visibilitas dilakukan di piksel.
//
// Aturan:
//  - Dinding (kind:'wall') dan pintu tertutup/terkunci (kind:'door' && !open) menghalangi pandangan & cahaya.
//  - Token milik player ("party") adalah sumber penglihatan: terlihat = garis pandang ∩ (cahaya sekitar ∪ lampu ∪ jarak pandang).
//  - map.lighting.darkness: 0 = terang benderang (cuma dibatasi dinding), 1 = gelap total (hanya lampu & jarak pandang).
//  - Area yang pernah terlihat diingat (redup) — disimpan di localStorage tiap perangkat.
(function (global) {
  'use strict';

  const pool = {};
  function canvasFor(name, W, H) {
    let c = pool[name];
    if (!c) { c = document.createElement('canvas'); c.getContext('2d', { willReadFrequently: true }); pool[name] = c; }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    else c.getContext('2d').clearRect(0, 0, W, H);
    return c;
  }

  function raySeg(ox, oy, dx, dy, s) {
    const sx = s.x2 - s.x1, sy = s.y2 - s.y1;
    const den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-12) return null;
    const wx = s.x1 - ox, wy = s.y1 - oy;
    const t = (wx * sy - wy * sx) / den;
    const u = (wx * dy - wy * dx) / den;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) return t;
    return null;
  }

  // Poligon area yang terlihat dari (ox,oy) dengan penghalang `segs` (piksel), dibatasi kotak radius R.
  function visPolygon(ox, oy, segs, R) {
    const all = segs.slice();
    const x1 = ox - R, y1 = oy - R, x2 = ox + R, y2 = oy + R;
    all.push({ x1: x1, y1: y1, x2: x2, y2: y1 }, { x1: x2, y1: y1, x2: x2, y2: y2 },
             { x1: x2, y1: y2, x2: x1, y2: y2 }, { x1: x1, y1: y2, x2: x1, y2: y1 });
    const angles = [];
    for (const s of all) {
      const pts = [[s.x1, s.y1], [s.x2, s.y2]];
      for (const p of pts) {
        const a = Math.atan2(p[1] - oy, p[0] - ox);
        angles.push(a - 0.00005, a, a + 0.00005);
      }
    }
    angles.sort((a, b) => a - b);
    const out = [];
    for (const a of angles) {
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = Infinity;
      for (const s of all) {
        const t = raySeg(ox, oy, dx, dy, s);
        if (t !== null && t < best) best = t;
      }
      if (best < Infinity) out.push([ox + dx * best, oy + dy * best]);
    }
    return out;
  }

  function fillPoly(ctx, pts) {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  // ---- Memori area yang sudah dijelajahi (resolusi rendah, disimpan di localStorage) ----
  const EW = 256;
  const stores = {};
  function getExplored(key, W, H, resetAt) {
    const EH = Math.max(1, Math.round(EW * H / W));
    let st = stores[key];
    if (!st || st.c.width !== EW || st.c.height !== EH) {
      const c = document.createElement('canvas'); c.width = EW; c.height = EH;
      st = stores[key] = { c, resetAt: 0, timer: null };
      try {
        const saved = localStorage.getItem('dnd_expl_' + key);
        if (saved) {
          const img = new Image();
          img.onload = () => {
            c.getContext('2d').drawImage(img, 0, 0, EW, EH);
            global.dispatchEvent(new CustomEvent('lighting:restored'));
          };
          img.src = saved;
        }
      } catch (e) {}
    }
    if (resetAt && resetAt > st.resetAt) {
      st.resetAt = resetAt;
      st.c.getContext('2d').clearRect(0, 0, EW, EH);
      persist(key, st);
    }
    return st;
  }
  function persist(key, st) {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      try { localStorage.setItem('dnd_expl_' + key, st.c.toDataURL('image/png')); } catch (e) {}
    }, 2000);
  }

  function enabled(map) { return !!(map && map.lighting && map.lighting.enabled); }

  /**
   * Gambar lighting ke `canvas` (ukuran piksel = ukuran peta yang tampil).
   * opts: { canvas, map, tokens, mode: 'player'|'dm', key }
   * return: { isVisible(xPct, yPct) } — dipakai untuk menyembunyikan token musuh di area gelap.
   */
  function render(opts) {
    const canvas = opts.canvas, map = opts.map || {}, mode = opts.mode || 'player';
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    const L = Object.assign({ enabled: false, darkness: 0.85, visionPct: 22, resetAt: 0 }, map.lighting || {});
    const darkness = Math.max(0, Math.min(1, +L.darkness));
    const visionR = Math.max(1, L.visionPct) / 100 * W;

    const segs = (map.walls || [])
      .filter(w => w.kind !== 'door' || !w.open)
      .map(w => ({ x1: w.x1 / 100 * W, y1: w.y1 / 100 * H, x2: w.x2 / 100 * W, y2: w.y2 / 100 * H }));
    const R = Math.hypot(W, H);

    // 1) Lapisan cahaya lampu (dibatasi dinding)
    const lightC = canvasFor('light', W, H), lctx = lightC.getContext('2d');
    (map.lights || []).forEach(l => {
      const lx = l.x / 100 * W, ly = l.y / 100 * H, r = Math.max(2, l.radius) / 100 * W;
      const poly = visPolygon(lx, ly, segs, r);
      lctx.save();
      lctx.beginPath();
      if (poly.length) { lctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) lctx.lineTo(poly[i][0], poly[i][1]); lctx.closePath(); }
      lctx.clip();
      const g = lctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      lctx.fillStyle = g; lctx.fillRect(lx - r, ly - r, r * 2, r * 2);
      lctx.restore();
    });

    // 2) Area terlihat oleh party = garis pandang ∩ cahaya
    const vis = canvasFor('vis', W, H), vctx = vis.getContext('2d');
    const party = Object.values(opts.tokens || {}).filter(t => t.ownerId && !t.isOverlay);
    const A = canvasFor('tmpA', W, H), actx = A.getContext('2d');
    const B = canvasFor('tmpB', W, H), bctx = B.getContext('2d');
    party.forEach(t => {
      const tx = (parseFloat(t.x) || 0) / 100 * W, ty = (parseFloat(t.y) || 0) / 100 * H;
      actx.clearRect(0, 0, W, H); bctx.clearRect(0, 0, W, H);
      actx.fillStyle = '#fff'; fillPoly(actx, visPolygon(tx, ty, segs, R));
      // cahaya yang menerangi token ini: ambient + lampu + jarak pandang sendiri
      bctx.fillStyle = 'rgba(255,255,255,' + (1 - darkness) + ')'; bctx.fillRect(0, 0, W, H);
      bctx.drawImage(lightC, 0, 0);
      const g = bctx.createRadialGradient(tx, ty, 0, tx, ty, visionR);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.7, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      bctx.fillStyle = g; bctx.fillRect(tx - visionR, ty - visionR, visionR * 2, visionR * 2);
      actx.globalCompositeOperation = 'destination-in'; actx.drawImage(B, 0, 0); actx.globalCompositeOperation = 'source-over';
      vctx.drawImage(A, 0, 0);
    });

    ctx.clearRect(0, 0, W, H);
    if (mode === 'dm') {
      // DM: lihat semuanya, tapi area gelap diredupkan. Lampu selalu terlihat walau tak ada token di dekatnya.
      vctx.drawImage(lightC, 0, 0);
      ctx.fillStyle = 'rgba(5,5,9,0.58)'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(vis, 0, 0); ctx.globalCompositeOperation = 'source-over';
    } else {
      const st = getExplored(opts.key || 'default', W, H, L.resetAt);
      const ex = st.c.getContext('2d');
      ex.drawImage(vis, 0, 0, st.c.width, st.c.height);
      persist(opts.key || 'default', st);
      ctx.fillStyle = 'rgba(4,4,8,0.97)'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 0.38; ctx.drawImage(st.c, 0, 0, W, H);
      ctx.globalAlpha = 1; ctx.drawImage(vis, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }

    const vctxRead = vis.getContext('2d', { willReadFrequently: true });
    return {
      isVisible(xPct, yPct) {
        const px = Math.max(0, Math.min(W - 1, Math.round(xPct / 100 * W)));
        const py = Math.max(0, Math.min(H - 1, Math.round(yPct / 100 * H)));
        try { return vctxRead.getImageData(px, py, 1, 1).data[3] > 35; } catch (e) { return true; }
      }
    };
  }

  // Spotlight: DM "menyorot" satu titik peta; layar player & TV memperbesar ke titik itu.
  // els = elemen yang ikut digeser/diperbesar (gambar peta + overlay); W,H = ukuran kotak peta (tanpa transform).
  function applySpotlight(els, W, H, map) {
    const sp = map && map.spotlight;
    const on = !!(sp && sp.active) && W > 0 && H > 0;
    els = els.slice();
    els.slice().forEach(el => { const v = el && el.tagName === 'IMG' && el.nextElementSibling; if (v && v.classList && v.classList.contains('map-video')) els.push(v); });
    els.forEach(el => {
      if (!el) return;
      if (!on) { el.style.transform = ''; el.style.transformOrigin = ''; return; }
      const z = Math.max(1, +sp.zoom || 2);
      let tx = W / 2 - z * (sp.x / 100 * W), ty = H / 2 - z * (sp.y / 100 * H);
      tx = Math.min(0, Math.max(W - z * W, tx)); ty = Math.min(0, Math.max(H - z * H, ty));
      el.style.transformOrigin = '0 0';
      el.style.transition = 'transform .6s ease';
      el.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')';
    });
  }

  global.Lighting = { render, enabled, visPolygon, applySpotlight };
})(window);
