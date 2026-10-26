// codex.js — logika murni (tanpa DOM) untuk Codex DM: parser "Paste & Go", hitung kesulitan encounter,
// dan konversi monster -> NPC. Bisa dipakai di browser (window.Codex) dan di Node (untuk tes).
(function (global) {
  'use strict';

  function abilityMod(score) { return Math.floor(((parseInt(score, 10) || 10) - 10) / 2); }
  function fmtMod(n) { return (n >= 0 ? '+' : '') + n; }
  function normMinus(s) { return String(s).replace(/[−–—]/g, '-'); }

  // ---------- CR / XP ----------
  const CR_XP = {
    '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800,
    '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000,
    '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000,
    '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000,
    '28': 120000, '29': 135000, '30': 155000
  };
  function crToXp(cr) { const k = String(cr == null ? '0' : cr).trim(); return CR_XP[k] != null ? CR_XP[k] : 0; }
  function crToNumber(cr) {
    const k = String(cr || '0').trim();
    if (k.includes('/')) { const [a, b] = k.split('/').map(Number); return b ? a / b : 0; }
    return parseFloat(k) || 0;
  }

  // Ambang XP per karakter [easy, medium, hard, deadly] untuk level 1–20 (DMG 5e)
  const THRESHOLDS = [
    null,
    [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
    [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
    [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
    [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700]
  ];
  const MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

  function monsterMultiplier(count, partySize) {
    let idx;
    if (count <= 0) return 0;
    if (count === 1) idx = 1; else if (count === 2) idx = 2; else if (count <= 6) idx = 3;
    else if (count <= 10) idx = 4; else if (count <= 14) idx = 5; else idx = 6;
    if (partySize < 3) idx = Math.min(MULTIPLIERS.length - 1, idx + 1);
    else if (partySize >= 6) idx = Math.max(0, idx - 1);
    return MULTIPLIERS[idx];
  }

  /**
   * partyLevels: array level tiap karakter (mis. [3,3,4,2]); monsters: array {cr, count}.
   * return { baseXp, multiplier, adjustedXp, thresholds:{easy,medium,hard,deadly}, difficulty, label, perPlayerXp }
   */
  function evaluateEncounter(partyLevels, monsters) {
    const levels = (partyLevels || []).map(l => Math.max(1, Math.min(20, parseInt(l, 10) || 1)));
    const th = { easy: 0, medium: 0, hard: 0, deadly: 0 };
    levels.forEach(l => { const t = THRESHOLDS[l]; th.easy += t[0]; th.medium += t[1]; th.hard += t[2]; th.deadly += t[3]; });
    let baseXp = 0, count = 0;
    (monsters || []).forEach(m => { const c = Math.max(0, parseInt(m.count, 10) || 0); baseXp += crToXp(m.cr) * c; count += c; });
    const multiplier = monsterMultiplier(count, levels.length);
    const adjustedXp = Math.round(baseXp * multiplier);
    let difficulty = 'trivial', label = 'Sepele';
    if (adjustedXp >= th.deadly && th.deadly > 0) { difficulty = 'deadly'; label = 'Mematikan'; }
    else if (adjustedXp >= th.hard && th.hard > 0) { difficulty = 'hard'; label = 'Sulit'; }
    else if (adjustedXp >= th.medium && th.medium > 0) { difficulty = 'medium'; label = 'Sedang'; }
    else if (adjustedXp >= th.easy && th.easy > 0) { difficulty = 'easy'; label = 'Mudah'; }
    return {
      baseXp, count, multiplier, adjustedXp, thresholds: th, difficulty, label,
      perPlayerXp: levels.length ? Math.floor(baseXp / levels.length) : 0
    };
  }

  // ---------- Parser stat block (SRD / 5e style) ----------
  function cleanDice(s) { return normMinus(s).replace(/\s+/g, '').replace(/^\+/, ''); }

  function parseStatBlock(text) {
    const raw = normMinus(String(text || '')).replace(/\r/g, '');
    const lines = raw.split('\n').map(l => l.trim());
    const nonEmpty = lines.filter(Boolean);
    if (nonEmpty.length < 3) return { ok: false, error: 'Teks terlalu pendek untuk stat block.' };

    const m = { n: nonEmpty[0].replace(/\s+/g, ' '), t: '', al: '', cr: '0', ac: 10, acn: '', hp: 1, hd: '', spd: '', s: [10, 10, 10, 10, 10, 10], at: [], tr: [], sv: [] };

    // Baris tipe: "Small humanoid (goblinoid), neutral evil"
    const typeLine = nonEmpty[1] || '';
    if (!/^(armor class|ac\b)/i.test(typeLine)) {
      const idx = typeLine.lastIndexOf(',');
      if (idx > 0) { m.t = typeLine.slice(0, idx).trim(); m.al = typeLine.slice(idx + 1).trim(); } else m.t = typeLine;
    }

    const full = raw;
    let mm = full.match(/Armor Class\s+(\d+)\s*(?:\(([^)]*)\))?/i) || full.match(/\bAC\s+(\d+)\s*(?:\(([^)]*)\))?/i);
    if (mm) { m.ac = parseInt(mm[1], 10); m.acn = (mm[2] || '').trim(); }
    mm = full.match(/Hit Points\s+(\d+)\s*(?:\(([^)]*)\))?/i) || full.match(/\bHP\s+(\d+)\s*(?:\(([^)]*)\))?/i);
    if (mm) { m.hp = parseInt(mm[1], 10); m.hd = (mm[2] || '').replace(/\s+/g, ''); }
    mm = full.match(/Speed\s+([^\n]+)/i); if (mm) m.spd = mm[1].trim();
    mm = full.match(/Challenge\s+([\d\/]+)/i) || full.match(/\bCR\s+([\d\/]+)/i); if (mm) m.cr = mm[1];

    // Ability scores: cari 6 pola "N (±M)" setelah STR
    const strIdx = full.search(/\bSTR\b/i);
    if (strIdx >= 0) {
      const seg = full.slice(strIdx, strIdx + 400);
      const vals = [...seg.matchAll(/(\d{1,2})\s*\(\s*[+-]?\d+\s*\)/g)].map(x => parseInt(x[1], 10)).slice(0, 6);
      if (vals.length === 6) m.s = vals;
      else {
        // format tanpa tanda kurung: "STR 8 DEX 14 ..."
        const keys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
        const got = keys.map(k => { const r = seg.match(new RegExp('\\b' + k + '\\s*[:\\s]\\s*(\\d{1,2})', 'i')); return r ? parseInt(r[1], 10) : null; });
        if (got.every(v => v != null)) m.s = got;
      }
    }

    // Bagian Actions vs traits
    const actIdx = lines.findIndex(l => /^actions?$/i.test(l));
    const chIdx = lines.findIndex(l => /^challenge\b/i.test(l));
    const endActions = lines.findIndex((l, i) => i > actIdx && actIdx >= 0 && /^(reactions?|legendary actions?|lair actions?|bonus actions?)$/i.test(l));
    if (chIdx >= 0) {
      const traitLines = lines.slice(chIdx + 1, actIdx >= 0 ? actIdx : undefined).filter(Boolean);
      // gabung baris lanjutan ke paragraf trait (trait baru dimulai dengan "Nama." diawali huruf kapital)
      const paras = [];
      traitLines.forEach(l => { if (/^[A-Z][^.]{1,50}\.\s/.test(l) || paras.length === 0) paras.push(l); else paras[paras.length - 1] += ' ' + l; });
      m.tr = paras.map(p => p.replace(/\s+/g, ' '));
    }
    if (actIdx >= 0) {
      const actionLines = lines.slice(actIdx + 1, endActions >= 0 ? endActions : undefined).filter(Boolean);
      const paras = [];
      actionLines.forEach(l => { if (/^[A-Z][^.]{1,60}\.\s/.test(l) || paras.length === 0) paras.push(l); else paras[paras.length - 1] += ' ' + l; });
      paras.forEach(p => {
        const cut = p.indexOf('. ');
        const name = (cut > 0 ? p.slice(0, cut) : p).replace(/\(.*?\)/g, '').trim();
        const body = cut > 0 ? p.slice(cut + 2) : '';
        const hit = body.match(/([+-]\d+)\s*to hit/i);
        const dmg = body.match(/Hit:\s*\d+\s*\(([^)]+)\)\s*([a-z]+)?\s*damage/i);
        const reach = body.match(/reach\s+(\d+)\s*ft/i), range = body.match(/range\s+([\d\/]+)\s*ft/i);
        if (hit && dmg) {
          m.at.push([name, parseInt(hit[1], 10), cleanDice(dmg[1]), (dmg[2] || '').toLowerCase(),
            range ? 'range ' + range[1] + ' ft.' : (reach ? 'reach ' + reach[1] + ' ft.' : '')]);
        } else if (/multiattack/i.test(name)) {
          m.tr.push('Multiattack: ' + body);
        } else {
          const dice = body.match(/\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/);
          if (dice) m.sv.push([name, cleanDice(dice[1]), body.slice(0, 160)]);
          else m.tr.push(name + ': ' + body);
        }
      });
    }

    if (m.hp <= 0) m.hp = 1;
    const found = (/Armor Class|\bAC\b/i.test(full) ? 1 : 0) + (/Hit Points|\bHP\b/i.test(full) ? 1 : 0) + (strIdx >= 0 ? 1 : 0);
    if (found < 2) return { ok: false, error: 'Tidak menemukan Armor Class, Hit Points, atau atribut (STR/DEX/…).' };
    return { ok: true, monster: m };
  }

  // ---------- Parser spell ----------
  const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];
  function parseSpell(text) {
    const raw = normMinus(String(text || '')).replace(/\r/g, '');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) return { ok: false, error: 'Teks terlalu pendek untuk spell.' };
    const sp = { n: lines[0], lvl: 0, sc: '', cast: '', rng: '', comp: '', dur: '', cls: [], d: '' };
    const levelLine = lines.slice(1, 4).join(' ');
    let lm = levelLine.match(/(\d+)(?:st|nd|rd|th)[-\s]level\s+([A-Za-z]+)/i) || levelLine.match(/level\s+(\d+)\s+([A-Za-z]+)/i);
    if (lm) { sp.lvl = parseInt(lm[1], 10); sp.sc = cap(lm[2]); }
    else {
      lm = levelLine.match(/([A-Za-z]+)\s+cantrip/i);
      if (lm) { sp.lvl = 0; sp.sc = cap(lm[1]); }
      else { const sch = SCHOOLS.find(s => new RegExp('\\b' + s + '\\b', 'i').test(levelLine)); if (sch) sp.sc = cap(sch); }
    }
    const field = (re) => { const l = lines.find(x => re.test(x)); return l ? l.replace(re, '').trim() : ''; };
    sp.cast = field(/^casting time:?\s*/i);
    sp.rng = field(/^range:?\s*/i);
    sp.comp = field(/^components?:?\s*/i);
    sp.dur = field(/^duration:?\s*/i);
    const cl = field(/^(classes|class list):?\s*/i);
    if (cl) sp.cls = cl.split(/[,;]/).map(x => x.trim().toLowerCase()).filter(Boolean);
    const lastField = Math.max(...['casting time', 'range', 'components', 'component', 'duration'].map(f => lines.findIndex(x => new RegExp('^' + f, 'i').test(x))));
    sp.d = lines.slice(lastField + 1).filter(x => !/^(classes|class list)/i.test(x)).join(' ').replace(/\s+/g, ' ').trim();
    if (!sp.cast && !sp.rng && !sp.d) return { ok: false, error: 'Tidak menemukan Casting Time/Range/Duration.' };
    return { ok: true, spell: sp };
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

  // ---------- Monster -> NPC (format NPC yang dipakai VTT) ----------
  // ---------- Aksi otomatis: Multiattack, Legendary, Reaction, Recharge ----------
  const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6 };
  const NUM_RE = 'one|two|three|four|five|six|satu|dua|tiga|empat|lima|enam|\\d+';
  const numOf = w => NUM_WORDS[String(w).toLowerCase()] || parseInt(w, 10) || 1;
  const esc = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // damage serangan + dadu tambahan ("piercing + 2d6 fire" -> +2d6)
  function attackFormula(a) {
    let f = String(a[2] || '').replace(/\s+/g, '');
    const rider = String(a[3] || '').match(/\+\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)/);
    if (rider) f += '+' + rider[1].replace(/\s+/g, '');
    return f;
  }

  // "Bite + dua Claw", "one with its bite and two with its claws", "makes two slam attacks" -> [{a, n}]
  function parseMultiattack(m) {
    const at = m.at || [];
    const line = (m.tr || []).find(t => /^Multiattack/i.test(t));
    if (!line || !at.length) return null;
    let t = line.replace(/^Multiattack[.:]?\s*/i, '');
    const sents = t.split(/(?<=\.)\s+/);
    if (sents.length > 1) {
      const keep = sents.filter(x => /attack|serangan|\bone with\b/i.test(x) && !/can use its/i.test(x));
      t = keep.length ? keep.join(' ') : sents[sents.length - 1];
    }
    t = t.split(/;| atau | or /i)[0];
    const parts = [];
    at.forEach(a => {
      const nm = esc(a[0].toLowerCase()).replace(/\s+/g, '\\s+');
      const re = new RegExp('(?:\\b(' + NUM_RE + ')\\s+(?:(?:with\\s+(?:its|his|her|their)\\s+)|(?:serangan\\s+))?)?\\b' + nm + '(?:s|es)?\\b', 'gi');
      let n = 0, mm;
      while ((mm = re.exec(t))) n += mm[1] ? numOf(mm[1]) : 1;
      if (n) parts.push({ a, n });
    });
    if (!parts.length) {
      const g = t.match(new RegExp('\\b(' + NUM_RE + ')\\s+(?:\\w+\\s+)?(?:attacks?|serangan)', 'i'));
      if (g) parts.push({ a: at[0], n: numOf(g[1]) });
    }
    return parts.length ? parts : null;
  }

  function findAttackIn(m, text) {
    const low = String(text || '').toLowerCase();
    return (m.at || []).find(a => {
      const k = a[0].toLowerCase().replace(/s$/, '');
      return k && low.indexOf(k) !== -1;
    });
  }

  function deriveActions(m) {
    const out = { active: [], passive: [], extraNotes: [], legendary: false, legendaryActions: 0, resistances: 0 };
    const tr = m.tr || [];
    const multi = parseMultiattack(m);
    if (multi) {
      const label = multi.map(p => p.a[0] + ' ×' + p.n).join(', ');
      const formula = multi.map(p => { const f = attackFormula(p.a); return Array(p.n).fill(f).join('+'); }).join('+');
      out.active.push({
        nama: 'Multiattack (' + label + ')', action: 'damage', mp_cost: '', sp_cost: '', formula,
        atk: multi[0].a[1],
        multi: multi.map(p => ({ nama: p.a[0], atk: p.a[1], formula: attackFormula(p.a), n: p.n }))
      });
    }
    tr.forEach(t => {
      let mm = t.match(/^Legendary — ([^.(]+?)\s*(?:\(Costs (\d+) Actions?\))?\.\s*(.*)$/s);
      if (mm) {
        out.legendary = true;
        const nama = mm[1].trim(), cost = mm[2] || '1', text = mm[3] || '';
        const sk = { nama: 'Legendary: ' + nama, action: 'damage', mp_cost: '', sp_cost: cost, formula: '', legendary: true };
        const hitA = findAttackIn(m, nama) || (/\bmakes? (?:a|an|one) (.+?) attack/i.test(text) ? findAttackIn(m, text.match(/\bmakes? (?:a|an|one) (.+?) attack/i)[1]) : null);
        const dice = text.match(/\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*([a-z]+) damage/i);
        const dc = text.match(/DC (\d+) (\w+) saving throw/i);
        if (hitA) { sk.formula = attackFormula(hitA); sk.atk = hitA[1]; }
        else if (dice) { sk.formula = dice[1].replace(/\s+/g, ''); sk.noHit = true; sk.info = text; }
        else { sk.noroll = true; sk.action = 'buff'; sk.info = text; }
        if (dc && sk.noHit) sk.info = 'DC ' + dc[1] + ' ' + dc[2] + ' save. ' + text;
        out.active.push(sk);
        return;
      }
      mm = t.match(/^Reaction — ([^.]+)\.\s*(.*)$/s);
      if (mm) {
        const sk = { nama: 'Reaction: ' + mm[1].trim(), action: 'buff', mp_cost: '', sp_cost: '', formula: '', noroll: true, info: mm[2] };
        const ac = mm[2].match(/adds (\d+) to its AC/i);
        if (ac) sk.acBonus = parseInt(ac[1], 10);
        out.active.push(sk);
        return;
      }
      mm = t.match(/^Legendary Resistance(?: \((\d+)\/Day\))?\.\s*(.*)$/s);
      if (mm) {
        out.resistances = parseInt(mm[1] || '3', 10);
        out.active.push({ nama: 'Legendary Resistance', action: 'buff', mp_cost: '1', sp_cost: '', formula: '', noroll: true, info: 'Gagal saving throw → memilih berhasil. ' + mm[2] });
      }
    });
    const lg = tr.find(x => /^Legendary Actions?\b/i.test(x));
    out.legendaryActions = out.legendary ? ((lg && (lg.match(/(\d+) legendary actions/i) || [])[1]) | 0 || 3) : 0;
    return out;
  }

  function monsterToNpc(m, opts) {
    opts = opts || {};
    const names = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const ability = {}; names.forEach((k, i) => { ability[k] = String(m.s[i]); });
    const dexMod = abilityMod(m.s[1]);
    const attacks = (m.at || []).map(a => ({ nama: a[0], atk_bonus: fmtMod(a[1]), damage: a[2] + (a[3] ? ' ' + a[3] : '') }));
    const derived = deriveActions(m);
    const basic = (m.at || []).map(a => ({ nama: a[0] + ' (' + fmtMod(a[1]) + ')', action: 'damage', mp_cost: '', sp_cost: '', formula: attackFormula(a), atk: a[1] }));
    const saves = (m.sv || []).map(v => {
      const rc = String(v[0]).match(/Recharge (\d)/i) || (/Breath/i.test(v[0]) ? [null, '5'] : null);
      const sk = { nama: v[0], action: 'damage', mp_cost: '', sp_cost: '', formula: v[1], noHit: true, info: v[2] };
      if (rc) sk.recharge = parseInt(rc[1], 10);
      return sk;
    });
    const active = derived.active.slice(0, 1).filter(s => s.multi).concat(basic).concat(saves)
      .concat(derived.active.filter(s => !s.multi));
    const notes = [].concat(m.tr || []).concat((m.sv || []).map(v => v[0] + ': ' + v[2]));
    const reachInfo = (m.at || []).map(a => a[0] + ' — ' + a[4]).filter(x => / — .+/.test(x));
    const poolNote = [];
    if (derived.legendaryActions) poolNote.push('SP = jatah Legendary Action (' + derived.legendaryActions + ', pulih tiap awal giliran makhluk ini)');
    if (derived.resistances) poolNote.push('MP = sisa Legendary Resistance (' + derived.resistances + '/hari)');
    return {
      nama: opts.name || m.n,
      tipe: [m.t, m.al].filter(Boolean).join(', ') + ' · CR ' + m.cr,
      ac: String(m.ac), ability,
      initiative: String(dexMod),
      hp_max: String(m.hp), hp_current: String(m.hp),
      mp_max: derived.resistances ? String(derived.resistances) : '', mp_current: derived.resistances ? String(derived.resistances) : '',
      sp_max: derived.legendaryActions ? String(derived.legendaryActions) : '', sp_current: derived.legendaryActions ? String(derived.legendaryActions) : '',
      legendary: derived.legendaryActions > 0,
      skills: (m.at || []).map(a => a[0] + ' ' + fmtMod(a[1]) + ' → ' + a[2] + ' ' + a[3]).join('; '),
      catatan: ['[' + (opts.source || 'Library') + ']' + (m.acn ? ' AC: ' + m.acn + '.' : '') + (m.spd ? ' Speed: ' + m.spd + '.' : '') + (m.hd ? ' HP dadu: ' + m.hd + '.' : '')]
        .concat(poolNote).concat(notes).concat(reachInfo.length ? ['Jangkauan: ' + reachInfo.join('; ')] : []).join('\n'),
      elements: {},
      equipment: attacks,
      inventory: [],
      skillSet: { active, passive: [], ultimate: [] },
      cr: m.cr, relationships: {}, srdName: m.n, srdSrc: opts.source || 'Library'
    };
  }

  global.Codex = {
    abilityMod, fmtMod, crToXp, crToNumber, THRESHOLDS, monsterMultiplier, evaluateEncounter,
    parseStatBlock, parseSpell, monsterToNpc, parseMultiattack, deriveActions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Codex;
})(typeof window !== 'undefined' ? window : globalThis);
