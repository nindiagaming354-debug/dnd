// codex-ui.js — Tab "📚 Codex" di DM Board: library (monster/spell/item), Paste & Go, villain/faksi/lore,
// kalender dunia, encounter builder, dan pencarian cepat (Ctrl+K). Logika murni ada di codex.js, data di srd-data.js.
(function () {
  'use strict';
  const root = document.getElementById('tab-dm-codex');
  if (!root || !window.Codex || !window.SRD) return;

  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const RANKS = ['Minion', 'Lieutenant', 'Elite', 'Boss', 'Overlord'];
  const RANK_COLOR = { Minion: '#7b8794', Lieutenant: '#3f8fbf', Elite: '#8a5bd0', Boss: '#d4772c', Overlord: '#c0392b' };
  const STATUS = ['aktif', 'bersembunyi', 'defeated'];

  const ui = {
    sub: 'library', kind: 'monsters', q: '', crf: 'all', lvl: 'all', cls: 'all', itype: 'all', rar: 'all',
    sel: null, view: { y: null, m: null }, calDay: null,
    enc: { name: '', creatures: [], partyText: '', loadedId: null }
  };

  // ---------- util ----------
  function toast(msg) {
    let t = document.getElementById('cxToast');
    if (!t) { t = document.createElement('div'); t.id = 'cxToast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const d20 = () => 1 + Math.floor(Math.random() * 20);
  const mod = (s) => Codex.abilityMod(s);
  function playersList() { return Object.values(state.players || {}); }
  function playerOptions(withAll) {
    return (withAll ? '<option value="">Semua pemain</option>' : '') +
      playersList().map(p => `<option value="${esc(p.id)}">${esc((p.sheet && p.sheet.nama_karakter) || p.name)}</option>`).join('');
  }
  function lib(kind) { return (state.library && state.library[kind]) || {}; }

  // ---------- data library (SRD + custom) ----------
  function allMonsters() {
    const out = SRD.monsters.map((m, i) => ({ key: 'srd:' + i, src: 'SRD', data: m }));
    Object.values(lib('monsters')).forEach(m => out.push({ key: 'c:' + m.id, src: 'Custom', data: m, id: m.id }));
    return out;
  }
  function allSpells() {
    const out = SRD.spells.map((s, i) => ({ key: 'srd:' + i, src: 'SRD', data: s }));
    Object.values(lib('spells')).forEach(s => out.push({ key: 'c:' + s.id, src: 'Custom', data: s, id: s.id }));
    return out;
  }
  function allItems() { return (SRD.items || []).map((it, i) => ({ key: 'srd:' + i, src: 'SRD', data: it })); }
  function listFor(kind) { return kind === 'monsters' ? allMonsters() : kind === 'spells' ? allSpells() : allItems(); }
  function findEntry(kind, key) { return listFor(kind).find(e => e.key === key) || null; }

  // ---------- render detail ----------
  function monsterHtml(m) {
    const abil = NAMES.map((n, i) => `<div class="cx-ab"><b>${n}</b><span>${m.s[i]} (${Codex.fmtMod(mod(m.s[i]))})</span></div>`).join('');
    const atk = (m.at || []).map(a => `<li><b>${esc(a[0])}</b> ${Codex.fmtMod(a[1])} → ${esc(a[2])} ${esc(a[3])} <span class="hint">${esc(a[4] || '')}</span></li>`).join('');
    const sv = (m.sv || []).map(v => `<li><b>${esc(v[0])}</b> ${esc(v[1])} <span class="hint">${esc(v[2] || '')}</span></li>`).join('');
    const tr = (m.tr || []).map(t => `<li>${esc(t)}</li>`).join('');
    return `<div class="cx-stat">
      <h3>${esc(m.n)}</h3><div class="hint"><i>${esc(m.t)}${m.al ? ', ' + esc(m.al) : ''}</i></div>
      <div class="cx-line"><b>AC</b> ${esc(m.ac)}${m.acn ? ' (' + esc(m.acn) + ')' : ''} · <b>HP</b> ${esc(m.hp)}${m.hd ? ' (' + esc(m.hd) + ')' : ''} · <b>Speed</b> ${esc(m.spd || '-')}</div>
      <div class="cx-abs">${abil}</div>
      <div class="cx-line"><b>CR</b> ${esc(m.cr)} <span class="hint">(${Codex.crToXp(m.cr)} XP)</span></div>
      ${tr ? `<h4>Sifat &amp; Ciri</h4><ul>${tr}</ul>` : ''}
      ${atk ? `<h4>Serangan</h4><ul>${atk}</ul>` : ''}
      ${sv ? `<h4>Aksi Khusus</h4><ul>${sv}</ul>` : ''}</div>`;
  }
  function spellHtml(s) {
    const lv = s.lvl === 0 ? 'Cantrip' : 'Level ' + s.lvl;
    return `<div class="cx-stat"><h3>${esc(s.n)}</h3>
      <div class="hint"><i>${lv} · ${esc(s.sc)}</i></div>
      <div class="cx-line"><b>Casting</b> ${esc(s.cast)} · <b>Range</b> ${esc(s.rng)}</div>
      <div class="cx-line"><b>Komponen</b> ${esc(s.comp)} · <b>Durasi</b> ${esc(s.dur)}</div>
      <p>${esc(s.d)}</p>
      <div class="hint">Kelas: ${esc((s.cls || []).join(', ') || '-')}</div></div>`;
  }
  function itemHtml(it) {
    return `<div class="cx-stat"><h3>${esc(it.n)}</h3>
      <div class="hint"><i>${esc(it.type)} · ${esc(it.rarity)}</i></div>
      <div class="cx-line"><b>Harga acuan</b> ${esc(it.price)} gp</div><p>${esc(it.d)}</p></div>`;
  }
  function detailHtml(kind, e) {
    return kind === 'monsters' ? monsterHtml(e.data) : kind === 'spells' ? spellHtml(e.data) : itemHtml(e.data);
  }
  function actionsHtml(kind, e) {
    const k = esc(e.key);
    if (kind === 'monsters') return `<div class="cx-actions">
      <button class="small" data-act="mon-npc" data-key="${k}">👹 Jadikan NPC</button>
      <button class="small" data-act="mon-battle" data-key="${k}">⚔ Ke Battle</button>
      <button class="small secondary" data-act="mon-enc" data-key="${k}">🧮 Ke Encounter</button>
      ${e.id ? `<button class="small danger" data-act="lib-del" data-kind="monsters" data-id="${esc(e.id)}">🗑</button>` : ''}</div>`;
    if (kind === 'spells') return `<div class="cx-actions">
      <select id="cxSendTo">${playerOptions(true)}</select>
      <button class="small" data-act="spell-send" data-key="${k}">📜 Kirim ke Pemain</button>
      ${e.id ? `<button class="small danger" data-act="lib-del" data-kind="spells" data-id="${esc(e.id)}">🗑</button>` : ''}</div>`;
    return `<div class="cx-actions">
      <button class="small" data-act="item-shop" data-key="${k}">🛒 Ke Shop</button>
      <select id="cxSendTo">${playerOptions(false)}</select>
      <button class="small" data-act="item-give" data-key="${k}">🎁 Beri ke Pemain</button></div>`;
  }

  // ---------- sub-tab shell ----------
  const SUBS = [['library', '📖 Library'], ['paste', '📥 Paste & Go'], ['villain', '😈 Villain'], ['faction', '🏴 Faksi'],
    ['lore', '🗺 Lore & Lokasi'], ['races', '🧬 Ras'], ['calendar', '📅 Kalender'], ['encounter', '⚔ Encounter']];
  function render() {
    root.innerHTML = `<div class="card cx-wrap">
      <div class="cx-subtabs">${SUBS.map(s => `<button class="small ${ui.sub === s[0] ? '' : 'secondary'}" data-act="sub" data-sub="${s[0]}">${s[1]}</button>`).join('')}</div>
      <div id="cxBody"></div>
      <p class="hint" style="margin-top:12px;">${esc(SRD.license)} Tekan <b>Ctrl+K</b> di mana saja untuk pencarian cepat.</p></div>`;
    const body = document.getElementById('cxBody');
    ({ library: renderLibrary, paste: renderPaste, villain: () => renderEntries('villain'), faction: () => renderEntries('faction'),
       lore: () => renderEntries('lore'), races: renderRaces, calendar: renderCalendar, encounter: renderEncounter })[ui.sub](body);
  }

  // ---------- Library ----------
  function libFilterHtml() {
    const kinds = [['monsters', '👹 Monster'], ['spells', '✨ Spell'], ['items', '🎒 Item']];
    let f = '';
    if (ui.kind === 'monsters') f = `<select data-bind="crf"><option value="all">Semua CR</option><option value="a">CR 0 – 1</option><option value="b">CR 2 – 4</option><option value="c">CR 5 – 8</option><option value="d">CR 9 – 12</option><option value="e">CR 13+</option></select>`;
    if (ui.kind === 'spells') {
      const cls = [...new Set(allSpells().flatMap(s => s.data.cls || []))].sort();
      f = `<select data-bind="lvl"><option value="all">Semua level</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => `<option value="${l}">${l === 0 ? 'Cantrip' : 'Level ' + l}</option>`).join('')}</select>
        <select data-bind="cls"><option value="all">Semua kelas</option>${cls.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>`;
    }
    if (ui.kind === 'items') {
      const types = [...new Set(allItems().map(i => i.data.type))], rars = [...new Set(allItems().map(i => i.data.rarity))];
      f = `<select data-bind="itype"><option value="all">Semua jenis</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <select data-bind="rar"><option value="all">Semua kelangkaan</option>${rars.map(t => `<option>${esc(t)}</option>`).join('')}</select>`;
    }
    return `<div class="cx-row">${kinds.map(k => `<button class="small ${ui.kind === k[0] ? '' : 'secondary'}" data-act="kind" data-kind="${k[0]}">${k[1]}</button>`).join('')}
      <input type="search" id="cxQ" data-bind="q" placeholder="Cari nama…" value="${esc(ui.q)}" style="flex:1; min-width:140px;"> ${f}</div>`;
  }
  function crBucket(cr) {
    const n = Codex.crToNumber(cr);
    return n <= 1 ? 'a' : n <= 4 ? 'b' : n <= 8 ? 'c' : n <= 12 ? 'd' : 'e';
  }
  function filteredLib() {
    const q = ui.q.trim().toLowerCase();
    return listFor(ui.kind).filter(e => {
      const d = e.data;
      if (q && !(String(d.n).toLowerCase().includes(q) || String(d.t || d.type || '').toLowerCase().includes(q))) return false;
      if (ui.kind === 'monsters' && ui.crf !== 'all' && crBucket(d.cr) !== ui.crf) return false;
      if (ui.kind === 'spells') {
        if (ui.lvl !== 'all' && d.lvl !== parseInt(ui.lvl, 10)) return false;
        if (ui.cls !== 'all' && !(d.cls || []).includes(ui.cls)) return false;
      }
      if (ui.kind === 'items') {
        if (ui.itype !== 'all' && d.type !== ui.itype) return false;
        if (ui.rar !== 'all' && d.rarity !== ui.rar) return false;
      }
      return true;
    }).sort((a, b) => ui.kind === 'monsters' ? (Codex.crToNumber(a.data.cr) - Codex.crToNumber(b.data.cr)) || a.data.n.localeCompare(b.data.n)
      : ui.kind === 'spells' ? (a.data.lvl - b.data.lvl) || a.data.n.localeCompare(b.data.n) : a.data.n.localeCompare(b.data.n));
  }
  function renderLibrary(body) {
    body.innerHTML = libFilterHtml() + `<div class="cx-split"><div id="cxList" class="cx-list"></div><div id="cxDetail" class="cx-detail"></div></div>`;
    ['crf', 'lvl', 'cls', 'itype', 'rar'].forEach(k => { const el = body.querySelector(`[data-bind="${k}"]`); if (el) el.value = ui[k]; });
    refreshLib();
  }
  function refreshLib() {
    const list = document.getElementById('cxList'), det = document.getElementById('cxDetail');
    if (!list) return;
    const items = filteredLib();
    list.innerHTML = items.slice(0, 200).map(e => {
      const d = e.data;
      const meta = ui.kind === 'monsters' ? 'CR ' + d.cr : ui.kind === 'spells' ? (d.lvl === 0 ? 'Cantrip' : 'Lv ' + d.lvl) : d.rarity;
      return `<div class="cx-item ${ui.sel === e.key ? 'sel' : ''}" data-act="pick" data-key="${esc(e.key)}"><span>${esc(d.n)}${e.src === 'Custom' ? ' <em class="cx-tag">custom</em>' : ''}</span><span class="hint">${esc(meta)}</span></div>`;
    }).join('') + (items.length > 200 ? `<p class="hint">…${items.length - 200} lagi, persempit pencarian.</p>` : '') || '<p class="hint" style="padding:8px;">Tidak ada hasil.</p>';
    const e = ui.sel && findEntry(ui.kind, ui.sel);
    det.innerHTML = e ? detailHtml(ui.kind, e) + actionsHtml(ui.kind, e) : '<p class="hint" style="padding:8px;">Pilih entri di kiri untuk melihat detail.</p>';
  }

  // ---------- Paste & Go ----------
  const SAMPLE_MON = `Goblin Boss
Small humanoid (goblinoid), neutral evil
Armor Class 17 (chain shirt, shield)
Hit Points 21 (6d6)
Speed 30 ft.
STR 10 (+0) DEX 14 (+2) CON 10 (+0) INT 10 (+0) WIS 8 (-1) CHA 10 (+0)
Challenge 1 (200 XP)
Nimble Escape. The goblin can take the Disengage or Hide action as a bonus action.
Actions
Morningstar. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d8 + 2) piercing damage.
Javelin. Ranged Weapon Attack: +2 to hit, range 30/120 ft., one target. Hit: 3 (1d6) piercing damage.`;
  const SAMPLE_SPELL = `Frost Lance
2nd-level evocation
Casting Time: 1 action
Range: 60 feet
Components: V, S
Duration: Instantaneous
A lance of ice strikes a creature you can see. It must make a Dexterity saving throw, taking 4d6 cold damage on a failed save, or half as much on a success.`;
  function renderPaste(body) {
    body.innerHTML = `<p class="hint">Tempel stat block monster atau teks spell (format SRD / buku 5e) lalu klik <b>Baca</b>. Hasilnya bisa disimpan ke library atau langsung dijadikan NPC.</p>
      <div class="cx-row"><button class="small secondary" data-act="sample" data-what="mon">Contoh monster</button><button class="small secondary" data-act="sample" data-what="spell">Contoh spell</button></div>
      <textarea id="cxPaste" rows="12" placeholder="Tempel di sini…" style="width:100%; font-family:monospace;"></textarea>
      <div class="cx-row"><button data-act="parse">🔍 Baca</button><span id="cxParseMsg" class="hint"></span></div>
      <div id="cxPreview"></div>`;
  }
  let parsed = null;
  function doParse() {
    const text = document.getElementById('cxPaste').value, msg = document.getElementById('cxParseMsg'), pv = document.getElementById('cxPreview');
    parsed = null; pv.innerHTML = '';
    const looksMonster = /armor class|hit points|\bSTR\b/i.test(text);
    const r = looksMonster ? Codex.parseStatBlock(text) : Codex.parseSpell(text);
    if (!r.ok) { msg.textContent = '⚠ ' + r.error; msg.style.color = 'var(--crimson-bright)'; return; }
    msg.textContent = looksMonster ? '✔ Terbaca sebagai monster.' : '✔ Terbaca sebagai spell.'; msg.style.color = '';
    parsed = looksMonster ? { kind: 'monsters', data: r.monster } : { kind: 'spells', data: r.spell };
    pv.innerHTML = (looksMonster ? monsterHtml(r.monster) : spellHtml(r.spell)) +
      `<div class="cx-actions"><button data-act="paste-save">💾 Simpan ke Library</button>${looksMonster ? '<button data-act="paste-npc">👹 Simpan &amp; Jadikan NPC</button>' : ''}</div>`;
  }

  // ---------- Codex entries (villain / faction / lore) ----------
  const TYPE_CONF = {
    villain: { icon: '😈', title: 'Villain Tracker', add: '+ Villain Baru', lead: 'Pantau antagonis, rencana, dan jaringan minion mereka.' },
    faction: { icon: '🏴', title: 'Faksi', add: '+ Faksi Baru', lead: 'Kelompok, kerajaan, dan guild beserta sikap mereka terhadap party.' },
    lore: { icon: '🗺', title: 'Lore & Lokasi', add: '+ Entri Baru', lead: 'Catatan dunia, sejarah, tempat penting, dan rahasia.' }
  };
  function entriesOf(group) {
    const types = group === 'lore' ? ['lore', 'location'] : [group];
    return Object.values(state.codex || {}).filter(e => types.includes(e.type));
  }
  function renderEntries(group) {
    const body = document.getElementById('cxBody'), c = TYPE_CONF[group];
    const list = entriesOf(group).sort((a, b) => group === 'villain'
      ? (RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank)) || (a.status === 'defeated') - (b.status === 'defeated')
      : (b.updatedAt || 0) - (a.updatedAt || 0));
    body.innerHTML = `<div class="cx-row"><b>${c.icon} ${c.title}</b><span class="hint" style="flex:1;">${c.lead}</span><button data-act="entry-new" data-group="${group}">${c.add}</button></div>
      <div class="cx-grid">${list.map(e => entryCard(e, group)).join('') || '<p class="hint">Belum ada entri.</p>'}</div>`;
  }
  function entryCard(e, group) {
    const id = esc(e.id), dead = e.status === 'defeated';
    let meta = '';
    if (e.type === 'villain') meta = `<span class="cx-rank" style="background:${RANK_COLOR[e.rank] || '#666'}">${esc(e.rank || 'Villain')}</span> <span class="hint">${esc(e.status)}</span>${e.hp || e.ac ? ` <span class="hint">· HP ${esc(e.hp || '?')} · AC ${esc(e.ac || '?')}</span>` : ''}`;
    else if (e.type === 'faction') meta = `<span class="cx-rank" style="background:${e.attitude === 'musuh' ? '#c0392b' : e.attitude === 'sekutu' ? '#2f8f5f' : '#7b8794'}">${esc(e.attitude || 'netral')}</span> <span class="hint">reputasi ${e.loyalty > 0 ? '+' : ''}${e.loyalty}</span>`;
    else meta = `<span class="cx-rank" style="background:#7b6a4a">${e.type === 'location' ? 'lokasi' : 'lore'}</span>`;
    const members = (e.members || []).length ? `<div class="hint">👥 ${esc(e.members.slice(0, 6).join(', '))}${e.members.length > 6 ? '…' : ''}</div>` : '';
    return `<div class="cx-card ${dead ? 'dead' : ''}">
      ${e.imageUrl ? `<img src="${esc(e.imageUrl)}" alt="">` : `<div class="cx-noimg">${TYPE_CONF[group].icon}</div>`}
      <div class="cx-card-body"><h4>${esc(e.name)}</h4><div>${meta}</div>
        ${e.desc ? `<p>${esc(e.desc.length > 160 ? e.desc.slice(0, 160) + '…' : e.desc)}</p>` : ''}
        ${e.plan ? `<p class="cx-plan"><b>${e.type === 'villain' ? 'Langkah berikutnya' : 'Tujuan'}:</b> ${esc(e.plan.length > 140 ? e.plan.slice(0, 140) + '…' : e.plan)}</p>` : ''}
        ${members}
        ${e.secret ? `<details><summary class="hint">🔒 Rahasia</summary><p>${esc(e.secret)}</p></details>` : ''}
        <div class="cx-actions">
          <button class="small secondary" data-act="entry-edit" data-id="${id}">✏ Edit</button>
          ${e.type === 'villain' ? `<button class="small secondary" data-act="villain-toggle" data-id="${id}">${dead ? '♻ Hidupkan' : '☠ Kalah'}</button>
            <button class="small" data-act="villain-battle" data-id="${id}">⚔ Battle</button><button class="small secondary" data-act="villain-npc" data-id="${id}">👹 NPC</button>` : ''}
          <button class="small danger" data-act="entry-del" data-id="${id}">🗑</button></div></div></div>`;
  }
  let formImage = undefined; // undefined = tak diubah, null = hapus, string = baru
  function openEntryForm(type, e) {
    e = e || { type, status: 'aktif', loyalty: 0, rank: 'Minion', attitude: 'netral', members: [] };
    formImage = undefined;
    const isV = e.type === 'villain', isF = e.type === 'faction', isL = e.type === 'lore' || e.type === 'location';
    const ov = document.createElement('div'); ov.className = 'cx-overlay'; ov.id = 'cxForm';
    ov.innerHTML = `<div class="cx-modal card"><h3>${TYPE_CONF[isL ? 'lore' : e.type].icon} ${e.id ? 'Edit' : 'Baru'}</h3>
      <div class="cx-form">
        ${isL ? `<label>Jenis <select id="cxf_type"><option value="lore" ${e.type === 'lore' ? 'selected' : ''}>Lore</option><option value="location" ${e.type === 'location' ? 'selected' : ''}>Lokasi</option></select></label>` : ''}
        <label>Nama <input id="cxf_name" value="${esc(e.name || '')}"></label>
        ${isV ? `<div class="cx-row"><label>Rank ancaman <select id="cxf_rank">${RANKS.map(r => `<option ${e.rank === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <label>Status <select id="cxf_status">${STATUS.map(r => `<option ${e.status === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <label>HP <input id="cxf_hp" value="${esc(e.hp || '')}" style="width:70px;"></label><label>AC <input id="cxf_ac" value="${esc(e.ac || '')}" style="width:60px;"></label></div>` : ''}
        ${isF ? `<div class="cx-row"><label>Sikap <select id="cxf_att">${['sekutu', 'netral', 'musuh'].map(r => `<option ${e.attitude === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <label style="flex:1;">Reputasi party: <b id="cxf_loyv">${e.loyalty}</b><input type="range" id="cxf_loy" min="-100" max="100" value="${e.loyalty}"></label></div>` : ''}
        <label>${isV ? 'Latar & deskripsi' : 'Deskripsi'} <textarea id="cxf_desc" rows="3">${esc(e.desc || '')}</textarea></label>
        ${isL ? '' : `<label>${isV ? 'Rencana / langkah berikutnya' : 'Tujuan'} <textarea id="cxf_plan" rows="2">${esc(e.plan || '')}</textarea></label>`}
        <label>🔒 Rahasia (hanya DM) <textarea id="cxf_secret" rows="2">${esc(e.secret || '')}</textarea></label>
        ${isL ? '' : `<label>${isV ? 'Jaringan minion / bawahan' : 'Anggota penting'} (satu nama per baris) <textarea id="cxf_members" rows="3">${esc((e.members || []).join('\n'))}</textarea></label>`}
        <label>Gambar / potret <input type="file" id="cxf_img" accept="image/*"></label>
        ${e.imageUrl ? `<label class="hint"><input type="checkbox" id="cxf_noimg" style="width:auto;"> Hapus gambar saat ini</label>` : ''}
      </div>
      <div class="cx-actions"><button id="cxf_save">💾 Simpan</button><button class="secondary" id="cxf_cancel">Batal</button></div></div>`;
    document.body.appendChild(ov);
    const loy = ov.querySelector('#cxf_loy'); if (loy) loy.oninput = () => { ov.querySelector('#cxf_loyv').textContent = loy.value; };
    ov.querySelector('#cxf_img').onchange = (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      compressImageFile(f, 400, 0.82).then(u => { formImage = u; });
    };
    ov.querySelector('#cxf_cancel').onclick = () => ov.remove();
    ov.querySelector('#cxf_save').onclick = () => {
      const g = (id) => { const el = ov.querySelector('#' + id); return el ? el.value : ''; };
      const entry = {
        id: e.id, type: isL ? g('cxf_type') : e.type, name: g('cxf_name').trim(),
        rank: g('cxf_rank'), status: g('cxf_status') || e.status || 'aktif', hp: g('cxf_hp'), ac: g('cxf_ac'),
        attitude: g('cxf_att'), loyalty: parseInt(g('cxf_loy'), 10) || 0,
        desc: g('cxf_desc'), plan: g('cxf_plan'), secret: g('cxf_secret'),
        members: g('cxf_members').split('\n').map(x => x.trim()).filter(Boolean)
      };
      if (!entry.name) return alert('Isi nama dulu.');
      if (ov.querySelector('#cxf_noimg') && ov.querySelector('#cxf_noimg').checked) entry.imageUrl = '';
      else if (formImage) entry.imageUrl = formImage;
      socket.emit('dm:codex-save', { code: CODE, entry }, (res) => {
        if (res && res.ok) { ov.remove(); toast('Tersimpan.'); } else alert((res && res.error) || 'Gagal menyimpan.');
      });
    };
  }
  function villainToBattleEntry(e) {
    return { name: e.name, type: 'enemy', roll: d20(), initiative: 0, hp_max: e.hp || '', hp_current: e.hp || '', ac: e.ac || '' };
  }

  // ---------- Ras homebrew ----------
  const RACE_STAT_OPTS = [['', '- (cuma catatan)'], ['ac', 'AC'], ['hp_max', 'HP Max'], ['mp_max', 'MP Max'], ['sp_max', 'SP Max'], ['atk', 'ATK'], ['def', 'DEF'], ['other', 'Lainnya']];
  const RACE_STAT_LABEL = Object.fromEntries(RACE_STAT_OPTS.map(o => [o[0], o[1]]));
  function racesOf() { return Object.values(state.races || {}).sort((a, b) => a.nama.localeCompare(b.nama)); }
  function renderRaces() {
    const body = document.getElementById('cxBody'), list = racesOf();
    body.innerHTML = `<div class="cx-row"><b>🧬 Ras Homebrew</b><span class="hint" style="flex:1;">Ras buatanmu muncul di pemilih ras setiap pemain (bertanda "homebrew"). Trait dengan efek stat langsung ikut dihitung di sheet dan battle.</span><button data-act="race-new">+ Ras Baru</button></div>
      <div class="cx-grid">${list.map(r => `<div class="cx-card"><div class="cx-noimg">🧬</div><div class="cx-card-body"><h4>${esc(r.nama)}</h4>
        ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
        <div class="hint">${(r.traits || []).map(t => `◆ ${esc(t.nama || 'Trait')}${t.stat ? ' (' + esc(RACE_STAT_LABEL[t.stat] || t.stat) + ' ' + (parseFloat(t.amount) > 0 ? '+' : '') + esc(t.amount) + ')' : ''}`).join('<br>') || 'Belum ada trait.'}</div>
        <div class="cx-actions"><button class="small secondary" data-act="race-edit" data-id="${esc(r.id)}">✏ Edit</button><button class="small danger" data-act="race-del" data-id="${esc(r.id)}">🗑</button></div></div></div>`).join('') || '<p class="hint">Belum ada ras homebrew. Klik <b>+ Ras Baru</b> untuk membuat yang pertama.</p>'}</div>`;
  }
  function openRaceForm(r) {
    r = r || { nama: '', desc: '', traits: [] };
    const traits = Array.from({ length: 4 }, (_, i) => (r.traits || [])[i] || { nama: '', stat: '', amount: '' });
    const ov = document.createElement('div'); ov.className = 'cx-overlay'; ov.id = 'cxRaceForm';
    ov.innerHTML = `<div class="cx-modal card"><h3>🧬 ${r.id ? 'Edit ras' : 'Ras baru'}</h3><div class="cx-form">
      <label>Nama ras <input id="rcf_nama" maxlength="40" value="${esc(r.nama)}"></label>
      <label>Deskripsi singkat <textarea id="rcf_desc" rows="2" maxlength="300">${esc(r.desc || '')}</textarea></label>
      <p class="hint" style="margin:4px 0;">Sampai 4 trait. Trait dengan stat akan menambah/mengurangi angka karakter.</p>
      ${traits.map((t, i) => `<div class="cx-row" data-rt="${i}"><input data-f="nama" placeholder="Nama trait" maxlength="40" value="${esc(t.nama)}" style="flex:1; min-width:130px;">
        <select data-f="stat">${RACE_STAT_OPTS.map(o => `<option value="${o[0]}" ${t.stat === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
        <input data-f="amount" type="number" placeholder="+/-" value="${esc(t.amount)}" style="width:80px;"></div>`).join('')}
      </div><div class="cx-actions"><button id="rcf_save">💾 Simpan</button><button class="secondary" id="rcf_cancel">Batal</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#rcf_cancel').onclick = () => ov.remove();
    ov.querySelector('#rcf_save').onclick = () => {
      const race = { id: r.id, nama: ov.querySelector('#rcf_nama').value.trim(), desc: ov.querySelector('#rcf_desc').value.trim(),
        traits: [...ov.querySelectorAll('[data-rt]')].map(row => ({ nama: row.querySelector('[data-f="nama"]').value.trim(), stat: row.querySelector('[data-f="stat"]').value, amount: row.querySelector('[data-f="amount"]').value })) };
      if (!race.nama) return alert('Isi nama ras dulu.');
      socket.emit('dm:race-save', { code: CODE, race }, (res) => { if (res && res.ok) { ov.remove(); toast('🧬 Ras tersimpan — langsung muncul di pemilih ras pemain.'); } else alert((res && res.error) || 'Gagal menyimpan.'); });
    };
  }

  // ---------- Kalender ----------
  function cal() { return state.calendar || { year: 1, month: 0, day: 1, months: [{ name: 'Bulan 1', days: 30 }], events: {} }; }
  function renderCalendar() {
    const body = document.getElementById('cxBody'), c = cal();
    if (ui.view.y == null) { ui.view.y = c.year; ui.view.m = c.month; }
    const m = c.months[Math.min(ui.view.m, c.months.length - 1)];
    const evs = Object.values(c.events || {});
    const evOf = (y, mo, d) => evs.filter(e => e.year === y && e.month === mo && e.day === d);
    let cells = '';
    for (let d = 1; d <= m.days; d++) {
      const es = evOf(ui.view.y, ui.view.m, d);
      const today = ui.view.y === c.year && ui.view.m === c.month && d === c.day;
      cells += `<div class="cx-day ${today ? 'today' : ''} ${ui.calDay === d ? 'pick' : ''}" data-act="cal-day" data-day="${d}" title="${esc(es.map(x => x.title).join('; '))}">${d}${es.length ? '<i class="cx-dot"></i>' : ''}</div>`;
    }
    const sorted = evs.sort((a, b) => (a.year - b.year) || (a.month - b.month) || (a.day - b.day));
    const pick = ui.calDay || c.day;
    body.innerHTML = `<div class="cx-row"><b style="font-size:18px;">📅 ${c.day} ${esc(c.months[c.month].name)}, Tahun ${c.year}</b>
        <span style="flex:1;"></span>
        ${[-1, 1, 7, 30].map(n => `<button class="small ${n < 0 ? 'secondary' : ''}" data-act="cal-adv" data-n="${n}">${n > 0 ? '+' : ''}${n} hari</button>`).join('')}</div>
      <div class="cx-row"><label>Atur tanggal: <input id="cxcY" type="number" value="${c.year}" style="width:70px;"></label>
        <select id="cxcM">${c.months.map((mm, i) => `<option value="${i + 1}" ${i === c.month ? 'selected' : ''}>${esc(mm.name)}</option>`).join('')}</select>
        <input id="cxcD" type="number" min="1" value="${c.day}" style="width:60px;"><button class="small" data-act="cal-set">Set</button>
        <button class="small secondary" data-act="cal-config">⚙ Atur nama bulan</button></div>
      <div class="cx-row"><button class="small secondary" data-act="cal-view" data-n="-1">◀</button>
        <b>${esc(m.name)} — Tahun ${ui.view.y}</b><button class="small secondary" data-act="cal-view" data-n="1">▶</button>
        <span class="hint">Klik tanggal untuk membuat event pada hari itu.</span></div>
      <div class="cx-cal">${cells}</div>
      <div class="cx-row" style="margin-top:10px;"><b>Event baru pada ${pick} ${esc(m.name)}, Th ${ui.view.y}</b></div>
      <div class="cx-row"><input id="cxeT" placeholder="Judul event (festival, tenggat, ritual…)" style="flex:1; min-width:180px;"><input id="cxeD" placeholder="Catatan" style="flex:2; min-width:180px;"><button data-act="cal-evsave">+ Tambah</button></div>
      <div class="cx-evlist">${sorted.map(e => `<div class="cx-evrow"><span><b>${e.day} ${esc((c.months[e.month] || {}).name)}, Th ${e.year}</b> — ${esc(e.title)} <span class="hint">${esc(e.desc)}</span></span><button class="small danger" data-act="cal-evdel" data-id="${esc(e.id)}">🗑</button></div>`).join('') || '<p class="hint">Belum ada event.</p>'}</div>`;
  }
  function openCalConfig() {
    const c = cal();
    const text = prompt('Satu bulan per baris, format:  Nama,JumlahHari\n(mis. Januari,31)', c.months.map(m => m.name + ',' + m.days).join('\n'));
    if (text == null) return;
    const months = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(','); return { name: p[0].trim(), days: parseInt(p[1], 10) || 30 }; });
    socket.emit('dm:calendar-config', { code: CODE, months }, (r) => { if (!r || !r.ok) alert((r && r.error) || 'Gagal.'); });
  }

  // ---------- Encounter ----------
  function partyLevels() {
    const t = ui.enc.partyText.trim();
    if (t) return t.split(/[ ,;]+/).map(x => parseInt(x, 10)).filter(n => n > 0);
    const lv = playersList().map(p => parseInt(p.sheet && p.sheet.lv, 10)).filter(n => n > 0);
    return lv.length ? lv : [1, 1, 1, 1];
  }
  function encCreatureFromMonster(m) {
    return { name: m.n, cr: String(m.cr), count: 1, hp: String(m.hp), ac: String(m.ac), dexMod: mod(m.s[1]), srd: m.n };
  }
  // Monster SRD masuk Battle sebagai NPC bersambung (bawa serangan, Multiattack, Legendary, Reaction, Recharge).
  function monsterByName(n) { const e = listFor('monsters').find(x => x.data && x.data.n === n); return e || null; }
  function ensureNpcForMonster(m, source, cb) {
    const src = source || 'Library';
    const ex = Object.values(state.npcs || {}).find(n => n.srdName === m.n && n.srdSrc === src);
    if (ex) return cb(ex);
    socket.emit('dm:save-npc', { code: CODE, npc: Codex.monsterToNpc(m, { source: src }) }, (r) => cb(r && r.ok ? r.npc : null));
  }
  function npcBattleEntry(npc, name, roll) {
    return { name, type: 'enemy', roll, initiative: npc.initiative, hp_max: npc.hp_max, hp_current: npc.hp_max,
      mp_max: npc.mp_max, mp_current: npc.mp_max, sp_max: npc.sp_max, sp_current: npc.sp_max, ac: npc.ac,
      refType: 'npc', refId: npc.id, elements: npc.elements || {}, legendary: !!npc.legendary };
  }
  function addToEncounter(c) {
    const ex = ui.enc.creatures.find(x => x.name === c.name && x.cr === c.cr);
    if (ex) ex.count++; else ui.enc.creatures.push(c);
  }
  function encSources(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    const out = [];
    allMonsters().forEach(e => { if (e.data.n.toLowerCase().includes(q)) out.push({ label: e.data.n + ' · CR ' + e.data.cr, c: encCreatureFromMonster(e.data) }); });
    Object.values(state.npcs || {}).forEach(n => { if ((n.nama || '').toLowerCase().includes(q)) out.push({ label: n.nama + ' · NPC', c: { name: n.nama, cr: String(n.cr || '0'), count: 1, hp: String(n.hp_max || ''), ac: String(n.ac || ''), dexMod: mod((n.ability || {}).dex) } }); });
    return out.slice(0, 12);
  }
  function renderEncounter() {
    const body = document.getElementById('cxBody'), e = ui.enc;
    const levels = partyLevels();
    const ev = Codex.evaluateEncounter(levels, e.creatures);
    const th = ev.thresholds, max = Math.max(th.deadly * 1.25, ev.adjustedXp, 1);
    const colors = { trivial: '#7b8794', easy: '#2f8f5f', medium: '#c9a227', hard: '#d4772c', deadly: '#c0392b' };
    const saved = Object.values(state.encounters || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    body.innerHTML = `<div class="cx-row"><label>Level party <input id="cxParty" value="${esc(e.partyText)}" placeholder="${esc(levels.join(', '))}" style="width:170px;"></label>
        <span class="hint">Kosongkan = otomatis dari level pemain (${levels.length} orang).</span></div>
      <div class="cx-row"><input id="cxEncQ" placeholder="Cari monster / NPC untuk ditambahkan…" style="flex:1;"></div>
      <div id="cxEncRes" class="cx-list" style="max-height:150px; display:none;"></div>
      <div class="cx-evlist">${e.creatures.map((c, i) => `<div class="cx-evrow"><span><b>${esc(c.name)}</b> <span class="hint">CR ${esc(c.cr)} · HP ${esc(c.hp || '?')} · AC ${esc(c.ac || '?')}</span></span>
        <span><input type="number" min="1" max="50" value="${c.count}" data-act-in="enc-count" data-i="${i}" style="width:60px;"> <button class="small danger" data-act="enc-rm" data-i="${i}">✕</button></span></div>`).join('') || '<p class="hint">Belum ada makhluk. Cari di atas, atau klik "🧮 Ke Encounter" dari Library.</p>'}</div>
      <div class="cx-diff"><div class="cx-bar"><i style="width:${Math.min(100, ev.adjustedXp / max * 100)}%; background:${colors[ev.difficulty]}"></i>
        ${[['easy', th.easy], ['medium', th.medium], ['hard', th.hard], ['deadly', th.deadly]].map(t => `<u style="left:${t[1] / max * 100}%" title="${t[0]} ${t[1]}"></u>`).join('')}</div>
        <div><span class="cx-rank" style="background:${colors[ev.difficulty]}; font-size:14px;">${ev.label}</span>
        <span class="hint"> XP dasar ${ev.baseXp} × ${ev.multiplier} = <b>${ev.adjustedXp}</b> · ambang: mudah ${th.easy} / sedang ${th.medium} / sulit ${th.hard} / mematikan ${th.deadly} · ±${ev.perPlayerXp} XP per pemain</span></div></div>
      <div class="cx-row"><input id="cxEncName" placeholder="Nama encounter" value="${esc(e.name)}" style="flex:1; min-width:160px;">
        <button data-act="enc-save">💾 Simpan</button><button data-act="enc-start">⚔ Mulai Battle</button><button class="secondary" data-act="enc-clear">Kosongkan</button></div>
      <h4>Encounter tersimpan</h4>
      <div class="cx-evlist">${saved.map(s => `<div class="cx-evrow"><span><b>${esc(s.name)}</b> <span class="hint">${s.creatures.map(c => c.count + '× ' + esc(c.name)).join(', ')}</span></span>
        <span><button class="small" data-act="enc-load" data-id="${esc(s.id)}">Muat</button> <button class="small danger" data-act="enc-del" data-id="${esc(s.id)}">🗑</button></span></div>`).join('') || '<p class="hint">Belum ada.</p>'}</div>`;
  }
  function startEncounter() {
    const list = ui.enc.creatures; if (!list.length) return toast('Tambahkan makhluk dulu.');
    let n = 0;
    list.forEach(c => {
      const add = (npc) => {
        for (let i = 1; i <= c.count; i++) {
          const nm = c.count > 1 ? `${c.name} ${i}` : c.name, roll = d20() + (c.dexMod || 0);
          socket.emit('dm:battle-add', { code: CODE, entry: npc ? npcBattleEntry(npc, nm, roll)
            : { name: nm, type: 'enemy', roll, initiative: c.dexMod || 0, hp_max: c.hp, hp_current: c.hp, ac: c.ac } });
        }
      };
      const found = c.srd ? monsterByName(c.srd) : null;
      if (found) ensureNpcForMonster(found.data, found.src, add); else add(null);
      n += c.count;
    });
    toast(`${n} musuh ditambahkan ke Battle.`);
  }

  // ---------- Pencarian cepat (Ctrl+K) ----------
  function quickSearch() {
    let ov = document.getElementById('cxQuick');
    if (ov) { ov.remove(); return; }
    ov = document.createElement('div'); ov.className = 'cx-overlay'; ov.id = 'cxQuick';
    ov.innerHTML = `<div class="cx-modal card"><input id="cxqIn" placeholder="🔎 Cari spell, monster, item, villain, lore…" style="width:100%; font-size:16px;"><div id="cxqRes" class="cx-qres"></div></div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector('#cxqIn'), res = ov.querySelector('#cxqRes');
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.remove(); });
    const run = () => {
      const q = inp.value.trim().toLowerCase(); if (!q) { res.innerHTML = ''; return; }
      const hits = [];
      allSpells().forEach(e => e.data.n.toLowerCase().includes(q) && hits.push({ k: 'spells', e }));
      allMonsters().forEach(e => e.data.n.toLowerCase().includes(q) && hits.push({ k: 'monsters', e }));
      allItems().forEach(e => e.data.n.toLowerCase().includes(q) && hits.push({ k: 'items', e }));
      Object.values(state.codex || {}).forEach(c => (c.name || '').toLowerCase().includes(q) && hits.push({ k: 'codex', c }));
      res.innerHTML = hits.slice(0, 12).map((h, i) => {
        if (h.k === 'codex') return `<details class="cx-qitem"><summary>${TYPE_CONF[h.c.type === 'location' ? 'lore' : h.c.type].icon} ${esc(h.c.name)} <span class="hint">${esc(h.c.type)}</span></summary><p>${esc(h.c.desc)}</p><p>${esc(h.c.plan)}</p><p class="hint">🔒 ${esc(h.c.secret)}</p></details>`;
        const icon = h.k === 'spells' ? '✨' : h.k === 'monsters' ? '👹' : '🎒';
        return `<details class="cx-qitem"><summary>${icon} ${esc(h.e.data.n)} <span class="hint">${h.k === 'spells' ? (h.e.data.lvl === 0 ? 'Cantrip' : 'Lv ' + h.e.data.lvl) : h.k === 'monsters' ? 'CR ' + h.e.data.cr : h.e.data.rarity}</span></summary>${detailHtml(h.k, h.e)}</details>`;
      }).join('') || '<p class="hint">Tidak ada hasil.</p>';
    };
    inp.addEventListener('input', run); inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.remove(); });
    inp.focus();
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); quickSearch(); }
  });

  // ---------- Event delegation ----------
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, key = el.dataset.key;
    switch (act) {
      case 'sub': ui.sub = el.dataset.sub; render(); break;
      case 'kind': ui.kind = el.dataset.kind; ui.sel = null; ui.q = ''; ui.crf = ui.lvl = ui.cls = ui.itype = ui.rar = 'all'; render(); break;
      case 'pick': ui.sel = key; refreshLib(); break;
      case 'lib-del': if (confirm('Hapus entri custom ini?')) { socket.emit('dm:library-delete', { code: CODE, kind: el.dataset.kind, id: el.dataset.id }); ui.sel = null; } break;
      case 'mon-npc': { const e = findEntry('monsters', key); if (!e) break; socket.emit('dm:save-npc', { code: CODE, npc: Codex.monsterToNpc(e.data, { source: e.src }) }, (r) => toast(r && r.ok ? '👹 NPC dibuat — lihat tab NPC.' : 'Gagal membuat NPC.')); break; }
      case 'mon-battle': { const e = findEntry('monsters', key); if (!e) break; const m = e.data;
        ensureNpcForMonster(m, e.src, (npc) => {
          const roll = d20() + mod(m.s[1]);
          const entry = npc ? npcBattleEntry(npc, m.n, roll) : { name: m.n, type: 'enemy', roll, initiative: mod(m.s[1]), hp_max: m.hp, hp_current: m.hp, ac: m.ac };
          socket.emit('dm:battle-add', { code: CODE, entry }, () => toast('⚔ ' + m.n + ' masuk Battle.'));
        }); break; }
      case 'mon-enc': { const e = findEntry('monsters', key); if (!e) break; addToEncounter(encCreatureFromMonster(e.data)); toast('🧮 ' + e.data.n + ' ditambahkan ke Encounter.'); break; }
      case 'spell-send': { const e = findEntry('spells', key); if (!e) break; const s = e.data;
        const to = (document.getElementById('cxSendTo') || {}).value || '';
        const text = `${s.lvl === 0 ? 'Cantrip' : 'Level ' + s.lvl} ${s.sc}\nCasting: ${s.cast} · Range: ${s.rng}\nKomponen: ${s.comp} · Durasi: ${s.dur}\n\n${s.d}`;
        socket.emit('dm:handout-send', { code: CODE, playerId: to || null, title: '✨ ' + s.n, text }, (r) => toast(r && r.ok ? '📜 Spell dikirim.' : 'Gagal mengirim.')); break; }
      case 'item-shop': { const e = findEntry('items', key); if (!e) break; const it = e.data;
        socket.emit('dm:shop-save-item', { code: CODE, item: { nama: it.n, harga: it.price, tipe: it.type, stok: '', deskripsi: it.d, efekTipe: (it.fx && it.fx[0]) || 'misc', efekFormula: (it.fx && it.fx[1]) || '' } }, (r) => toast(r && r.ok ? '🛒 Masuk Shop.' : ((r && r.error) || 'Gagal.'))); break; }
      case 'item-give': { const e = findEntry('items', key); if (!e) break; const to = (document.getElementById('cxSendTo') || {}).value;
        if (!to) return toast('Belum ada pemain di sesi ini.');
        socket.emit('dm:give-item', { code: CODE, playerId: to, name: e.data.n, qty: 1, desc: e.data.d }, (r) => toast(r && r.ok ? '🎁 Item diberikan.' : ((r && r.error) || 'Gagal.'))); break; }
      case 'sample': render(); document.getElementById('cxPaste').value = el.dataset.what === 'mon' ? SAMPLE_MON : SAMPLE_SPELL; break;
      case 'parse': doParse(); break;
      case 'paste-save': if (parsed) socket.emit('dm:library-save', { code: CODE, kind: parsed.kind, entry: parsed.data }, (r) => {
        if (r && r.ok) { toast('💾 Tersimpan ke library.'); ui.kind = parsed.kind; ui.sub = 'library'; ui.sel = 'c:' + r.id; ui.q = ''; render(); } else alert((r && r.error) || 'Gagal.'); }); break;
      case 'paste-npc': if (parsed && parsed.kind === 'monsters') {
        socket.emit('dm:library-save', { code: CODE, kind: 'monsters', entry: parsed.data });
        socket.emit('dm:save-npc', { code: CODE, npc: Codex.monsterToNpc(parsed.data, { source: 'Paste & Go' }) }, (r) => toast(r && r.ok ? '👹 Disimpan ke library & NPC.' : 'Gagal.')); } break;
      case 'race-new': openRaceForm(); break;
      case 'race-edit': openRaceForm((state.races || {})[el.dataset.id]); break;
      case 'race-del': if (confirm('Hapus ras ini? Pemain yang sudah memakainya tidak terpengaruh.')) socket.emit('dm:race-delete', { code: CODE, id: el.dataset.id }); break;
      case 'entry-new': openEntryForm(el.dataset.group === 'lore' ? 'lore' : el.dataset.group); break;
      case 'entry-edit': openEntryForm(null, state.codex[el.dataset.id]); break;
      case 'entry-del': if (confirm('Hapus entri ini?')) socket.emit('dm:codex-delete', { code: CODE, id: el.dataset.id }); break;
      case 'villain-toggle': { const e = state.codex[el.dataset.id]; if (!e) break; socket.emit('dm:codex-save', { code: CODE, entry: Object.assign({}, e, { imageUrl: undefined, status: e.status === 'defeated' ? 'aktif' : 'defeated' }) }); break; }
      case 'villain-battle': { const e = state.codex[el.dataset.id]; if (!e) break; socket.emit('dm:battle-add', { code: CODE, entry: villainToBattleEntry(e) }, () => toast('⚔ ' + e.name + ' masuk Battle.')); break; }
      case 'villain-npc': { const e = state.codex[el.dataset.id]; if (!e) break;
        const ab = { str: '10', dex: '10', con: '10', int: '10', wis: '10', cha: '10' };
        socket.emit('dm:save-npc', { code: CODE, npc: { nama: e.name, tipe: (e.rank || 'Villain') + ' (villain)', ac: e.ac || '', ability: ab, initiative: '0', hp_max: e.hp || '', hp_current: e.hp || '', mp_max: '', mp_current: '', sp_max: '', sp_current: '', skills: '', catatan: [e.desc, e.plan && 'Rencana: ' + e.plan].filter(Boolean).join('\n'), elements: {}, equipment: [], inventory: [], skillSet: { active: [], passive: [], ultimate: [] }, relationships: {} } }, (r) => toast(r && r.ok ? '👹 NPC dibuat.' : 'Gagal.')); break; }
      case 'cal-adv': socket.emit('dm:calendar-advance', { code: CODE, days: parseInt(el.dataset.n, 10) }, (r) => {
        if (r && r.triggered && r.triggered.length) alert('📅 Event terlewati:\n' + r.triggered.map(t => '• ' + t.title + (t.desc ? ' — ' + t.desc : '')).join('\n')); }); ui.view.y = null; break;
      case 'cal-set': socket.emit('dm:calendar-set', { code: CODE, year: document.getElementById('cxcY').value, month: document.getElementById('cxcM').value, day: document.getElementById('cxcD').value }); ui.view.y = null; break;
      case 'cal-config': openCalConfig(); break;
      case 'cal-view': { const c = cal(); ui.view.m += parseInt(el.dataset.n, 10);
        if (ui.view.m < 0) { ui.view.m = c.months.length - 1; ui.view.y--; } else if (ui.view.m >= c.months.length) { ui.view.m = 0; ui.view.y++; }
        ui.calDay = null; renderCalendar(); break; }
      case 'cal-day': ui.calDay = parseInt(el.dataset.day, 10); renderCalendar(); break;
      case 'cal-evsave': { const t = document.getElementById('cxeT').value.trim(); if (!t) return toast('Isi judul event.');
        socket.emit('dm:calendar-event-save', { code: CODE, event: { title: t, desc: document.getElementById('cxeD').value, year: ui.view.y, month: ui.view.m, day: ui.calDay || cal().day } }, (r) => { if (!r || !r.ok) alert((r && r.error) || 'Gagal.'); }); break; }
      case 'cal-evdel': socket.emit('dm:calendar-event-delete', { code: CODE, id: el.dataset.id }); break;
      case 'enc-rm': ui.enc.creatures.splice(parseInt(el.dataset.i, 10), 1); renderEncounter(); break;
      case 'enc-clear': ui.enc = { name: '', creatures: [], partyText: ui.enc.partyText, loadedId: null }; renderEncounter(); break;
      case 'enc-start': startEncounter(); break;
      case 'enc-save': { const name = document.getElementById('cxEncName').value.trim(); if (!name) return toast('Isi nama encounter.');
        socket.emit('dm:encounter-save', { code: CODE, encounter: { id: ui.enc.loadedId, name, creatures: ui.enc.creatures } }, (r) => { if (r && r.ok) { ui.enc.loadedId = r.id; ui.enc.name = name; toast('💾 Encounter tersimpan.'); } else alert((r && r.error) || 'Gagal.'); }); break; }
      case 'enc-load': { const s = state.encounters[el.dataset.id]; if (!s) break; ui.enc = { name: s.name, creatures: JSON.parse(JSON.stringify(s.creatures)), partyText: ui.enc.partyText, loadedId: s.id }; renderEncounter(); break; }
      case 'enc-del': if (confirm('Hapus encounter tersimpan ini?')) socket.emit('dm:encounter-delete', { code: CODE, id: el.dataset.id }); break;
      case 'enc-pick': { const r = encSources(document.getElementById('cxEncQ').value)[parseInt(el.dataset.i, 10)]; if (r) { addToEncounter(r.c); renderEncounter(); } break; }
    }
  });
  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset && el.dataset.bind) { ui[el.dataset.bind] = el.value; refreshLib(); return; }
    if (el.id === 'cxEncQ') {
      const res = document.getElementById('cxEncRes'), hits = encSources(el.value);
      res.style.display = hits.length ? '' : 'none';
      res.innerHTML = hits.map((h, i) => `<div class="cx-item" data-act="enc-pick" data-i="${i}">${esc(h.label)}</div>`).join('');
    }
    if (el.id === 'cxParty') { ui.enc.partyText = el.value; clearTimeout(ui._pt); ui._pt = setTimeout(() => { const pos = el.selectionStart; renderEncounter(); const n = document.getElementById('cxParty'); n.focus(); n.setSelectionRange(pos, pos); }, 350); }
    if (el.id === 'cxEncName') ui.enc.name = el.value;
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset && el.dataset.actIn === 'enc-count') { ui.enc.creatures[parseInt(el.dataset.i, 10)].count = Math.max(1, Math.min(50, parseInt(el.value, 10) || 1)); renderEncounter(); }
  });

  // ---------- Sinkronisasi dari server ----------
  const visible = () => root.style.display !== 'none';
  socket.on('races-update', (r) => { state.races = r; if (visible() && ui.sub === 'races') renderRaces(); });
  socket.on('library-update', (l) => { state.library = l; if (visible() && ui.sub === 'library') refreshLib(); });
  socket.on('codex-update', (c) => { state.codex = c; if (visible() && ['villain', 'faction', 'lore'].includes(ui.sub)) renderEntries(ui.sub); });
  socket.on('calendar-update', (c) => { state.calendar = c; if (visible() && ui.sub === 'calendar') renderCalendar(); });
  socket.on('encounters-update', (e) => { state.encounters = e; if (visible() && ui.sub === 'encounter') renderEncounter(); });

  window.CodexUI = {
    onShow() { render(); },
    quickSearch
  };
})();
