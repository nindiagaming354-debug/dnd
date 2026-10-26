// server.js — DnD VTT + Character Sheet server
// Jalankan dengan: npm install && npm start
// Buka di browser: http://localhost:3000

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100mb, biar upload gambar map muat

const PORT = process.env.PORT || 3000;

// ---------- Penyimpanan lokal (file JSON) ----------
// Semua sesi disimpan di data/sessions.json — tanpa database, tanpa akun, tanpa cloud.
const fs = require('fs');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const BACKUP_FILE = path.join(DATA_DIR, 'sessions.backup.json');

app.use(express.static(path.join(__dirname, 'public')));

/** @type {Record<string, Session>} */
let sessions = {};

function loadSessions() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Gagal membuat folder data:', e.message);
  }
  // Coba file utama dulu, kalau rusak coba backup
  for (const file of [DATA_FILE, BACKUP_FILE]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trim()) continue;
      const parsed = JSON.parse(raw);
      sessions = (parsed && typeof parsed === 'object') ? parsed : {};
      console.log(`Loaded ${Object.keys(sessions).length} sesi dari ${path.basename(file)}.`);
      return;
    } catch (e) {
      console.error(`Gagal baca ${path.basename(file)}:`, e.message);
    }
  }
  sessions = {};
  console.log('Belum ada data tersimpan, mulai dari kosong.');
}

// Tulis atomik: tulis ke file sementara, lalu rename — supaya file tidak rusak kalau PC mati mendadak.
let writing = false;
let writeAgain = false;
function writeAllToDisk() {
  if (writing) { writeAgain = true; return; }
  writing = true;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(sessions));
    if (fs.existsSync(DATA_FILE)) {
      try { fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch (e) {}
    }
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('Gagal simpan data ke disk:', e.message);
  } finally {
    writing = false;
    if (writeAgain) { writeAgain = false; setImmediate(writeAllToDisk); }
  }
}

// Dipertahankan agar semua pemanggil lama tetap jalan
async function saveSession(code) {
  if (!sessions[code]) return;
  writeAllToDisk();
}

async function deleteSession(code) {
  delete sessions[code];
  writeAllToDisk();
}

let saveTimer = null;
function saveSessionsDebounced(/* code (diabaikan: semua sesi satu file) */) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeAllToDisk, 300);
}

// Simpan terakhir kali saat server dimatikan (Ctrl+C)
function flushAndExit() {
  clearTimeout(saveTimer);
  writeAllToDisk();
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.values(nets).forEach(list => (list || []).forEach(n => {
    if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }));
  return out;
}

// Inisialisasi: load sesi dari file lokal lalu jalankan server
loadSessions();
Object.values(sessions).forEach(ensureSessionDefaults);
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  DnD VTT (mode lokal) siap dipakai');
  console.log(`  Di komputer ini : http://localhost:${PORT}`);
  lanAddresses().forEach(ip => console.log(`  Pemain (WiFi sama): http://${ip}:${PORT}`));
  console.log(`  Data tersimpan di: ${DATA_FILE}`);
  console.log('========================================');
});

// ---------- Helpers ----------
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa karakter yg gampang ketuker
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (sessions[code]);
  return code;
}

function genId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

// ---------- Kelas (class) helpers ----------
function blankClassSkills() {
  return { active: [], passive: [], ultimate: [] };
}

// Migrasi/pastikan struktur data lama (sessions.json sebelum fitur kelas & gold) tetap jalan
function blankMusic() {
  return {
    tracks: {},
    playback: { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: 0.7, loop: false }
  };
}

// ---------- Story-telling: scene banner, dialog NPC, quest tracker ----------
function blankStory() {
  return {
    scene: { title: '', desc: '', imageUrl: null, active: false, updatedAt: 0 },
    dialogue: { npcName: '', npcPortrait: null, text: '', active: false, updatedAt: 0 },
    quests: {}
  };
}

// ---------- Survival: hunger & thirst ----------
function blankSurvival() {
  return { hunger: 100, hunger_max: 100, thirst: 100, thirst_max: 100 };
}

// Lapar/haus di bawah 50% -> pelemahan tempur. Dihitung dari sheet player (bukan battle entry),
// jadi berlaku baik dia jadi actor (aksinya kurang efektif) maupun buat indikator status di UI.
const SURVIVAL_DEBUFF_RATIO = 0.5; // ambang batas 50%
const SURVIVAL_DEBUFF_PCT_PER_STACK = 0.15; // tiap kondisi lemah (lapar ATAU haus) motong 15% efektivitas aksi
function survivalDebuffInfo(session, playerId) {
  const empty = { labels: [], count: 0 };
  if (!playerId || !session.players[playerId]) return empty;
  const surv = session.players[playerId].sheet.survival;
  if (!surv) return empty;
  const labels = [];
  const hMax = parseFloat(surv.hunger_max) || 100;
  const tMax = parseFloat(surv.thirst_max) || 100;
  const hCur = parseFloat(surv.hunger) || 0;
  const tCur = parseFloat(surv.thirst) || 0;
  if (hMax > 0 && hCur / hMax < SURVIVAL_DEBUFF_RATIO) labels.push('Kelaparan');
  if (tMax > 0 && tCur / tMax < SURVIVAL_DEBUFF_RATIO) labels.push('Kehausan');
  return { labels, count: labels.length };
}

// Deteksi link YouTube (watch, youtu.be, shorts, embed) dan ambil video ID-nya.
function extractYoutubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function ensureSessionDefaults(session) {
  if (!session.classes) session.classes = {};
  if (!session.recipes) session.recipes = {};
  if (!session.music) session.music = blankMusic();
  if (!session.music.playback) session.music.playback = blankMusic().playback;
  if (!session.shop) session.shop = { items: {} };
  if (!session.npcs) session.npcs = {};
  if (!session.battle) session.battle = { entries: {}, turn: { activeId: null, round: 1 }, stats: {} };
  if (!session.battle.stats) session.battle.stats = {};
  if (!session.story) session.story = blankStory();
  if (!session.story.scene) session.story.scene = blankStory().scene;
  if (!session.story.dialogue) session.story.dialogue = blankStory().dialogue;
  if (!session.story.quests) session.story.quests = {};
  // Migrasi quest lama (sebelum fitur "ambil quest") biar punya daftar player yang ambil/selesaikan
  Object.values(session.story.quests).forEach(q => { if (!q.acceptedBy) q.acceptedBy = {}; });
  // Migrasi peta lama (1 map + 1 dict token flat) -> banyak map, tiap map punya token & fog sendiri.
  // Biar bisa DM benar-benar bikin "Map 2", "Map 3" dst (mis. per lantai dungeon) tanpa numpuk token lintas map.
  if (!session.maps) {
    const legacyMap = session.map || {};
    const mainMap = newMap('Map 1');
    mainMap.id = 'main';
    Object.assign(mainMap, legacyMap);
    mainMap.tokens = session.tokens || {};
    if (!mainMap.fogRevealed) mainMap.fogRevealed = {};
    session.maps = { main: mainMap };
    session.activeMapId = 'main';
    delete session.map;
    delete session.tokens;
  }
  if (!session.maps[session.activeMapId]) session.activeMapId = Object.keys(session.maps)[0];
  Object.values(session.maps).forEach(m => {
    if (!m.tokens) m.tokens = {};
    if (!m.fogRevealed) m.fogRevealed = {};
    if (!Array.isArray(m.walls)) m.walls = [];
    if (!Array.isArray(m.lights)) m.lights = [];
    if (!m.lighting || typeof m.lighting !== 'object') m.lighting = { enabled: false, darkness: 0.85, visionPct: 22, resetAt: 0 };
    if (!m.spotlight || typeof m.spotlight !== 'object') m.spotlight = { active: false, x: 50, y: 50, zoom: 2 };
  });
  if (!session.races || typeof session.races !== 'object') session.races = {}; // ras homebrew buatan DM
  if (!session.library) session.library = { monsters: {}, spells: {} };
  if (!session.codex) session.codex = {};
  if (!session.library.monsters) session.library.monsters = {};
  if (!session.library.spells) session.library.spells = {};
  if (!session.calendar) session.calendar = defaultCalendar();
  if (!session.encounters) session.encounters = {};
  Object.values(session.players || {}).forEach(ensurePlayerDefaults);
  return session;
}
// ---------- Geometri peta: dinding, pintu, lampu ----------
const MAX_WALLS = 5000, MAX_LIGHTS = 300;
function clampPct(v) { v = parseFloat(v); return isNaN(v) ? 0 : Math.max(0, Math.min(100, v)); }
function cleanWall(w) {
  return {
    id: genId('w'),
    x1: clampPct(w.x1), y1: clampPct(w.y1), x2: clampPct(w.x2), y2: clampPct(w.y2),
    kind: w.kind === 'door' ? 'door' : 'wall',
    open: w.kind === 'door' ? !!w.open : false,
    locked: w.kind === 'door' ? !!w.locked : false,
    // Pintu satu arah: 0 = biasa, 1 / -1 = hanya bisa dilewati searah (lihat clampMoveByWalls)
    oneWay: w.kind === 'door' ? (w.oneWay > 0 ? 1 : (w.oneWay < 0 ? -1 : 0)) : 0
  };
}
function cleanLight(l) {
  return { id: genId('lt'), x: clampPct(l.x), y: clampPct(l.y), radius: Math.max(2, Math.min(100, parseFloat(l.radius) || 18)) };
}
// Titik potong ruas A(p->q) dengan ruas B(a->b); t = posisi di ruas A (0..1), atau null.
function segHitT(px, py, qx, qy, ax, ay, bx, by) {
  const rX = qx - px, rY = qy - py, sX = bx - ax, sY = by - ay;
  const den = rX * sY - rY * sX;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((ax - px) * sY - (ay - py) * sX) / den;
  const u = ((ax - px) * rY - (ay - py) * rX) / den;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : null;
}
// Gerakan token player berhenti tepat sebelum dinding / pintu tertutup pertama yang dilewati.
function clampMoveByWalls(map, fx, fy, tx, ty) {
  let best = null;
  (map.walls || []).forEach(w => {
    if (w.kind === 'door' && w.open) return;
    // Pintu satu arah: boleh ditembus kalau arah gerak sesuai tanda (cross product vektor pintu x vektor gerak)
    if (w.kind === 'door' && w.oneWay) {
      const cross = (w.x2 - w.x1) * (ty - fy) - (w.y2 - w.y1) * (tx - fx);
      if ((cross > 0 ? 1 : -1) === w.oneWay) return;
    }
    const t = segHitT(fx, fy, tx, ty, w.x1, w.y1, w.x2, w.y2);
    if (t !== null && (best === null || t < best)) best = t;
  });
  if (best === null) return { x: tx, y: ty, blocked: false };
  const len = Math.hypot(tx - fx, ty - fy) || 1;
  const t = Math.max(0, best - 0.4 / len); // mundur 0.4% dari dinding
  return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t, blocked: true };
}

// ---------- Kalender dunia ----------
function defaultCalendar() {
  return {
    year: 1, month: 0, day: 1,
    months: ['Bulan 1','Bulan 2','Bulan 3','Bulan 4','Bulan 5','Bulan 6','Bulan 7','Bulan 8','Bulan 9','Bulan 10','Bulan 11','Bulan 12'].map(n => ({ name: n, days: 30 })),
    events: {}
  };
}

// Bikin objek map baru (dipakai pas create-session & pas DM klik "+ Map Baru")
function newMap(name) {
  return {
    id: genId('map'), name: name || 'Map',
    imageUrl: null, width: null, height: null,
    gridSize: 50, gridVisible: true, offsetX: 0, offsetY: 0,
    fogVisible: false, fogRevealed: {}, tokens: {},
    walls: [], lights: [],
    lighting: { enabled: false, darkness: 0.85, visionPct: 22, resetAt: 0 },
    spotlight: { active: false, x: 50, y: 50, zoom: 2 }
  };
}
function activeMap(session) { return session.maps[session.activeMapId]; }
// Daftar ringkas map buat kirim tab list ke client (gak perlu kirim semua token/fog tiap map sekaligus)
function mapTabList(session) {
  return Object.values(session.maps).map(m => ({ id: m.id, name: m.name }));
}
function ensurePlayerDefaults(player) {
  if (!Array.isArray(player.unlockedClasses)) player.unlockedClasses = [];
  if (!Array.isArray(player.sheet.companions)) player.sheet.companions = [];
  if (!Array.isArray(player.sheet.buffs)) player.sheet.buffs = [];
  // Migrate pet -> companion
  if (player.sheet.pet && player.sheet.pet.nama && !player.sheet.companions.length) {
    player.sheet.companions.push({
      nama: player.sheet.pet.nama, tipe: player.sheet.pet.tipe || '',
      level: player.sheet.pet.level || '', hp: player.sheet.pet.hp || '',
      hp_max: player.sheet.pet.hp || '', mp: player.sheet.pet.mp || '',
      mp_max: player.sheet.pet.mp || '', skill: player.sheet.pet.skill || '',
      catatan: player.sheet.pet.catatan || '', fromDM: false
    });
    delete player.sheet.pet;
  }
  // Skills migration: passive was 5 -> now 2
  if (player.sheet.skills && Array.isArray(player.sheet.skills.passive) && player.sheet.skills.passive.length > 2) {
    player.sheet.skills.passive = player.sheet.skills.passive.slice(0, 2);
  }
  // Inventory: cap slot dasar 10 + slot tambahan pemberian DM (data lama yang lebih banyak tetap dipertahankan,
  // tapi gak akan bisa nambah lagi dari sisi player kalau udah lewat cap - itu diatur di client + validasi update-sheet)
  if (!Array.isArray(player.sheet.inventory)) player.sheet.inventory = [];
  if (typeof player.sheet.inv_extra_slots !== 'number') player.sheet.inv_extra_slots = parseInt(player.sheet.inv_extra_slots, 10) || 0;
  // Survival: lapar & haus (data lama sebelum fitur ini otomatis dikasih nilai penuh)
  if (!player.sheet.survival || typeof player.sheet.survival !== 'object') player.sheet.survival = blankSurvival();
  ['hunger','hunger_max','thirst','thirst_max'].forEach(k => {
    if (typeof player.sheet.survival[k] !== 'number' || isNaN(player.sheet.survival[k])) {
      player.sheet.survival[k] = blankSurvival()[k];
    }
  });
  return player;
}

const INV_BASE_SLOTS = 10;
function invMaxSlotsForPlayer(player) {
  return INV_BASE_SLOTS + (parseInt(player.sheet.inv_extra_slots, 10) || 0);
}

function blankSheet(name) {
  return {
    nama_karakter: name || '',
    kelas: '', ras: '', alignment: '', lv: '', exp: '', kelas_exp: '',
    ability: {
      str: { score: '', mod: '', save: '' },
      con: { score: '', mod: '', save: '' },
      dex: { score: '', mod: '', save: '' },
      cha: { score: '', mod: '', save: '' },
      wis: { score: '', mod: '', save: '' },
      int: { score: '', mod: '', save: '' }
    },
    ac: '', initiative: '',
    max_hp: '', current_hp: '', temp_hp: '',
    mp_max: '', mp_current: '', sp_max: '', sp_current: '',
    condition: [],
    condition_other: '',
    survival: blankSurvival(),
    death_count: [false, false, false],
    goal: '',
    equipment: [
      { nama: '', tipe: '', atk_bonus: '', damage: '', catatan: '' },
      { nama: '', tipe: '', atk_bonus: '', damage: '', catatan: '' }
    ],
    gears: ['helmet','armor','gloves','boots','accessory1','accessory2','necklace','artifact']
      .map(key => ({ key, item: '', stat: '', amount: '', equipped: false })),
    extra_weapon: [
      { nama: '', atk_bonus: '', damage: '' },
      { nama: '', atk_bonus: '', damage: '' }
    ],
    inventory: Array.from({ length: 6 }, () => ({ checked: false, item: '', desc: '', type: 'misc', qty: 1 })), // cap 10 slot di client, DM bisa kasih slot tambahan
    inv_extra_slots: 0, // slot tambahan yang dikasih DM (di atas 10 slot dasar)
    gold: '',
    companions: [],
    skills: {
      active: Array.from({ length: 5 }, () => ({ nama: '', rank: '', mp_cost: '', sp_cost: '', formula: '', action: 'damage', statusEffect: '', desc: '' })),
      passive: Array.from({ length: 2 }, () => ({ nama: '', rank: '', mp_cost: '', sp_cost: '', formula: '', action: 'buff', statusEffect: '', desc: '' })),
      ultimate: Array.from({ length: 2 }, () => ({ nama: '', rank: '', mp_cost: '', sp_cost: '', formula: '', action: 'ultimate', statusEffect: '', desc: '' }))
    },
    buffs: [],
    // race_trait sekarang array of {nama, stat, amount} — trait bawaan ras yang beneran ngefek ke
    // AC/HP/MP/SP/ATK/DEF (dihitung bareng gear & buff di client). Sheet lama (array of string,
    // sebelum fitur ini) otomatis dikonversi jadi {nama: string, stat:'', amount:''} di client.
    race_trait: Array.from({ length: 4 }, () => ({ nama: '', stat: '', amount: '' })),
    class_trait: { fire: '', ice: '', lightning: '', wind: '', earth: '', water: '', poison: '', dark: '', light: '', physical: '', magic: '' },
    catatan_lain: ''
  };
}

function sortedBattleList(session) {
  const entries = Object.values((session.battle && session.battle.entries) || {});
  return entries.sort((a, b) => {
    const rb = parseFloat(b.roll) || 0, ra = parseFloat(a.roll) || 0;
    if (rb !== ra) return rb - ra;
    return (a.name || '').localeCompare(b.name || '');
  });
}

// Death saving throw ala 5e: HP nyentuh 0 -> status "Sekarat" (gak bisa aksi, harus roll d20 tiap
// giliran: >=10 sukses, <10 gagal, natural 1 = 2 gagal sekaligus, natural 20 = langsung sadar HP 1).
// 3 sukses -> "Stabil" (gak sadar tapi gak akan mati lagi). 3 gagal -> "Mati".
function checkDeathState(entry, prevHp) {
  const hp = parseFloat(entry.hp_current);
  if (isNaN(hp)) return;
  if (!Array.isArray(entry.conditions)) entry.conditions = [];
  if (hp <= 0) {
    const already = entry.conditions.includes('Sekarat') || entry.conditions.includes('Stabil') || entry.conditions.includes('Mati');
    if (!already) {
      entry.conditions.push('Sekarat');
      entry.death_saves = { success: 0, fail: 0 };
    }
  } else if (hp > 0 && prevHp !== null && prevHp <= 0) {
    // Sembuh dari 0 HP -> hapus semua status sekarat/stabil/mati & reset hitungan save.
    entry.conditions = entry.conditions.filter(c => !['Sekarat', 'Stabil', 'Mati'].includes(c));
    entry.death_saves = null;
  }
}

// Kondisi "fatal" = karakter gak bisa bertindak sama sekali giliran itu (kaya RPG pada umumnya:
// Stunned/Frozen/Sleep/Paralyzed), jadi battleAdvance otomatis melompati mereka.
const FATAL_CONDITIONS = ['Stunned', 'Frozen', 'Sleep', 'Paralyzed', 'Sekarat', 'Stabil', 'Mati'];
function battleAdvance(session, dir) {
  const list = sortedBattleList(session);
  if (!list.length) return { skipped: [] };
  const turn = session.battle.turn;
  let idx = list.findIndex(e => e.id === turn.activeId);
  if (idx === -1) {
    // belum ada giliran aktif (atau entri sebelumnya sudah dihapus) -> mulai dari awal/akhir
    idx = dir > 0 ? -1 : list.length;
  }
  const skipped = [];
  for (let i = 0; i < list.length; i++) {
    idx += dir;
    if (idx >= list.length) { idx = 0; turn.round += 1; }
    if (idx < 0) { idx = list.length - 1; turn.round = Math.max(1, turn.round - 1); }
    const candidate = list[idx];
    const isFatal = Array.isArray(candidate.conditions) && candidate.conditions.some(c => FATAL_CONDITIONS.includes(c));
    // Kalau semua peserta lain juga fatal (i sudah di iterasi terakhir), tetap jatuhkan giliran ke dia
    // biar battle gak macet total.
    if (isFatal && i < list.length - 1) { skipped.push(candidate.name); continue; }
    turn.activeId = candidate.id;
    return { skipped };
  }
  turn.activeId = list[idx].id;
  return { skipped };
}

function publicPlayerList(session) {
  return Object.values(session.players).map(p => ({
    id: p.id,
    name: p.name,
    online: !!p.socketId,
    nama_karakter: p.sheet.nama_karakter,
    kelas: p.sheet.kelas,
    lv: p.sheet.lv,
    current_hp: p.sheet.current_hp,
    max_hp: p.sheet.max_hp,
    portrait: p.sheet.portrait || null
  }));
}

// Samakan gambar token milik seorang player di SEMUA map dengan portrait
// terbaru sheet-nya — kecuali token itu sudah dikasih gambar token custom
// sendiri oleh DM (autoPortrait === false), yang tetap dihormati.
function syncPlayerPortraitToTokens(session, playerId, portrait) {
  let touchedActiveMap = false;
  Object.values(session.maps || {}).forEach(m => {
    Object.values(m.tokens || {}).forEach(tok => {
      if (tok.ownerId === playerId && tok.autoPortrait !== false) {
        tok.imageUrl = portrait || null;
        tok.autoPortrait = true;
        if (m === activeMap(session)) touchedActiveMap = true;
      }
    });
  });
  return touchedActiveMap;
}

function sessionStateForDM(session) {
  return {
    code: session.code,
    players: session.players,
    npcs: session.npcs,
    classes: session.classes || {},
    recipes: session.recipes || {},
    maps: mapTabList(session),
    activeMapId: session.activeMapId,
    map: activeMap(session),
    tokens: activeMap(session).tokens,
    battle: session.battle,
    music: session.music,
    story: session.story,
    shop: session.shop || { items: {} },
    log: session.log.slice(-100),
    notes: session.notes || '',
    library: session.library,
    races: session.races || {},
    codex: session.codex,
    calendar: session.calendar,
    encounters: session.encounters
  };
}

function sessionStateForPlayer(session, playerId) {
  return {
    code: session.code,
    me: session.players[playerId],
    players: publicPlayerList(session),
    playersList: publicPlayerList(session),
    classes: session.classes || {},
    races: session.races || {},
    recipes: session.recipes || {},
    maps: mapTabList(session),
    activeMapId: session.activeMapId,
    map: activeMap(session),
    tokens: activeMap(session).tokens,
    battle: session.battle,
    music: session.music,
    story: session.story,
    shop: session.shop || { items: {} },
    // Log biasa (!secret) buat semua player, DITAMBAH pesan pribadi (secret + toPlayerId) yang
    // memang ditujukan ke player ini — biar tetap ada pas dia reconnect/refresh.
    log: session.log.filter(e => !e.secret || e.toPlayerId === playerId).slice(-100)
  };
}

// ---------- Dice formula helper (dipakai server utk aksi roll battle) ----------
function rollFormulaServer(formula) {
  const str = String(formula || '').replace(/\s+/g, '');
  // jumlahkan semua suku: "2d10+8+2d6+1d4-1" (tiap suku NdM atau angka tetap)
  const terms = str.match(/[+-]?(?:\d*d\d+|\d+)/gi);
  if (!terms) return { total: 0, detail: '0' };
  let total = 0, parts = [], diceCount = 0;
  terms.forEach(t => {
    const sign = t[0] === '-' ? -1 : 1;
    const body = t.replace(/^[+-]/, '');
    const dm = body.match(/^(\d*)d(\d+)$/i);
    if (dm) {
      const n = Math.min(100, Math.max(1, parseInt(dm[1] || '1', 10)) );
      const sides = Math.max(1, parseInt(dm[2], 10));
      const rolls = [];
      for (let i = 0; i < n && diceCount < 200; i++, diceCount++) { const r = 1 + Math.floor(Math.random() * sides); rolls.push(r); total += sign * r; }
      parts.push((sign < 0 ? '-' : '') + '(' + rolls.join('+') + ')');
    } else {
      const v = parseInt(body, 10); total += sign * v; parts.push((sign < 0 ? '-' : '+') + v);
    }
  });
  return { total, detail: parts.join('+').replace(/\+\+/g, '+').replace(/\+-/g, '-').replace(/^\+/, '') };
}

// Aksi roll battle: tiap actionType memetakan ke field mana di battle entry yang berubah
const BATTLE_ACTION_MAP = {
  damage:     { field: 'hp_current', sign: -1, maxField: 'hp_max' },
  ultimate:   { field: 'hp_current', sign: -1, maxField: 'hp_max' },
  heal:       { field: 'hp_current', sign: +1, maxField: 'hp_max' },
  mana_regen: { field: 'mp_current', sign: +1, maxField: 'mp_max' },
  sp_regen:   { field: 'sp_current', sign: +1, maxField: 'sp_max' },
  ac_buff:    { field: 'ac', sign: +1, maxField: null },
  ac_debuff:  { field: 'ac', sign: -1, maxField: null },
  buff:       null,
  debuff:     null
};
const BATTLE_ACTION_LABEL = {
  damage: 'Damage', ultimate: 'Ultimate', heal: 'Heal', buff: 'Buff', debuff: 'Debuff',
  mana_regen: 'Regen Mana', sp_regen: 'Regen SP', ac_buff: 'Buff AC', ac_debuff: 'Debuff AC'
};

// ---------- AoE targeting: targetId khusus "__aoe_enemy__" / "__aoe_ally__" / "__aoe_all__" ----------
// dikirim dari client kalau player/DM milih opsi "Semua Musuh/Sekutu" di dropdown target,
// jadi 1 skill/item/aksi otomatis kena ke banyak entry battle sekaligus (gak perlu diulang manual).
const AOE_GROUP_LABEL = { enemy: 'semua musuh', ally: 'semua sekutu', all: 'semua peserta' };
function aoeGroupFromTargetId(targetId) {
  if (typeof targetId !== 'string' || !targetId.startsWith('__aoe_')) return null;
  const group = targetId.slice('__aoe_'.length, targetId.length - 2); // buang prefix & '__' penutup
  return AOE_GROUP_LABEL[group] ? group : null;
}
function entryMatchesAoeGroup(entry, group) {
  if (group === 'enemy') return entry.type === 'enemy';
  if (group === 'ally') return entry.type === 'pc' || entry.type === 'ally';
  if (group === 'all') return true;
  return false;
}
// Balikin daftar id entry battle yang jadi sasaran (single id kalau bukan AoE, banyak id kalau AoE).
function resolveTargetIds(session, targetId) {
  const group = aoeGroupFromTargetId(targetId);
  if (group) {
    return Object.keys(session.battle.entries || {}).filter(id => entryMatchesAoeGroup(session.battle.entries[id], group));
  }
  return (session.battle.entries || {})[targetId] ? [targetId] : [];
}

// Jumlahkan modifier stat tertentu dari daftar buff/debuff sebuah sheet (mis. total DEF aktif).
function sumBuffStat(buffs, stat) {
  if (!Array.isArray(buffs)) return 0;
  let total = 0;
  buffs.forEach(b => {
    if (b && b.stat === stat) {
      const n = parseFloat(b.jumlah);
      if (!isNaN(n)) total += n;
    }
  });
  return total;
}

// Hitung nilai efek DOT dari field "jumlah", yang boleh diisi angka polos (mis. "5", "-3")
// ATAU formula dice (mis. "1d4+2", atau "-1d6" utk heal berbasis dice). Awalan "-" di depan
// formula dice berarti heal (dibalik jadi minus setelah dice-nya di-roll).
function resolveDotAmount(raw) {
  const str = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!str) return null;
  const isDice = /\d*d\d+/i.test(str);
  const isNegDice = isDice && str.startsWith('-');
  const roll = rollFormulaServer(isNegDice ? str.slice(1).trim() : str);
  const total = isNegDice ? -roll.total : roll.total;
  return { amount: total, detail: (isNegDice ? '-(' + roll.detail + ')' : roll.detail), isDice };
}

// Terapkan semua efek stat='dot' (Damage/Heal per Giliran) yang ada di sebuah daftar buff ke HP
// sebuah battle entry. Dipakai baik utk buff yang nempel di sheet player maupun buff yang nempel
// langsung di battle entry (NPC/ally/enemy), makanya nama/label log-nya diberi lewat parameter.
function applyDotBuffsToEntry(session, entry, buffs, displayName) {
  if (!entry || !Array.isArray(buffs) || !buffs.length) return;
  buffs.forEach(b => {
    if (!b) return;
    // DOT = damage per giliran (kurangi HP)
    if (b.stat === 'dot') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.hp_max);
      let next = (parseFloat(entry.hp_current) || 0) - amt;
      next = Math.max(0, next);
      if (!isNaN(max)) next = Math.min(next, max);
      entry.hp_current = next;
      const maxLabel = !isNaN(max) ? '/' + max : '';
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `☠ ${b.nama || 'DOT'} pada ${displayName}: HP berkurang ${amt} (${resolved.detail}) → HP jadi ${next}${maxLabel}.`,
        type: 'damage', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
    // HEAL DOT = regen HP per giliran (tambah HP)
    if (b.stat === 'heal_dot') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.hp_max);
      let next = (parseFloat(entry.hp_current) || 0) + amt;
      if (!isNaN(max)) next = Math.min(next, max);
      entry.hp_current = next;
      const maxLabel = !isNaN(max) ? '/' + max : '';
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `💚 ${b.nama || 'Heal OT'} pada ${displayName}: HP pulih ${amt} (${resolved.detail}) → HP jadi ${next}${maxLabel}.`,
        type: 'heal', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
    // MP regen per giliran
    if (b.stat === 'mp_regen') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.mp_max);
      let next = (parseFloat(entry.mp_current) || 0) + amt;
      if (!isNaN(max)) next = Math.min(next, max);
      entry.mp_current = next;
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `🔵 ${b.nama || 'MP Regen'} pada ${displayName}: MP pulih ${amt} → MP jadi ${next}${!isNaN(max)?'/'+max:''}.`,
        type: 'heal', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
    // SP regen per giliran
    if (b.stat === 'sp_regen') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.sp_max);
      let next = (parseFloat(entry.sp_current) || 0) + amt;
      if (!isNaN(max)) next = Math.min(next, max);
      entry.sp_current = next;
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `🟢 ${b.nama || 'SP Regen'} pada ${displayName}: SP pulih ${amt} → SP jadi ${next}${!isNaN(max)?'/'+max:''}.`,
        type: 'heal', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
  });
  // Sync ke sheet player jika entry adalah PC
  if (entry.refType === 'player' && session.players[entry.refId]) {
    const tp = session.players[entry.refId];
    tp.sheet.current_hp = entry.hp_current;
    tp.sheet.mp_current = entry.mp_current;
    tp.sheet.sp_current = entry.sp_current;
    if (tp.socketId) io.to(tp.socketId).emit('your-sheet-updated', { sheet: tp.sheet });
    io.to('dm-' + session.code).emit('sheet-updated', { playerId: tp.id, sheet: tp.sheet });
  }
}

// Umumkan di log kalau ada peserta yang gilirannya dilewati otomatis karena kondisi fatal
// (Stunned/Frozen/Sleep/Paralyzed).
function logSkippedTurns(session, code, names) {
  const logEntry = {
    id: genId('log'), from: 'Sistem',
    text: `💫 ${names.join(', ')} tidak bisa bertindak (Stunned/Frozen/Sleep/Paralyzed) — giliran dilewati.`,
    type: 'system', ts: Date.now(), secret: false
  };
  session.log.push(logEntry);
  if (session.log.length > 300) session.log.shift();
  io.to('room-' + code).emit('chat:new', logEntry);
}

// Awal giliran sebuah entry: Legendary Action pulih penuh, skill Recharge dicoba di-roll (d6 >= angka recharge).
function onTurnStart(session, code) {
  const id = session.battle.turn.activeId;
  const e = id && session.battle.entries[id];
  if (!e) return;
  const msgs = [];
  if (e.legendary && e.sp_max !== '' && parseFloat(e.sp_current) < parseFloat(e.sp_max)) {
    e.sp_current = e.sp_max;
    msgs.push(`Legendary Action pulih (${e.sp_max})`);
  }
  if (e.spent && e.refType === 'npc') {
    const npc = (session.npcs || {})[e.refId];
    const skills = npc && npc.skillSet && npc.skillSet.active || [];
    Object.keys(e.spent).forEach(name => {
      const sk = skills.find(k => k.nama === name);
      const need = sk && parseInt(sk.recharge, 10);
      if (!need) { delete e.spent[name]; return; }
      const d = 1 + Math.floor(Math.random() * 6);
      if (d >= need) { delete e.spent[name]; msgs.push(`${name} siap lagi (d6=${d}, butuh ${need}+)`); }
      else msgs.push(`${name} belum pulih (d6=${d}, butuh ${need}+)`);
    });
  }
  if (!msgs.length) return;
  const logEntry = { id: genId('log'), from: 'Sistem', text: `🔄 ${e.name}: ${msgs.join('; ')}`, type: 'system', ts: Date.now(), secret: false };
  session.log.push(logEntry);
  if (session.log.length > 300) session.log.shift();
  io.to('room-' + code).emit('chat:new', logEntry);
}

// Setiap round battle maju/mundur, kurangi (atau kembalikan) "Sisa Giliran" tiap buff/debuff yang
// punya nilai itu diisi. Kalau sampai 0 (pas maju), efeknya otomatis dihapus & diumumkan di log.
// Efek dengan stat = 'dot' juga otomatis diterapkan tiap round maju — baik buff yang nempel di
// sheet player (mis. racun kena ke PC) MAUPUN buff yang nempel langsung di battle entry NPC/
// ally/enemy (mis. DM kasih "Terbakar" ke musuh langsung dari Battle Tracker).
function tickBuffDurations(session, delta) {
  if (!delta) return;
  if (delta > 0) {
    Object.values(session.players).forEach(p => {
      const entry = Object.values(session.battle.entries || {}).find(en => en.refType === 'player' && en.refId === p.id);
      if (entry) applyDotBuffsToEntry(session, entry, p.sheet && p.sheet.buffs, p.sheet.nama_karakter || p.name);
    });
    Object.values(session.battle.entries || {}).forEach(en => {
      if (en.refType === 'player') return; // sudah ditangani lewat sheet di atas
      applyDotBuffsToEntry(session, en, en.buffs, en.name);
    });
  }
  Object.values(session.battle.entries || {}).forEach(en => {
    if (en.refType === 'player' || !Array.isArray(en.buffs) || !en.buffs.length) return;
    const expired = [];
    const kept = en.buffs.filter(b => {
      if (!b || b.sisaTurn === undefined || b.sisaTurn === '' || b.sisaTurn === null) return true;
      const n = parseFloat(b.sisaTurn);
      if (isNaN(n)) return true;
      const next = n - delta;
      if (delta > 0 && next <= 0) { expired.push(b.nama || 'Efek'); return false; }
      b.sisaTurn = next;
      return true;
    });
    if (expired.length) {
      en.buffs = kept;
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `⏳ Buff/Debuff pada ${en.name}: ${expired.join(', ')} sudah berakhir.`,
        type: 'roll', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    } else {
      en.buffs = kept;
    }
  });
  Object.values(session.players).forEach(p => {
    const buffs = p.sheet && p.sheet.buffs;
    if (!Array.isArray(buffs) || !buffs.length) return;
    const expired = [];
    let changed = false;
    const kept = buffs.filter(b => {
      if (!b || b.sisaTurn === undefined || b.sisaTurn === '' || b.sisaTurn === null) return true;
      const n = parseFloat(b.sisaTurn);
      if (isNaN(n)) return true;
      const next = n - delta;
      if (delta > 0 && next <= 0) { expired.push(b.nama || 'Efek'); changed = true; return false; }
      if (next !== n) { b.sisaTurn = next; changed = true; }
      return true;
    });
    if (!changed) return;
    p.sheet.buffs = kept;
    io.to('dm-' + session.code).emit('sheet-updated', { playerId: p.id, sheet: p.sheet });
    if (p.socketId && expired.length) {
      io.to(p.socketId).emit('your-sheet-updated', { sheet: p.sheet, note: `⏳ Efek berakhir: ${expired.join(', ')}` });
    }
    if (expired.length) {
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `⏳ Buff/Debuff pada ${p.sheet.nama_karakter || p.name}: ${expired.join(', ')} sudah berakhir.`,
        type: 'roll', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
  });
}

// ---------- Socket.io ----------
io.on('connection', (socket) => {

  // === DM: buat sesi baru ===
  socket.on('dm:create-session', ({ dmName }, cb) => {
    const code = genCode();
    sessions[code] = {
      code,
      dmName: dmName || 'Dungeon Master',
      dmSocketId: socket.id,
      createdAt: Date.now(),
      players: {},
      npcs: {},
      classes: {},
      maps: { main: Object.assign(newMap('Map 1'), { id: 'main' }) },
      activeMapId: 'main',
      battle: { entries: {}, turn: { activeId: null, round: 1 }, stats: {} },
      music: blankMusic(),
      story: blankStory(),
      log: [],
      notes: ''
    };
    socket.join('room-' + code);
    socket.join('dm-' + code);
    socket.data.role = 'dm';
    socket.data.code = code;
    saveSessionsDebounced(code);
    cb && cb({ ok: true, code, state: sessionStateForDM(sessions[code]) });
  });

  // === DM: reconnect ke sesi yang sudah ada ===
  // Sekarang wajib isi nama DM juga (kayak login biasa: kode + nama), bukan cuma kode doang,
  // biar orang lain yang cuma nemu/nebak kode sesi gak bisa asal masuk jadi DM.
  socket.on('dm:rejoin-session', ({ code, dmName }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Kode sesi tidak ditemukan.' });
    const nameInput = (dmName || '').trim();
    if (!nameInput) return cb && cb({ ok: false, error: 'Isi nama DM dulu ya.' });
    if (nameInput.toLowerCase() !== (session.dmName || '').trim().toLowerCase()) {
      return cb && cb({ ok: false, error: 'Nama DM tidak cocok dengan sesi ini.' });
    }
    ensureSessionDefaults(session);
    session.dmSocketId = socket.id;
    socket.join('room-' + code);
    socket.join('dm-' + code);
    socket.data.role = 'dm';
    socket.data.code = code;
    cb && cb({ ok: true, code, state: sessionStateForDM(session) });
    socket.to('room-' + code).emit('dm:online', true);
  });

  // === Player: join / rejoin sesi ===
  socket.on('player:join-session', ({ code, name, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Kode sesi tidak ditemukan.' });
    ensureSessionDefaults(session);

    let player;
    if (playerId && session.players[playerId]) {
      player = session.players[playerId];
      player.socketId = socket.id;
      if (name) player.name = name;
    } else {
      const id = genId('p');
      player = { id, name: name || 'Player', socketId: socket.id, sheet: blankSheet(name), unlockedClasses: [] };
      session.players[id] = player;
    }
    socket.join('room-' + code);
    socket.data.role = 'player';
    socket.data.code = code;
    socket.data.playerId = player.id;

    saveSessionsDebounced(code);
    cb && cb({ ok: true, code, playerId: player.id, state: sessionStateForPlayer(session, player.id) });

    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('dm-' + code).emit('player-online', { id: player.id, online: true });
    // Broadcast online list to all players
    io.to('room-' + code).emit('players-list-update', publicPlayerList(session));
  });

  // === Player: update character sheet ===
  socket.on('player:update-sheet', ({ code, playerId, sheet }) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return;
    if (session.players[playerId].socketId !== socket.id) return; // hanya pemilik yang boleh update
    const existing = session.players[playerId];
    // inv_extra_slots murni kontrol DM — player gak boleh ubah dari sisi client, apapun yang dikirim diabaikan
    sheet.inv_extra_slots = existing.sheet.inv_extra_slots || 0;
    // Cap inventory ke slot maksimum (10 dasar + extra dari DM) biar gak bisa dibypass dari client
    if (Array.isArray(sheet.inventory)) {
      const maxSlots = INV_BASE_SLOTS + (parseInt(sheet.inv_extra_slots, 10) || 0);
      if (sheet.inventory.length > maxSlots) sheet.inventory = sheet.inventory.slice(0, maxSlots);
    }
    session.players[playerId].sheet = sheet;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));

    // Portrait yang baru diupload/diganti player ikut disinkronkan ke gambar
    // token battle miliknya (di semua map), biar tokennya otomatis update juga.
    const tokensTouched = syncPlayerPortraitToTokens(session, playerId, sheet.portrait || null);
    if (tokensTouched) {
      io.to('room-' + code).emit('tokens-updated', activeMap(session).tokens);
    }

    // Sinkronkan HP/MP/SP/AC ke entri battle milik player ini (kalau sedang ikut battle),
    // supaya daftar Battle & Giliran di layar DM dan semua player selalu menampilkan
    // angka terbaru dari sheet, bukan angka lama waktu pertama kali ditambahkan ke battle.
    let battleTouched = false;
    Object.values(session.battle.entries || {}).forEach(en => {
      if (en.refType === 'player' && en.refId === playerId) {
        en.hp_max = sheet.max_hp ?? en.hp_max;
        en.hp_current = sheet.current_hp ?? en.hp_current;
        en.mp_max = sheet.mp_max ?? en.mp_max;
        en.mp_current = sheet.mp_current ?? en.mp_current;
        en.sp_max = sheet.sp_max ?? en.sp_max;
        en.sp_current = sheet.sp_current ?? en.sp_current;
        en.ac = sheet.ac ?? en.ac;
        en.portrait = sheet.portrait ?? en.portrait ?? null;
        battleTouched = true;
      }
    });
    if (battleTouched) {
      saveSessionsDebounced(code);
      io.to('room-' + code).emit('battle-updated', session.battle);
    }
  });

  // === DM: minta sheet lengkap seorang player (untuk dibuka di panel DM) ===
  socket.on('dm:get-player-sheet', ({ code, playerId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false });
    ensurePlayerDefaults(session.players[playerId]);
    cb && cb({
      ok: true,
      sheet: session.players[playerId].sheet,
      name: session.players[playerId].name,
      unlockedClasses: session.players[playerId].unlockedClasses
    });
  });

  // === DM: pulihkan/timpa sheet seorang player dari file backup (export player atau export DM) ===
  socket.on('dm:import-player-sheet', ({ code, playerId, sheet }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (!sheet || typeof sheet !== 'object') return cb && cb({ ok: false, error: 'Format sheet tidak valid.' });
    const player = session.players[playerId];
    player.sheet = sheet;
    ensurePlayerDefaults(player);
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: 'DM memulihkan sheet-mu dari file backup.' });
    }

    // Samain juga sinkronisasi battle entry & token portrait, sama seperti player update-sheet biasa.
    let battleTouched = false;
    Object.values(session.battle.entries || {}).forEach(en => {
      if (en.refType === 'player' && en.refId === playerId) {
        en.hp_max = sheet.max_hp ?? en.hp_max;
        en.hp_current = sheet.current_hp ?? en.hp_current;
        en.mp_max = sheet.mp_max ?? en.mp_max;
        en.mp_current = sheet.mp_current ?? en.mp_current;
        en.sp_max = sheet.sp_max ?? en.sp_max;
        en.sp_current = sheet.sp_current ?? en.sp_current;
        en.ac = sheet.ac ?? en.ac;
        en.portrait = sheet.portrait ?? en.portrait ?? null;
        battleTouched = true;
      }
    });
    if (battleTouched) io.to('room-' + code).emit('battle-updated', session.battle);
    const tokensTouched = syncPlayerPortraitToTokens(session, playerId, sheet.portrait || null);
    if (tokensTouched) io.to('room-' + code).emit('tokens-updated', activeMap(session).tokens);

    cb && cb({ ok: true });
  });

  // === DM: beri item ke player (masuk ke inventory player, muncul real-time) ===
  socket.on('dm:give-item', ({ code, playerId, name, qty, desc }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const itemName = (name || '').trim();
    if (!itemName) return cb && cb({ ok: false, error: 'Nama item kosong.' });
    const q = parseInt(qty, 10) || 1;
    const player = session.players[playerId];
    if (!Array.isArray(player.sheet.inventory)) player.sheet.inventory = [];
    player.sheet.inventory.push({
      checked: false, item: itemName, qty: q,
      desc: (desc || '').trim(), type: 'misc', fromDM: true
    });
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      const label = q > 1 ? `${itemName} x${q}` : itemName;
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: `DM mengirim item: ${label}` });
    }
    cb && cb({ ok: true });
  });

  // === Player: trade/kirim item ke player lain langsung, gak lewat DM ===
  socket.on('player:trade-item', ({ code, toPlayerId, itemIndex, qty }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false, error: 'Tidak diizinkan.' });
    const fromId = socket.data.playerId;
    const sender = session.players[fromId];
    const receiver = session.players[toPlayerId];
    if (!sender || !receiver) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (fromId === toPlayerId) return cb && cb({ ok: false, error: 'Gak bisa kirim ke diri sendiri.' });
    if (!Array.isArray(sender.sheet.inventory)) sender.sheet.inventory = [];
    const idx = parseInt(itemIndex, 10);
    const srcItem = sender.sheet.inventory[idx];
    if (!srcItem || !srcItem.item) return cb && cb({ ok: false, error: 'Item tidak ditemukan di inventorymu (mungkin sudah berubah, refresh dulu).' });
    const ownedQty = parseInt(srcItem.qty, 10) || 1;
    const sendQty = Math.max(1, Math.min(ownedQty, parseInt(qty, 10) || 1));

    // Kurangi/hapus dari sender
    if (sendQty >= ownedQty) sender.sheet.inventory.splice(idx, 1);
    else srcItem.qty = ownedQty - sendQty;

    // Tambahkan/stack ke receiver
    if (!Array.isArray(receiver.sheet.inventory)) receiver.sheet.inventory = [];
    const maxSlots = 15;
    let dest = receiver.sheet.inventory.find(it => it.item === srcItem.item && it.type === srcItem.type && it.formula === srcItem.formula && !it.checked);
    if (dest) {
      dest.qty = (parseInt(dest.qty, 10) || 1) + sendQty;
    } else if (receiver.sheet.inventory.length < maxSlots) {
      receiver.sheet.inventory.push({ checked: false, item: srcItem.item, qty: sendQty, desc: srcItem.desc || '', type: srcItem.type || 'misc', formula: srcItem.formula || '', fromTrade: true });
    } else {
      // Inventory receiver penuh -> batalkan, kembalikan ke sender
      if (sendQty >= ownedQty) sender.sheet.inventory.push(srcItem);
      else srcItem.qty = ownedQty;
      return cb && cb({ ok: false, error: `Inventory ${receiver.name} sudah penuh.` });
    }

    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId: fromId, sheet: sender.sheet });
    io.to('dm-' + code).emit('sheet-updated', { playerId: toPlayerId, sheet: receiver.sheet });
    if (sender.socketId) io.to(sender.socketId).emit('your-sheet-updated', { sheet: sender.sheet, note: `Kamu mengirim ${srcItem.item} x${sendQty} ke ${receiver.name}.` });
    if (receiver.socketId) io.to(receiver.socketId).emit('your-sheet-updated', { sheet: receiver.sheet, note: `${sender.name} mengirim ${srcItem.item} x${sendQty} ke kamu!` });
    const logEntry = { id: genId('log'), from: 'Sistem', text: `🔁 ${sender.name} mengirim ${srcItem.item} x${sendQty} ke ${receiver.name}.`, type: 'system', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  // === DM: beri companion ke player ===
  socket.on('dm:give-companion', ({ code, playerId, companion }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    if (!Array.isArray(player.sheet.companions)) player.sheet.companions = [];
    const comp = {
      nama: companion.nama || '', tipe: companion.tipe || '',
      level: companion.level || '', hp: companion.hp || '',
      hp_max: companion.hp_max || '', mp: companion.mp || '',
      mp_max: companion.mp_max || '', skill: companion.skill || '',
      catatan: companion.catatan || '', fromDM: true
    };
    player.sheet.companions.push(comp);
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', {
        sheet: player.sheet,
        note: `DM menambahkan companion: ${comp.nama}`
      });
    }
    cb && cb({ ok: true });
  });

  // === DM: hapus player (alias baru yang lebih eksplisit) ===
  socket.on('dm:remove-player', ({ code, playerId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    ensureSessionDefaults(session);
    const player = session.players[playerId];
    Object.values(session.maps || {}).forEach(m => {
      Object.keys(m.tokens || {}).forEach(tid => {
        if (m.tokens[tid].ownerId === playerId) delete m.tokens[tid];
      });
    });
    Object.keys(session.battle.entries || {}).forEach(eid => {
      const en = session.battle.entries[eid];
      if (en.refType === 'player' && en.refId === playerId) delete session.battle.entries[eid];
    });
    const kickedSocketId = player.socketId;
    delete session.players[playerId];
    saveSessionsDebounced(code);
    if (kickedSocketId) {
      io.to(kickedSocketId).emit('you-were-removed', { note: 'DM mengeluarkanmu dari sesi ini.' });
      io.sockets.sockets.get(kickedSocketId)?.leave('room-' + code);
    }
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('room-' + code).emit('tokens-updated', activeMap(session).tokens);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true });
  });

  // === DM: kasih XP langsung ke player, level otomatis naik pakai kurva sederhana
  // (level = floor(total EXP / 1000) + 1). Beda sama dm:set-progress yang manual full override —
  // ini buat alur cepat "menang battle -> kasih XP -> auto level up + notif".
  const XP_PER_LEVEL = 1000;
  socket.on('dm:give-xp', ({ code, playerId, amount }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const amt = parseInt(amount, 10);
    if (isNaN(amt) || amt <= 0) return cb && cb({ ok: false, error: 'Jumlah XP tidak valid.' });
    const player = session.players[playerId];
    const prevExp = parseInt(player.sheet.exp, 10) || 0;
    const prevLv = parseInt(player.sheet.lv, 10) || 1;
    const newExp = prevExp + amt;
    const newLv = Math.max(1, Math.floor(newExp / XP_PER_LEVEL) + 1);
    player.sheet.exp = newExp;
    const leveledUp = newLv > prevLv;
    if (leveledUp) player.sheet.lv = newLv;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    const note = leveledUp ? `🎉 +${amt} XP dari DM — Level Up! Sekarang Level ${newLv}!` : `+${amt} XP dari DM.`;
    if (player.socketId) io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note });
    if (leveledUp) {
      const logEntry = { id: genId('log'), from: 'Sistem', text: `🎉 ${player.name} naik ke Level ${newLv}!`, type: 'system', ts: Date.now(), secret: false };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + code).emit('chat:new', logEntry);
    }
    cb && cb({ ok: true, exp: newExp, lv: leveledUp ? newLv : prevLv, leveledUp });
  });
  socket.on('dm:set-progress', ({ code, playerId, lv, exp, kelas_exp }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    if (lv !== undefined) player.sheet.lv = lv;
    if (exp !== undefined) player.sheet.exp = exp;
    if (kelas_exp !== undefined) player.sheet.kelas_exp = kelas_exp;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: 'DM memperbarui Level/EXP karaktermu.' });
    }
    cb && cb({ ok: true });
  });

  // === DM: hapus player dari sesi (permanen, alias lama) ===
  socket.on('dm:delete-player', ({ code, playerId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    ensureSessionDefaults(session);
    const player = session.players[playerId];

    Object.values(session.maps || {}).forEach(m => {
      Object.keys(m.tokens || {}).forEach(tid => {
        if (m.tokens[tid].ownerId === playerId) delete m.tokens[tid];
      });
    });
    Object.keys(session.battle.entries || {}).forEach(eid => {
      const en = session.battle.entries[eid];
      if (en.refType === 'player' && en.refId === playerId) delete session.battle.entries[eid];
    });

    const kickedSocketId = player.socketId;
    delete session.players[playerId];
    saveSessionsDebounced(code);

    if (kickedSocketId) {
      io.to(kickedSocketId).emit('you-were-removed', { note: 'DM mengeluarkanmu dari sesi ini.' });
      io.sockets.sockets.get(kickedSocketId)?.leave('room-' + code);
    }
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('room-' + code).emit('tokens-updated', activeMap(session).tokens);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true });
  });

  // === DM: beri / atur Pet seorang player (nama, tipe, level, hp, mp, skill) ===
  socket.on('dm:set-pet', ({ code, playerId, pet }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    const p = pet || {};
    player.sheet.pet = {
      nama: p.nama || '', tipe: p.tipe || '', level: p.level || '',
      hp: p.hp || '', mp: p.mp || '', skill: p.skill || '', catatan: p.catatan || ''
    };
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      const note = p.nama ? `DM memperbarui pet-mu: ${p.nama} (Lv.${p.level || '-'}).` : 'DM memperbarui data pet-mu.';
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note });
    }
    cb && cb({ ok: true, pet: player.sheet.pet });
  });

  // === DM: beri gold ke player (bisa juga negatif utk mengurangi) ===
  socket.on('dm:give-gold', ({ code, playerId, amount }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const add = parseInt(amount, 10);
    if (!add) return cb && cb({ ok: false, error: 'Jumlah gold tidak valid.' });
    const player = session.players[playerId];
    const current = parseInt(player.sheet.gold, 10) || 0;
    const updated = current + add;
    player.sheet.gold = String(updated);
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      const note = add > 0 ? `DM memberi ${add} gold (total: ${updated}).` : `DM mengurangi ${Math.abs(add)} gold (total: ${updated}).`;
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note });
    }
    cb && cb({ ok: true, gold: updated });
  });

  // DM mengatur ulang gold ke angka pasti (berguna kalau player mengisi gold asal-asalan)
  socket.on('dm:set-gold', ({ code, playerId, amount }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const val = parseInt(amount, 10);
    if (isNaN(val) || val < 0) return cb && cb({ ok: false, error: 'Jumlah gold tidak valid.' });
    const player = session.players[playerId];
    player.sheet.gold = String(val);
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: `DM mengatur ulang gold-mu menjadi ${val}.` });
    }
    cb && cb({ ok: true, gold: val });
  });

  // === DM: atur hunger/thirst satu player langsung ke angka pasti ===
  socket.on('dm:set-survival', ({ code, playerId, hunger, thirst }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    ensurePlayerDefaults(player);
    const s = player.sheet.survival;
    if (hunger !== undefined && hunger !== null && hunger !== '') {
      s.hunger = Math.max(0, Math.min(s.hunger_max || 100, parseInt(hunger, 10) || 0));
    }
    if (thirst !== undefined && thirst !== null && thirst !== '') {
      s.thirst = Math.max(0, Math.min(s.thirst_max || 100, parseInt(thirst, 10) || 0));
    }
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: `DM mengatur ulang lapar/haus-mu.` });
    }
    cb && cb({ ok: true, survival: s });
  });

  // === DM: "waktu berlalu" — lapar & haus semua player berkurang sekaligus (default -10) ===
  socket.on('dm:survival-tick', ({ code, hungerDelta, thirstDelta }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return cb && cb({ ok: false });
    const hd = Number.isFinite(parseInt(hungerDelta, 10)) ? parseInt(hungerDelta, 10) : -10;
    const td = Number.isFinite(parseInt(thirstDelta, 10)) ? parseInt(thirstDelta, 10) : -10;
    Object.values(session.players).forEach(p => {
      ensurePlayerDefaults(p);
      const s = p.sheet.survival;
      s.hunger = Math.max(0, Math.min(s.hunger_max || 100, s.hunger + hd));
      s.thirst = Math.max(0, Math.min(s.thirst_max || 100, s.thirst + td));
      io.to('dm-' + code).emit('sheet-updated', { playerId: p.id, sheet: p.sheet });
      if (p.socketId) io.to(p.socketId).emit('your-sheet-updated', { sheet: p.sheet, note: `⏳ Waktu berlalu — kamu jadi lebih lapar & haus.` });
    });
    saveSessionsDebounced(code);
    const logEntry = { id: genId('log'), from: 'Waktu', text: `⏳ Waktu berlalu — semua karakter jadi lebih lapar & haus.`, type: 'narrative', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  // === DM: kasih slot inventory tambahan ke player (di atas 10 slot dasar) ===
  socket.on('dm:set-inv-slots', ({ code, playerId, extraSlots }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const val = parseInt(extraSlots, 10);
    if (isNaN(val) || val < 0) return cb && cb({ ok: false, error: 'Jumlah slot tidak valid.' });
    const player = session.players[playerId];
    player.sheet.inv_extra_slots = val;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', {
        sheet: player.sheet,
        note: `DM memberi ${val} slot inventory tambahan (total: ${INV_BASE_SLOTS + val} slot).`
      });
    }
    cb && cb({ ok: true, inv_extra_slots: val, totalSlots: INV_BASE_SLOTS + val });
  });

  // === Player: beli item dari Shop — potong gold, isi ke inventory, kurangi stok kalau terbatas ===
  socket.on('player:buy-item', ({ code, playerId, itemId, qty }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (session.players[playerId].socketId !== socket.id) return cb && cb({ ok: false, error: 'Tidak diizinkan.' });
    ensureSessionDefaults(session);
    const item = session.shop.items[itemId];
    if (!item) return cb && cb({ ok: false, error: 'Item tidak ditemukan di toko.' });

    const buyQty = Math.max(1, parseInt(qty, 10) || 1);
    const price = parseFloat(item.harga) || 0;
    const totalPrice = price * buyQty;

    const player = session.players[playerId];
    const currentGold = parseFloat(player.sheet.gold) || 0;
    if (currentGold < totalPrice) return cb && cb({ ok: false, error: 'Gold tidak cukup.' });

    // Cek & potong stok kalau item ini stoknya terbatas (bukan '~' / kosong)
    let stokLimited = false, stokNum = null;
    if (item.stok !== '' && item.stok != null && !isNaN(parseInt(item.stok, 10))) {
      stokLimited = true; stokNum = parseInt(item.stok, 10);
      if (stokNum < buyQty) return cb && cb({ ok: false, error: 'Stok tidak cukup.' });
    }

    if (!Array.isArray(player.sheet.inventory)) player.sheet.inventory = [];
    const maxSlots = invMaxSlotsForPlayer(player);
    // Tumpuk ke slot yang sudah ada (item sama, dari shop, belum dipakai) kalau ada, biar gak makan slot baru terus
    let existing = player.sheet.inventory.find(it => it.item === item.nama && it.fromShop && !it.checked);
    if (existing) {
      existing.qty = (parseInt(existing.qty, 10) || 1) + buyQty;
      // Sinkronkan efek terbaru dari katalog toko, siapa tahu DM update efeknya setelah item ini pernah dibeli
      existing.type = item.efekTipe || 'misc';
      existing.formula = item.efekFormula || '';
      existing.aoe = !!item.aoe;
    } else {
      if (player.sheet.inventory.length >= maxSlots) {
        return cb && cb({ ok: false, error: `Inventory penuh (maks ${maxSlots} slot). Kosongkan slot dulu atau minta DM tambah slot.` });
      }
      // Efek (tipe + formula dadu + AoE) ikut kebawa otomatis dari katalog toko ke inventory,
      // jadi begitu dibeli item langsung bisa "⚡ Pakai" di battle tanpa diketik ulang.
      player.sheet.inventory.push({
        checked: false, item: item.nama, desc: item.deskripsi || '',
        type: item.efekTipe || 'misc', formula: item.efekFormula || '', aoe: !!item.aoe,
        qty: buyQty, fromShop: true
      });
    }

    if (stokLimited) { item.stok = stokNum - buyQty; }
    player.sheet.gold = String(currentGold - totalPrice);

    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('room-' + code).emit('shop-updated', session.shop.items);

    const logEntry = {
      id: genId('log'), from: 'Sistem',
      text: `🛒 ${player.sheet.nama_karakter || player.name} membeli ${item.nama}${buyQty > 1 ? ' x' + buyQty : ''} seharga ${totalPrice} gold.`,
      type: 'system', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);

    cb && cb({ ok: true, sheet: player.sheet });
  });

  // === DM: kelola katalog Kelas sesi (CRUD) ===
  socket.on('dm:save-class', ({ code, kelas }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!kelas || !(kelas.nama || '').trim()) return cb && cb({ ok: false, error: 'Nama kelas kosong.' });
    if (!kelas.id) kelas.id = genId('cls');
    session.classes[kelas.id] = {
      id: kelas.id,
      nama: kelas.nama || '',
      exp_req: kelas.exp_req || '',
      deskripsi: kelas.deskripsi || '',
      // Skills dikosongkan — player isi sendiri di sheet mereka
      skills: { active: [], passive: [], ultimate: [] }
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('classes-update', session.classes);
    cb && cb({ ok: true, kelas: session.classes[kelas.id] });
  });

  socket.on('dm:delete-class', ({ code, classId }) => {
    const session = sessions[code];
    if (!session || !session.classes) return;
    delete session.classes[classId];
    // Lepas kelas ini dari daftar kelas terbuka semua player
    Object.values(session.players).forEach(p => {
      ensurePlayerDefaults(p);
      p.unlockedClasses = p.unlockedClasses.filter(id => id !== classId);
    });
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('classes-update', session.classes);
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
  });

  // === DM: buka ("rank up") kelas tertentu utk seorang player ===
  socket.on('dm:set-unlocked-classes', ({ code, playerId, classIds }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    const valid = Array.isArray(classIds) ? classIds.filter(id => session.classes && session.classes[id]) : [];
    player.unlockedClasses = valid;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      io.to(player.socketId).emit('your-classes-updated', {
        unlockedClasses: player.unlockedClasses,
        note: 'DM membuka kelas baru untukmu — cek panel Kelas di sheet-mu.'
      });
    }
    cb && cb({ ok: true, unlockedClasses: player.unlockedClasses });
  });

  // === Player: pilih / ganti kelas dari daftar kelas yang sudah dibuka DM ===
  socket.on('player:change-class', ({ code, playerId, classId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (session.players[playerId].socketId !== socket.id) return cb && cb({ ok: false, error: 'Tidak diizinkan.' });
    ensurePlayerDefaults(session.players[playerId]);
    const player = session.players[playerId];
    const kelas = session.classes && session.classes[classId];
    if (!kelas) return cb && cb({ ok: false, error: 'Kelas tidak ditemukan.' });
    if (!player.unlockedClasses.includes(classId)) return cb && cb({ ok: false, error: 'Kelas ini belum dibuka DM untukmu.' });

    player.sheet.kelas = kelas.nama;
    player.sheet.skills = JSON.parse(JSON.stringify(kelas.skills || blankClassSkills()));
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    cb && cb({ ok: true, sheet: player.sheet });
  });

  // === DM: kelola katalog Crafting/Resep sesi (CRUD) ===
  socket.on('dm:save-recipe', ({ code, recipe }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!recipe || !(recipe.nama || '').trim()) return cb && cb({ ok: false, error: 'Nama resep kosong.' });
    if (!(recipe.hasil_item || '').trim()) return cb && cb({ ok: false, error: 'Nama hasil crafting kosong.' });
    const bahan = Array.isArray(recipe.bahan)
      ? recipe.bahan.filter(b => b && (b.item || '').trim()).map(b => ({ item: (b.item || '').trim(), qty: Math.max(1, parseInt(b.qty, 10) || 1) }))
      : [];
    if (!bahan.length) return cb && cb({ ok: false, error: 'Isi minimal 1 bahan.' });
    if (!recipe.id) recipe.id = genId('rcp');
    session.recipes[recipe.id] = {
      id: recipe.id,
      nama: recipe.nama || '',
      deskripsi: recipe.deskripsi || '',
      bahan,
      hasil_item: (recipe.hasil_item || '').trim(),
      hasil_qty: Math.max(1, parseInt(recipe.hasil_qty, 10) || 1),
      hasil_desc: recipe.hasil_desc || '',
      hasil_tipe: recipe.hasil_tipe || 'misc',
      hasil_formula: recipe.hasil_formula || ''
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('recipes-update', session.recipes);
    cb && cb({ ok: true, recipe: session.recipes[recipe.id] });
  });

  socket.on('dm:delete-recipe', ({ code, recipeId }) => {
    const session = sessions[code];
    if (!session || !session.recipes) return;
    delete session.recipes[recipeId];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('recipes-update', session.recipes);
  });

  // === Player: craft item dari resep — butuh bahan cukup di inventory,
  // dipotong otomatis, hasil masuk ke slot inventory (nimbun kalau sudah ada stack dari craft yang sama) ===
  socket.on('player:craft', ({ code, playerId, recipeId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (session.players[playerId].socketId !== socket.id) return cb && cb({ ok: false, error: 'Tidak diizinkan.' });
    ensureSessionDefaults(session);
    const recipe = session.recipes[recipeId];
    if (!recipe || !Array.isArray(recipe.bahan) || !recipe.bahan.length) return cb && cb({ ok: false, error: 'Resep tidak ditemukan.' });

    const player = session.players[playerId];
    if (!Array.isArray(player.sheet.inventory)) player.sheet.inventory = [];
    const inv = player.sheet.inventory;

    // Cek semua bahan cukup dulu (cocokkan nama item, case-insensitive, jumlahkan lintas slot)
    for (const b of recipe.bahan) {
      const have = inv.filter(it => (it.item || '').trim().toLowerCase() === b.item.toLowerCase())
        .reduce((sum, it) => sum + (parseInt(it.qty, 10) || 1), 0);
      if (have < b.qty) return cb && cb({ ok: false, error: `Bahan kurang: ${b.item} (butuh ${b.qty}, punya ${have}).` });
    }

    // Cek slot cukup buat hasil SEBELUM motong bahan (biar kalau gagal, bahan gak kepotong sia-sia)
    const maxSlots = invMaxSlotsForPlayer(player);
    const hasExistingStack = inv.some(it => it.item === recipe.hasil_item && it.fromCraft && !it.checked);
    if (!hasExistingStack && inv.length >= maxSlots) {
      return cb && cb({ ok: false, error: `Inventory penuh (maks ${maxSlots} slot). Kosongkan slot dulu sebelum crafting.` });
    }

    // Potong bahan dari slot yang cocok (boleh dari beberapa slot sekaligus)
    recipe.bahan.forEach(b => {
      let remaining = b.qty;
      for (let i = inv.length - 1; i >= 0 && remaining > 0; i--) {
        const it = inv[i];
        if ((it.item || '').trim().toLowerCase() !== b.item.toLowerCase()) continue;
        const qty = parseInt(it.qty, 10) || 1;
        if (qty <= remaining) { remaining -= qty; inv.splice(i, 1); }
        else { it.qty = qty - remaining; remaining = 0; }
      }
    });

    // Tambah hasil craft (numpuk ke stack "dari craft" yang sama kalau ada)
    let existing = inv.find(it => it.item === recipe.hasil_item && it.fromCraft && !it.checked);
    if (existing) {
      existing.qty = (parseInt(existing.qty, 10) || 1) + recipe.hasil_qty;
    } else {
      inv.push({
        checked: false, item: recipe.hasil_item, desc: recipe.hasil_desc || '',
        type: recipe.hasil_tipe || 'misc', formula: recipe.hasil_formula || '',
        qty: recipe.hasil_qty, fromCraft: true
      });
    }

    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));

    const logEntry = {
      id: genId('log'), from: 'Sistem',
      text: `🛠 ${player.sheet.nama_karakter || player.name} berhasil crafting ${recipe.hasil_item}${recipe.hasil_qty > 1 ? ' x' + recipe.hasil_qty : ''} (${recipe.nama}).`,
      type: 'system', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);

    cb && cb({ ok: true, sheet: player.sheet });
  });

  // === DM: catatan sesi (biar tidak lupa apa yang terjadi) ===
  socket.on('dm:update-notes', ({ code, notes }) => {
    const session = sessions[code];
    if (!session) return;
    session.notes = notes || '';
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('notes-updated', session.notes);
  });

  // Alias baru dari dm.js v2
  socket.on('dm:save-notes', ({ code, notes }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    session.notes = notes || '';
    saveSessionsDebounced(code);
    cb && cb({ ok: true });
  });

  // === DM: broadcast player list ke semua player (untuk online indicator) ===
  socket.on('dm:broadcast-players-list', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    io.to('room-' + code).emit('players-list-update', publicPlayerList(session));
  });

  // === DM: NPC CRUD ===
  socket.on('dm:save-npc', ({ code, npc }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (!npc.id) npc.id = genId('npc');
    session.npcs[npc.id] = npc;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('npcs-update', session.npcs);
    cb && cb({ ok: true, npc });
  });

  socket.on('dm:delete-npc', ({ code, npcId }) => {
    const session = sessions[code];
    if (!session) return;
    delete session.npcs[npcId];
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('npcs-update', session.npcs);
  });

  // === DM: atur relasi/reputasi NPC ini ke tiap player (musuh/netral/sekutu + catatan) ===
  socket.on('dm:npc-set-relationships', ({ code, npcId, relationships }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return cb && cb({ ok: false });
    const npc = session.npcs[npcId];
    if (!npc) return cb && cb({ ok: false, error: 'NPC tidak ditemukan.' });
    npc.relationships = relationships || {};
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('npcs-update', session.npcs);
    cb && cb({ ok: true });
  });

  // === DM: update map (gambar + grid) — selalu ke map yang lagi aktif/dibuka DM ===
  socket.on('dm:update-map', ({ code, imageUrl, width, height }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    map.imageUrl = imageUrl;
    map.width = width;
    map.height = height;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  socket.on('dm:update-grid', ({ code, gridSize, gridVisible, offsetX, offsetY, fogVisible }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (gridSize != null) map.gridSize = gridSize;
    if (gridVisible != null) map.gridVisible = gridVisible;
    if (fogVisible != null) map.fogVisible = fogVisible;
    if (offsetX != null) map.offsetX = offsetX;
    if (offsetY != null) map.offsetY = offsetY;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  // Fog of war: DM klik/drag buat "menghapus" (reveal) atau menutup lagi sel kabut di map
  socket.on('dm:fog-paint', ({ code, cells, reveal }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (!map.fogRevealed) map.fogRevealed = {};
    (cells || []).forEach(key => {
      if (reveal) map.fogRevealed[key] = 1;
      else delete map.fogRevealed[key];
    });
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  socket.on('dm:fog-reset', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    map.fogRevealed = {};
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  // === DM: kelola banyak map (tab) — bikin baru, pindah tab aktif, hapus tab ===
  socket.on('dm:map-add', ({ code, name }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const existingCount = Object.keys(session.maps).length;
    const map = newMap(name || `Map ${existingCount + 1}`);
    session.maps[map.id] = map;
    session.activeMapId = map.id;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    io.to('room-' + code).emit('map-updated', map);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
    cb && cb({ ok: true, mapId: map.id });
  });

  socket.on('dm:map-switch', ({ code, mapId }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!session.maps[mapId]) return cb && cb({ ok: false, error: 'Map tidak ditemukan.' });
    session.activeMapId = mapId;
    saveSessionsDebounced(code);
    const map = activeMap(session);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    io.to('room-' + code).emit('map-updated', map);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
    cb && cb({ ok: true });
  });

  socket.on('dm:map-rename', ({ code, mapId, name }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const map = session.maps[mapId];
    if (!map) return cb && cb({ ok: false, error: 'Map tidak ditemukan.' });
    map.name = (name || '').trim() || map.name;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    cb && cb({ ok: true });
  });

  socket.on('dm:map-delete', ({ code, mapId }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const ids = Object.keys(session.maps);
    if (ids.length <= 1) return cb && cb({ ok: false, error: 'Minimal harus ada 1 map.' });
    if (!session.maps[mapId]) return cb && cb({ ok: false, error: 'Map tidak ditemukan.' });
    delete session.maps[mapId];
    if (session.activeMapId === mapId) session.activeMapId = Object.keys(session.maps)[0];
    saveSessionsDebounced(code);
    const map = activeMap(session);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    io.to('room-' + code).emit('map-updated', map);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
    cb && cb({ ok: true });
  });

  // === Token (dipakai DM & Player, dengan pengecekan kepemilikan sederhana) — selalu di map aktif ===
  // === DM: dinding, pintu, lampu, pengaturan lighting (map aktif) ===
  function dmMap(code) {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return null;
    ensureSessionDefaults(session);
    return { session, map: activeMap(session) };
  }
  function pushMap(code, session) {
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', activeMap(session));
  }
  socket.on('dm:wall-add', ({ code, wall }, cb) => {
    const c = dmMap(code); if (!c || !wall) return cb && cb({ ok: false });
    if (c.map.walls.length >= MAX_WALLS) return cb && cb({ ok: false, error: 'Terlalu banyak dinding.' });
    const w = cleanWall(wall);
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 0.2) return cb && cb({ ok: false });
    c.map.walls.push(w); pushMap(code, c.session); cb && cb({ ok: true, id: w.id });
  });
  socket.on('dm:wall-remove', ({ code, wallId }) => {
    const c = dmMap(code); if (!c) return;
    c.map.walls = c.map.walls.filter(w => w.id !== wallId); pushMap(code, c.session);
  });
  socket.on('dm:door-toggle', ({ code, wallId, field }) => {
    const c = dmMap(code); if (!c) return;
    const w = c.map.walls.find(x => x.id === wallId);
    if (!w || w.kind !== 'door') return;
    if (field === 'oneway') { w.oneWay = w.oneWay === 0 || !w.oneWay ? 1 : (w.oneWay === 1 ? -1 : 0); }
    else if (field === 'locked') { w.locked = !w.locked; if (w.locked) w.open = false; }
    else { if (w.locked) return; w.open = !w.open; }
    pushMap(code, c.session);
  });
  socket.on('dm:light-add', ({ code, light }, cb) => {
    const c = dmMap(code); if (!c || !light) return cb && cb({ ok: false });
    if (c.map.lights.length >= MAX_LIGHTS) return cb && cb({ ok: false, error: 'Terlalu banyak lampu.' });
    const l = cleanLight(light); c.map.lights.push(l); pushMap(code, c.session); cb && cb({ ok: true, id: l.id });
  });
  socket.on('dm:light-remove', ({ code, lightId }) => {
    const c = dmMap(code); if (!c) return;
    c.map.lights = c.map.lights.filter(l => l.id !== lightId); pushMap(code, c.session);
  });
  // Ganti seluruh geometri sekaligus (import .uvtt, hapus semua)
  socket.on('dm:geometry-set', ({ code, walls, lights, append }, cb) => {
    const c = dmMap(code); if (!c) return cb && cb({ ok: false });
    const ws = (Array.isArray(walls) ? walls : []).slice(0, MAX_WALLS).map(cleanWall)
      .filter(w => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 0.05);
    const ls = (Array.isArray(lights) ? lights : []).slice(0, MAX_LIGHTS).map(cleanLight);
    if (append) { c.map.walls = c.map.walls.concat(ws).slice(0, MAX_WALLS); c.map.lights = c.map.lights.concat(ls).slice(0, MAX_LIGHTS); }
    else { c.map.walls = ws; c.map.lights = ls; }
    pushMap(code, c.session); cb && cb({ ok: true, walls: c.map.walls.length, lights: c.map.lights.length });
  });
  socket.on('dm:lighting-set', ({ code, lighting }) => {
    const c = dmMap(code); if (!c || !lighting) return;
    const L = c.map.lighting;
    if (lighting.enabled != null) L.enabled = !!lighting.enabled;
    if (lighting.darkness != null) L.darkness = Math.max(0, Math.min(1, parseFloat(lighting.darkness) || 0));
    if (lighting.visionPct != null) L.visionPct = Math.max(3, Math.min(100, parseFloat(lighting.visionPct) || 22));
    if (lighting.resetExplored) L.resetAt = Date.now();
    pushMap(code, c.session);
  });

  // === DM: spotlight (kamera yang dialirkan ke layar player & TV) ===
  socket.on('dm:spotlight-set', ({ code, spotlight }) => {
    const c = dmMap(code); if (!c) return;
    if (!spotlight || !spotlight.active) { c.map.spotlight = { active: false, x: 50, y: 50, zoom: 2 }; }
    else c.map.spotlight = {
      active: true,
      x: clampPct(spotlight.x), y: clampPct(spotlight.y),
      zoom: Math.max(1.2, Math.min(5, parseFloat(spotlight.zoom) || 2))
    };
    pushMap(code, c.session);
  });

  // === DM: bawa seluruh party (token milik player) ke map/lantai lain, lalu pindah ke map itu ===
  socket.on('dm:map-move-party', ({ code, toMapId, x, y }, cb) => {
    const c = dmMap(code); if (!c) return cb && cb({ ok: false });
    const { session } = c;
    const target = session.maps[toMapId];
    if (!target) return cb && cb({ ok: false, error: 'Map tujuan tidak ditemukan.' });
    if (toMapId === session.activeMapId) return cb && cb({ ok: false, error: 'Itu map yang sedang aktif.' });
    const from = activeMap(session);
    const party = Object.values(from.tokens).filter(t => t.ownerId && !t.isOverlay);
    const hasPoint = x != null && y != null;
    party.forEach((t, i) => {
      delete from.tokens[t.id];
      if (hasPoint) {
        // sebar kecil di sekitar titik tujuan supaya tidak menumpuk
        const ang = (i / Math.max(1, party.length)) * Math.PI * 2;
        t.x = clampPct(parseFloat(x) + (party.length > 1 ? Math.cos(ang) * 2.5 : 0));
        t.y = clampPct(parseFloat(y) + (party.length > 1 ? Math.sin(ang) * 2.5 : 0));
      }
      target.tokens[t.id] = t;
    });
    session.activeMapId = toMapId;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    io.to('room-' + code).emit('map-updated', target);
    io.to('room-' + code).emit('tokens-updated', target.tokens);
    cb && cb({ ok: true, moved: party.length });
  });

  socket.on('token:add', ({ code, token }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    token.id = token.id || genId('tok');
    // Kalau token di-assign ke seorang player dan DM tidak upload gambar
    // token custom sendiri, otomatis pakai portrait karakter player itu
    // (yang sudah diupload di halaman sheet-nya) sebagai gambar token.
    if (token.ownerId && session.players[token.ownerId] && !token.imageUrl) {
      const portrait = session.players[token.ownerId].sheet.portrait || null;
      if (portrait) { token.imageUrl = portrait; token.autoPortrait = true; }
    } else if (token.imageUrl) {
      token.autoPortrait = false; // gambar custom dari DM, jangan ditimpa portrait nanti
    }
    map.tokens[token.id] = token;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  socket.on('token:move', ({ code, tokenId, x, y }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (!map.tokens[tokenId]) return;
    const tok = map.tokens[tokenId];
    // Player hanya boleh gerakkan token miliknya sendiri; DM boleh gerakkan semua
    if (socket.data.role === 'player' && tok.ownerId !== socket.data.playerId) return;
    x = parseFloat(x); y = parseFloat(y);
    if (isNaN(x) || isNaN(y)) return;
    // Dinding & pintu tertutup menghentikan token player (DM boleh menembus untuk mengatur adegan)
    if (socket.data.role === 'player') {
      const r = clampMoveByWalls(map, parseFloat(tok.x) || 0, parseFloat(tok.y) || 0, x, y);
      x = r.x; y = r.y;
    }
    tok.x = x; tok.y = y;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  socket.on('token:update', ({ code, tokenId, patch }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (!map.tokens[tokenId]) return;
    if (patch && patch.imageUrl !== undefined) patch.autoPortrait = false;
    Object.assign(map.tokens[tokenId], patch);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  socket.on('token:remove', ({ code, tokenId }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    delete map.tokens[tokenId];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  // === Battle & Turn (allies / PC / enemy, digerakkan initiative) ===
  socket.on('dm:battle-add', ({ code, entry }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    const id = genId('bt');
    session.battle.entries[id] = {
      id,
      name: entry.name || 'Tanpa Nama',
      type: entry.type || 'ally', // 'pc' | 'ally' | 'enemy'
      roll: entry.roll ?? 0,
      initiative: entry.initiative ?? 0, // modifier buat auto-roll initiative (d20 + ini)
      hp_max: entry.hp_max ?? '',
      hp_current: entry.hp_current ?? entry.hp_max ?? '',
      mp_max: entry.mp_max ?? '',
      mp_current: entry.mp_current ?? entry.mp_max ?? '',
      sp_max: entry.sp_max ?? '',
      sp_current: entry.sp_current ?? entry.sp_max ?? '',
      ac: entry.ac ?? '',
      refType: entry.refType || null, // 'player' | 'npc' | null
      refId: entry.refId || null,
      portrait: entry.portrait || null, // portrait kecil karakter, kalau ada
      elements: entry.elements || {}, // elemental atribut (dari class_trait NPC)
      legendary: !!entry.legendary, // punya Legendary Action: SP pulih tiap awal gilirannya
      spent: {}, // skill Recharge yang sedang habis {namaSkill: true}
      conditions: [], // status conditions aktif
      buffs: Array.isArray(entry.buffs) ? entry.buffs : [] // DOT/HEAL/buff untuk NPC/ally/enemy
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true, id });
  });

  // Roll initiative otomatis (d20 + modifier initiative) buat SEMUA peserta battle sekaligus,
  // lalu urutan giliran otomatis disusun ulang dari roll tertinggi.
  socket.on('dm:battle-roll-initiative', ({ code }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Sesi tidak ditemukan.' });
    const entries = Object.values(session.battle.entries || {});
    if (!entries.length) return cb && cb({ ok: false, error: 'Belum ada peserta battle.' });
    const summary = entries.map(entry => {
      let bonus = parseFloat(entry.initiative) || 0;
      if (entry.refType === 'player' && session.players[entry.refId]) {
        bonus = parseFloat(session.players[entry.refId].sheet.initiative) || bonus;
      }
      const d20 = 1 + Math.floor(Math.random() * 20);
      entry.roll = d20 + bonus;
      return `${entry.name}: 🎲${d20}${bonus ? (bonus > 0 ? '+' : '') + bonus : ''} = ${entry.roll}`;
    });
    session.battle.turn.round = 1;
    const ordered = sortedBattleList(session);
    session.battle.turn.activeId = ordered.length ? ordered[0].id : null;
    const logEntry = {
      id: genId('log'), from: 'Sistem',
      text: `🎲 Initiative di-roll ulang: ${summary.join(' | ')}`,
      type: 'system', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true });
  });

  socket.on('dm:battle-update', ({ code, id, patch }) => {
    const session = sessions[code];
    if (!session || !session.battle.entries[id]) return;
    const entry = session.battle.entries[id];
    const prevHp = parseFloat(entry.hp_current);
    Object.assign(entry, patch);
    if (patch && 'hp_current' in patch) checkDeathState(entry, isNaN(prevHp) ? null : prevHp);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-remove', ({ code, id }) => {
    const session = sessions[code];
    if (!session) return;
    delete session.battle.entries[id];
    if (session.battle.turn.activeId === id) session.battle.turn.activeId = null;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-clear', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    session.battle = { entries: {}, turn: { activeId: null, round: 1 }, stats: {} };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  // Reset statistik hit/miss/crit doang (tanpa hapus peserta battle), buat mulai battle baru.
  socket.on('dm:battle-reset-stats', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    session.battle.stats = {};
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-next', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    const roundBefore = session.battle.turn.round;
    const { skipped } = battleAdvance(session, 1);
    tickBuffDurations(session, session.battle.turn.round - roundBefore);
    if (skipped.length) logSkippedTurns(session, code, skipped);
    onTurnStart(session, code);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-prev', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    const roundBefore = session.battle.turn.round;
    const { skipped } = battleAdvance(session, -1);
    tickBuffDurations(session, session.battle.turn.round - roundBefore);
    if (skipped.length) logSkippedTurns(session, code, skipped);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  // === Aksi Roll Battle (dmg/heal/buff/debuff/ultimate/regen mana/regen sp/ac) ===
  // Dipakai player maupun DM. Mendukung elemental modifier dari class_trait actor
  // dan elemental resistance target. Juga heal overtime (heal_dot) dari buff entry.
  // Terapkan 1 aksi (damage/heal/buff/dll) ke 1 entry battle. Dipakai baik utk single target
  // maupun dipanggil berulang per-entry pas AoE. Gak ngirim socket event apa pun di sini —
  // biar caller yang atur emit-nya sekali aja setelah semua target selesai diproses.
  function applyActionToEntry(session, code, entry, { actionType, formula, actor, actorId, note, elementType, elemBonus, toHitBonus, noHit }) {
    const map = BATTLE_ACTION_MAP[actionType];
    const roll = rollFormulaServer(formula);
    const label = BATTLE_ACTION_LABEL[actionType] || actionType;
    let noteSuffix = note ? ' — ' + note : '';
    const isAttack = actionType === 'damage' || actionType === 'ultimate';

    // Lapar/haus di bawah 50% -> actor jadi lemah, semua aksinya (damage/heal/regen/dll) kurang efektif
    // dan lebih gampang meleset kalau nyerang. Dicek dari sheet si actor (session.players), bukan target.
    const survival = survivalDebuffInfo(session, actorId);
    let survivalMult = 1;
    if (survival.count) {
      survivalMult = Math.max(0.4, 1 - SURVIVAL_DEBUFF_PCT_PER_STACK * survival.count);
      noteSuffix += ` [Lemah: ${survival.labels.join(' & ')} −${Math.round((1 - survivalMult) * 100)}%]`;
    }

    let elemModifier = 0;
    let elemNote = '';
    if (elementType && isAttack) {
      const actorElemPct = parseFloat(elemBonus) || 0;
      let targetElemPct = 0;
      if (entry.refType === 'player' && session.players[entry.refId]) {
        const ct = session.players[entry.refId].sheet.class_trait || {};
        targetElemPct = parseFloat(ct[elementType]) || 0;
      } else if (entry.elements) {
        targetElemPct = parseFloat(entry.elements[elementType]) || 0;
      }
      const netPct = actorElemPct - targetElemPct;
      elemModifier = Math.round(roll.total * netPct / 100);
      if (netPct !== 0) {
        elemNote = ` [${elementType} ${netPct > 0 ? '+' : ''}${netPct}% = ${elemModifier > 0 ? '+' : ''}${elemModifier}]`;
      }
    }

    let defReduction = 0;
    if (isAttack && entry.refType === 'player') {
      const targetPlayer = session.players[entry.refId];
      const defTotal = targetPlayer ? sumBuffStat(targetPlayer.sheet && targetPlayer.sheet.buffs, 'def') : 0;
      if (defTotal) defReduction = Math.max(0, Math.min(roll.total + elemModifier, defTotal));
    }

    // === To-hit roll ala RPG: d20 vs AC target. Natural 1 = auto-meleset, natural 20 = critical hit
    // (damage x2). Lapar/haus juga bikin akurasi turun (-1 per kondisi lemah yang aktif). ===
    let hitInfo = null, hitNote = '';
    if (isAttack && !noHit) {
      const d20 = 1 + Math.floor(Math.random() * 20);
      const targetAC = parseFloat(entry.ac);
      const ac = isNaN(targetAC) ? 10 : targetAC;
      const bonus = (parseFloat(toHitBonus) || 0) - survival.count;
      if (d20 === 1) hitInfo = { result: 'miss', crit: false, d20, ac };
      else if (d20 === 20) hitInfo = { result: 'hit', crit: true, d20, ac };
      else if (d20 + bonus >= ac) hitInfo = { result: 'hit', crit: false, d20, ac };
      else hitInfo = { result: 'miss', crit: false, d20, ac };
      hitNote = hitInfo.result === 'miss'
        ? ` — ❌ MELESET! (d20=${hitInfo.d20} vs AC ${hitInfo.ac})`
        : hitInfo.crit
          ? ` — 💢 CRITICAL HIT! (d20=${hitInfo.d20})`
          : ` — 🎯 Kena (d20=${hitInfo.d20} vs AC ${hitInfo.ac})`;
      // Statistik hit/miss/crit per actor, buat ditampilin DM (reset manual per sesi/battle).
      if (!session.battle.stats) session.battle.stats = {};
      if (!session.battle.stats[actor]) session.battle.stats[actor] = { hits: 0, misses: 0, crits: 0 };
      const st = session.battle.stats[actor];
      if (hitInfo.result === 'miss') st.misses++; else { st.hits++; if (hitInfo.crit) st.crits++; }
    }

    let effectiveTotal = Math.max(0, roll.total + elemModifier - defReduction);
    effectiveTotal = Math.round(effectiveTotal * survivalMult);
    if (hitInfo) {
      if (hitInfo.result === 'miss') effectiveTotal = 0;
      else if (hitInfo.crit) effectiveTotal = effectiveTotal * 2;
    }
    const defNote = defReduction ? ` (DEF -${defReduction})` : '';

    let resultText, logType = 'roll', next = null;
    if (map) {
      const cur = parseFloat(entry[map.field]) || 0;
      next = cur + map.sign * effectiveTotal;
      if (map.maxField) {
        const max = parseFloat(entry[map.maxField]);
        if (!isNaN(max)) next = Math.min(next, max);
      }
      next = Math.max(0, next);
      entry[map.field] = next;
      if (map.field === 'hp_current') {
        checkDeathState(entry, cur);
        if (next <= 0 && cur > 0 && entry.conditions.includes('Sekarat')) noteSuffix += ' 💀 Sekarat! (mulai death saving throw)';
        else if (next > 0 && cur <= 0) noteSuffix += ' ✨ Sadar kembali!';
      }

      if (entry.refType === 'player' && session.players[entry.refId]) {
        const tp = session.players[entry.refId];
        const fieldMap = {
          hp_current: 'current_hp', mp_current: 'mp_current', sp_current: 'sp_current',
          hp_max: 'max_hp', mp_max: 'mp_max', sp_max: 'sp_max', ac: 'ac'
        };
        if (fieldMap[map.field]) {
          tp.sheet[fieldMap[map.field]] = next;
          if (tp.socketId) io.to(tp.socketId).emit('your-sheet-updated', { sheet: tp.sheet });
          io.to('dm-' + code).emit('sheet-updated', { playerId: tp.id, sheet: tp.sheet });
        }
      }

      const maxLabel = map.maxField && entry[map.maxField] !== '' ? '/' + entry[map.maxField] : '';
      resultText = `${actor} pakai ${label} ke ${entry.name}${hitNote}: ${formula || '-'} = ${roll.total} (${roll.detail})${elemNote}${defNote} → ${entry.name} jadi ${next}${maxLabel}${noteSuffix}`;
      logType = isAttack ? 'damage' : (actionType === 'heal' ? 'heal' : 'roll');
    } else {
      resultText = `${actor} pakai ${label} ke ${entry.name}: ${formula || '-'} = ${roll.total} (${roll.detail})${noteSuffix}`;
    }

    return { entryId: entry.id, entryName: entry.name, resultText, logType, next, hit: hitInfo, roll: { ...roll, total: effectiveTotal } };
  }

  socket.on('battle:roll-action', ({ code, targetId, actionType, formula, actorName, note, elementType, elemBonus, toHitBonus, noHit }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Sesi tidak ditemukan.' });
    const targetIds = resolveTargetIds(session, targetId);
    if (!targetIds.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan (AoE: belum ada peserta yang cocok).' });
    const aoeGroup = aoeGroupFromTargetId(targetId);
    const actor = actorName || (socket.data.role === 'dm' ? 'DM' : 'Player');
    // actorId diambil dari sesi socket (bukan payload client) biar gak bisa dipalsukan buat ngehindarin
    // debuff lapar/haus sendiri.
    const actorId = socket.data.role === 'player' ? socket.data.playerId : null;

    const results = targetIds
      .map(tid => session.battle.entries[tid])
      .filter(Boolean)
      .map(entry => applyActionToEntry(session, code, entry, { actionType, formula, actor, actorId, note, elementType, elemBonus, toHitBonus, noHit: !!noHit }));
    if (!results.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan.' });

    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);

    // Event ringan khusus buat efek visual "vs card" (attacker vs target) di klien —
    // gak nyimpen apa-apa ke session, cuma broadcast portrait & hasil roll biar semua
    // orang di room lihat dramatisasi combat-nya, bukan cuma yang ngerjain aksi.
    const actorEntry = Object.values(session.battle.entries).find(e => e.name === actor);
    io.to('room-' + code).emit('battle:action-fx', {
      actorName: actor,
      actorPortrait: actorEntry ? actorEntry.portrait : null,
      actionType,
      formula,
      targets: results.map(r => ({
        entryId: r.entryId,
        entryName: r.entryName,
        portrait: (session.battle.entries[r.entryId] || {}).portrait || null,
        hit: r.hit,
        rollTotal: r.roll ? r.roll.total : null,
        logType: r.logType
      }))
    });

    let logEntry;
    if (aoeGroup) {
      const label = BATTLE_ACTION_LABEL[actionType] || actionType;
      const noteSuffix = note ? ' — ' + note : '';
      const summary = results.map(r => `${r.entryName}: ${r.roll.total}${r.next != null ? ` → ${r.next}` : ''}`).join(' | ');
      const logType = results.some(r => r.logType === 'damage') ? 'damage' : (results.some(r => r.logType === 'heal') ? 'heal' : 'roll');
      logEntry = {
        id: genId('log'), from: actor,
        text: `💥 ${actor} pakai ${label} (AoE ke ${AOE_GROUP_LABEL[aoeGroup]}): ${formula || '-'}${noteSuffix} → ${summary}`,
        type: logType, ts: Date.now(), secret: false
      };
    } else {
      logEntry = { id: genId('log'), from: actor, text: results[0].resultText, type: results[0].logType, ts: Date.now(), secret: false };
    }
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);

    cb && cb({
      ok: true,
      aoe: !!aoeGroup,
      results: results.map(r => ({ entryId: r.entryId, entryName: r.entryName, roll: r.roll, next: r.next, hit: r.hit })),
      entry: session.battle.entries[targetIds[0]],
      roll: results[0].roll,
      hit: results[0].hit
    });
  });

  // === Death Saving Throw: dipanggil pas entry lagi "Sekarat" (HP 0). d20: >=10 sukses,
  // <10 gagal, natural 1 = 2 gagal sekaligus, natural 20 = langsung sadar dengan HP 1.
  // 3 sukses -> Stabil (gak sadar tapi aman). 3 gagal -> Mati.
  socket.on('battle:death-save', ({ code, targetId }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Sesi tidak ditemukan.' });
    const entry = session.battle.entries[targetId];
    if (!entry) return cb && cb({ ok: false, error: 'Target tidak ditemukan.' });
    if (!entry.conditions || !entry.conditions.includes('Sekarat')) {
      return cb && cb({ ok: false, error: `${entry.name} sedang tidak dalam kondisi Sekarat.` });
    }
    if (!entry.death_saves) entry.death_saves = { success: 0, fail: 0 };
    const d20 = 1 + Math.floor(Math.random() * 20);
    let text;
    if (d20 === 20) {
      entry.hp_current = 1;
      entry.conditions = entry.conditions.filter(c => c !== 'Sekarat');
      entry.death_saves = null;
      text = `✨ ${entry.name} roll death save: d20=20 — NATURAL 20! Langsung sadar dengan 1 HP!`;
    } else if (d20 === 1) {
      entry.death_saves.fail += 2;
      text = `💀 ${entry.name} roll death save: d20=1 — Natural 1, gagal x2! (${entry.death_saves.success} sukses / ${entry.death_saves.fail} gagal)`;
    } else if (d20 >= 10) {
      entry.death_saves.success += 1;
      text = `🎲 ${entry.name} roll death save: d20=${d20} — Sukses. (${entry.death_saves.success} sukses / ${entry.death_saves.fail} gagal)`;
    } else {
      entry.death_saves.fail += 1;
      text = `🎲 ${entry.name} roll death save: d20=${d20} — Gagal. (${entry.death_saves.success} sukses / ${entry.death_saves.fail} gagal)`;
    }
    if (entry.death_saves && entry.death_saves.success >= 3) {
      entry.conditions = entry.conditions.filter(c => c !== 'Sekarat').concat('Stabil');
      text += ` — ${entry.name} kini STABIL.`;
    } else if (entry.death_saves && entry.death_saves.fail >= 3) {
      entry.conditions = entry.conditions.filter(c => c !== 'Sekarat').concat('Mati');
      text += ` — ${entry.name} MENINGGAL.`;
    }
    const logEntry = { id: genId('log'), from: 'Sistem', text, type: 'system', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true });
  });
  socket.on('battle:apply-status', ({ code, targetId, condition, actorName }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Sesi tidak ditemukan.' });
    const targetIds = resolveTargetIds(session, targetId);
    if (!targetIds.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan (AoE: belum ada peserta yang cocok).' });
    const aoeGroup = aoeGroupFromTargetId(targetId);
    const actor = actorName || (socket.data.role === 'dm' ? 'DM' : 'Player');
    const condText = condition === 'Normal' ? 'kondisi dihapus (Normal)' : `terkena ${condition}`;

    const affectedNames = [];
    targetIds.forEach(tid => {
      const entry = session.battle.entries[tid];
      if (!entry) return;
      if (!Array.isArray(entry.conditions)) entry.conditions = [];

      if (condition === 'Normal') {
        entry.conditions = [];
      } else if (!entry.conditions.includes(condition)) {
        entry.conditions.push(condition);
      }
      affectedNames.push(entry.name);

      if (entry.refType === 'player' && session.players[entry.refId]) {
        const tp = session.players[entry.refId];
        if (tp.socketId) io.to(tp.socketId).emit('battle-apply-status', { targetId: tid, condition });
      }
    });
    if (!affectedNames.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan.' });

    const logEntry = {
      id: genId('log'), from: 'Sistem',
      text: aoeGroup
        ? `⚡ ${actor} menerapkan status ke ${AOE_GROUP_LABEL[aoeGroup]} (${affectedNames.join(', ')}): ${condText}.`
        : `⚡ ${actor} menerapkan status: ${affectedNames[0]} ${condText}.`,
      type: 'system', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();

    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true, aoe: !!aoeGroup, affected: affectedNames });
  });

  // === DM: kelola katalog Shop Item (CRUD + import Excel/JSON bulk) ===
  socket.on('dm:shop-save-item', ({ code, item }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!item || !(item.nama || '').trim()) return cb && cb({ ok: false, error: 'Nama item kosong.' });
    const id = item.id || genId('shop');
    session.shop.items[id] = {
      id, nama: item.nama || '', harga: item.harga ?? 0, tipe: item.tipe || '',
      stok: item.stok ?? '', deskripsi: item.deskripsi || '',
      // Efek item (heal/damage/buff/dll + formula dadu) — dibawa otomatis ke inventory pas player beli,
      // jadi gak perlu diketik ulang manual tiap mau dipakai. aoe: true = otomatis kena ke semua musuh/sekutu.
      efekTipe: item.efekTipe || 'misc', efekFormula: item.efekFormula || '', aoe: !!item.aoe
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
    cb && cb({ ok: true, item: session.shop.items[id] });
  });

  socket.on('dm:shop-delete-item', ({ code, itemId }) => {
    const session = sessions[code];
    if (!session || !session.shop) return;
    delete session.shop.items[itemId];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
  });

  // Import massal dari Excel (parsed jadi array of object di client via SheetJS)
  socket.on('dm:shop-import', ({ code, items }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    let count = 0;
    (items || []).forEach(it => {
      const nama = (it.nama || '').trim();
      if (!nama) return;
      const id = genId('shop');
      session.shop.items[id] = {
        id, nama, harga: it.harga ?? 0, tipe: it.tipe || '',
        stok: it.stok ?? '', deskripsi: it.deskripsi || '',
        efekTipe: it.efekTipe || it.efek_tipe || 'misc', efekFormula: it.efekFormula || it.efek_formula || '',
        aoe: !!(it.aoe === true || it.aoe === 'true' || it.aoe === 1 || it.aoe === '1')
      };
      count++;
    });
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
    cb && cb({ ok: true, count });
  });

  socket.on('dm:shop-clear', ({ code }) => {
    const session = sessions[code];
    if (!session || !session.shop) return;
    session.shop.items = {};
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
  });

  // === Musik (DM upload/URL/YouTube, play/pause/stop tersinkron ke semua player) ===
  socket.on('dm:music-add', ({ code, name, url }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!url) return cb && cb({ ok: false, error: 'URL/file kosong.' });
    const id = genId('mu');
    const ytId = extractYoutubeId(url);
    session.music.tracks[id] = ytId
      ? { id, name: name || 'Tanpa Judul', url, type: 'youtube', videoId: ytId, addedAt: Date.now() }
      : { id, name: name || 'Tanpa Judul', url, type: 'audio', addedAt: Date.now() };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
    cb && cb({ ok: true, id });
  });

  socket.on('dm:music-remove', ({ code, id }) => {
    const session = sessions[code];
    if (!session || !session.music.tracks[id]) return;
    delete session.music.tracks[id];
    if (session.music.playback.trackId === id) {
      session.music.playback = { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: session.music.playback.volume, loop: session.music.playback.loop };
      io.to('room-' + code).emit('music-state', session.music.playback);
    }
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
  });

  // === Player: nambahin lagu ke playlist bareng (cuma link YouTube, biar gak numpuk file base64 dari banyak orang) ===
  socket.on('player:music-add', ({ code, name, url }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!url) return cb && cb({ ok: false, error: 'Link kosong.' });
    const ytId = extractYoutubeId(url);
    if (!ytId) return cb && cb({ ok: false, error: 'Cuma link YouTube yang didukung ya.' });
    const player = session.players[socket.data.playerId];
    if (!player) return cb && cb({ ok: false });
    const id = genId('mu');
    session.music.tracks[id] = {
      id, name: (name || '').trim() || 'Tanpa Judul', url, type: 'youtube', videoId: ytId,
      addedAt: Date.now(), addedBy: player.name
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
    const logEntry = { id: genId('log'), from: 'Musik', text: `🎵 ${player.name} menambahkan lagu: ${session.music.tracks[id].name}`, type: 'narrative', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true, id });
  });

  // === Player: hapus lagu yang dia sendiri tambahkan ===
  socket.on('player:music-remove', ({ code, id }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return;
    const track = session.music.tracks[id];
    if (!track) return;
    const player = session.players[socket.data.playerId];
    if (!player || track.addedBy !== player.name) return; // cuma boleh hapus punya sendiri
    delete session.music.tracks[id];
    if (session.music.playback.trackId === id) {
      session.music.playback = { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: session.music.playback.volume, loop: session.music.playback.loop };
      io.to('room-' + code).emit('music-state', session.music.playback);
    }
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
  });

  // === Player: putar lagu dari playlist bersama (kayak jukebox — kedengeran ke semua orang) ===
  socket.on('player:music-play', ({ code, id }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return;
    if (!session.music.tracks[id]) return;
    session.music.playback.trackId = id;
    session.music.playback.position = 0;
    session.music.playback.isPlaying = true;
    session.music.playback.startTs = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  socket.on('dm:music-play', ({ code, id }) => {
    const session = sessions[code];
    if (!session || !session.music.tracks[id]) return;
    session.music.playback.trackId = id;
    session.music.playback.position = 0;
    session.music.playback.isPlaying = true;
    session.music.playback.startTs = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  socket.on('dm:music-pause', ({ code }) => {
    const session = sessions[code];
    if (!session || !session.music.playback.trackId) return;
    const pb = session.music.playback;
    if (pb.isPlaying) pb.position = (Date.now() - pb.startTs) / 1000;
    pb.isPlaying = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', pb);
  });

  socket.on('dm:music-resume', ({ code }) => {
    const session = sessions[code];
    if (!session || !session.music.playback.trackId) return;
    const pb = session.music.playback;
    pb.isPlaying = true;
    pb.startTs = Date.now() - (pb.position || 0) * 1000;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', pb);
  });

  socket.on('dm:music-stop', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    const pb = session.music.playback;
    pb.isPlaying = false;
    pb.position = 0;
    pb.startTs = 0;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', pb);
  });

  socket.on('dm:music-volume', ({ code, volume }) => {
    const session = sessions[code];
    if (!session) return;
    session.music.playback.volume = Math.max(0, Math.min(1, parseFloat(volume) || 0));
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  socket.on('dm:music-loop', ({ code, loop }) => {
    const session = sessions[code];
    if (!session) return;
    session.music.playback.loop = !!loop;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  // === Story: Scene Banner (adegan saat ini, tersiar ke semua player) ===
  socket.on('dm:scene-set', ({ code, title, desc, imageUrl }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!title || !title.trim()) return cb && cb({ ok: false, error: 'Isi judul adegan.' });
    session.story.scene = {
      title: title.trim(), desc: (desc || '').trim(),
      imageUrl: imageUrl !== undefined ? imageUrl : session.story.scene.imageUrl,
      active: true, updatedAt: Date.now()
    };
    const logEntry = {
      id: genId('log'), from: 'Cerita',
      text: `📖 ${session.story.scene.title}${session.story.scene.desc ? ' — ' + session.story.scene.desc : ''}`,
      type: 'narrative', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('scene-updated', session.story.scene);
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  socket.on('dm:scene-clear', ({ code }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    ensureSessionDefaults(session);
    session.story.scene.active = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('scene-updated', session.story.scene);
  });

  // === Story: Dialog NPC (visual-novel style, tersiar ke semua player) ===
  socket.on('dm:dialogue-say', ({ code, npcName, npcPortrait, text }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!text || !text.trim()) return cb && cb({ ok: false, error: 'Isi dialognya dulu.' });
    session.story.dialogue = {
      npcName: (npcName || 'NPC').trim() || 'NPC',
      npcPortrait: npcPortrait !== undefined ? npcPortrait : session.story.dialogue.npcPortrait,
      text: text.trim(), active: true, updatedAt: Date.now()
    };
    const logEntry = {
      id: genId('log'), from: session.story.dialogue.npcName,
      text: `💬 ${session.story.dialogue.text}`,
      type: 'dialogue', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('dialogue-updated', session.story.dialogue);
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  socket.on('dm:dialogue-clear', ({ code }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    ensureSessionDefaults(session);
    session.story.dialogue.active = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('dialogue-updated', session.story.dialogue);
  });

  // === Story: Quest / Objective Tracker ===
  socket.on('dm:quest-save', ({ code, quest }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!quest || !quest.title || !quest.title.trim()) return cb && cb({ ok: false, error: 'Isi judul quest.' });
    const isExisting = quest.id && session.story.quests[quest.id];
    const id = isExisting ? quest.id : genId('q');
    const prevStatus = isExisting ? session.story.quests[id].status : null;
    const q = {
      id, title: quest.title.trim(), desc: (quest.desc || '').trim(),
      status: quest.status || 'aktif', updatedAt: Date.now(),
      acceptedBy: isExisting ? (session.story.quests[id].acceptedBy || {}) : {},
      objectives: isExisting ? (session.story.quests[id].objectives || []) : []
    };
    session.story.quests[id] = q;
    let logText = null;
    if (!isExisting) logText = `📜 Quest baru: ${q.title}`;
    else if (prevStatus !== q.status) {
      if (q.status === 'selesai') logText = `✅ Quest selesai: ${q.title}`;
      else if (q.status === 'gagal') logText = `❌ Quest gagal: ${q.title}`;
      else logText = `📜 Quest diperbarui: ${q.title}`;
    }
    if (logText) {
      const logEntry = { id: genId('log'), from: 'Cerita', text: logText, type: 'quest', ts: Date.now(), secret: false };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + code).emit('chat:new', logEntry);
    }
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    cb && cb({ ok: true, id });
  });

  socket.on('dm:quest-delete', ({ code, questId }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    ensureSessionDefaults(session);
    if (!session.story.quests[questId]) return;
    delete session.story.quests[questId];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
  });

  // === Player: ambil quest (biar quest gak cuma tampil doang, player bisa "commit" ngerjain) ===
  socket.on('player:quest-accept', ({ code, questId }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const quest = session.story.quests[questId];
    if (!quest) return cb && cb({ ok: false, error: 'Quest tidak ditemukan.' });
    const player = session.players[socket.data.playerId];
    if (!player) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (!quest.acceptedBy) quest.acceptedBy = {};
    if (quest.acceptedBy[player.id]) return cb && cb({ ok: true }); // udah diambil sebelumnya
    quest.acceptedBy[player.id] = { name: player.name, acceptedAt: Date.now(), completed: false, completedAt: null };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    const logEntry = { id: genId('log'), from: 'Quest', text: `📜 ${player.name} mengambil quest: ${quest.title}`, type: 'quest', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  // === Player: tandai quest yang diambil sebagai selesai di sisi dia (menunggu DM ubah status resmi) ===
  socket.on('player:quest-complete', ({ code, questId }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const quest = session.story.quests[questId];
    if (!quest || !quest.acceptedBy || !quest.acceptedBy[socket.data.playerId]) {
      return cb && cb({ ok: false, error: 'Kamu belum ambil quest ini.' });
    }
    const player = session.players[socket.data.playerId];
    quest.acceptedBy[socket.data.playerId].completed = true;
    quest.acceptedBy[socket.data.playerId].completedAt = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    const logEntry = { id: genId('log'), from: 'Quest', text: `✅ ${player.name} menyelesaikan bagiannya di quest: ${quest.title} (menunggu konfirmasi DM)`, type: 'quest', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  // === Quest: DM tambah objektif (sub-goal checklist) ke quest ===
  socket.on('dm:quest-add-objective', ({ code, questId, text }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return cb && cb({ ok: false });
    const quest = session.story.quests[questId];
    if (!quest) return cb && cb({ ok: false, error: 'Quest tidak ditemukan.' });
    const t = (text || '').trim();
    if (!t) return cb && cb({ ok: false, error: 'Isi teks objektif.' });
    if (!Array.isArray(quest.objectives)) quest.objectives = [];
    quest.objectives.push({ id: genId('obj'), text: t, done: false });
    quest.updatedAt = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    cb && cb({ ok: true });
  });

  socket.on('dm:quest-remove-objective', ({ code, questId, objectiveId }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    const quest = session.story.quests[questId];
    if (!quest || !Array.isArray(quest.objectives)) return;
    quest.objectives = quest.objectives.filter(o => o.id !== objectiveId);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
  });

  // === Quest: toggle centang objektif — boleh DM ATAU player yang udah ambil quest itu
  // (checklist bareng-bareng, biar party bisa lacak progress sama-sama). ===
  function toggleQuestObjective(session, code, questId, objectiveId, actorName) {
    const quest = session.story.quests[questId];
    if (!quest || !Array.isArray(quest.objectives)) return null;
    const obj = quest.objectives.find(o => o.id === objectiveId);
    if (!obj) return null;
    obj.done = !obj.done;
    quest.updatedAt = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    const logEntry = {
      id: genId('log'), from: 'Quest',
      text: `${obj.done ? '☑' : '☐'} ${actorName} ${obj.done ? 'menyelesaikan' : 'membuka lagi'} objektif "${obj.text}" (${quest.title})`,
      type: 'quest', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    return obj;
  }
  socket.on('dm:quest-toggle-objective', ({ code, questId, objectiveId }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return cb && cb({ ok: false });
    const obj = toggleQuestObjective(session, code, questId, objectiveId, 'DM');
    cb && cb(obj ? { ok: true } : { ok: false, error: 'Objektif tidak ditemukan.' });
  });
  socket.on('player:quest-toggle-objective', ({ code, questId, objectiveId }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false });
    const quest = session.story.quests[questId];
    if (!quest || !quest.acceptedBy || !quest.acceptedBy[socket.data.playerId]) {
      return cb && cb({ ok: false, error: 'Kamu belum ambil quest ini.' });
    }
    const player = session.players[socket.data.playerId];
    const obj = toggleQuestObjective(session, code, questId, objectiveId, player.name);
    cb && cb(obj ? { ok: true } : { ok: false, error: 'Objektif tidak ditemukan.' });
  });

  // === Story: Handout (kirim dokumen/gambar/catatan ke satu atau semua player) ===
  socket.on('dm:handout-send', ({ code, playerId, title, imageUrl, text }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!title || !title.trim()) return cb && cb({ ok: false, error: 'Isi judul dokumen.' });
    const handout = { id: genId('ho'), title: title.trim(), imageUrl: imageUrl || null, text: (text || '').trim(), ts: Date.now() };
    const target = playerId && session.players[playerId] ? session.players[playerId] : null;
    const targetLabel = target ? (target.sheet.nama_karakter || target.name) : 'Semua Pemain';
    const logEntry = {
      id: genId('log'), from: 'DM', text: `🎁 Dokumen untuk ${targetLabel}: ${handout.title}`,
      type: 'handout', ts: Date.now(), secret: false, imageUrl: handout.imageUrl, handoutText: handout.text
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:new', logEntry);
    if (target) { if (target.socketId) io.to(target.socketId).emit('story:handout', handout); }
    else { io.to('room-' + code).emit('story:handout', handout); }
    cb && cb({ ok: true });
  });

  // === Story: tandai/lepas entri log jadi "penting" (dipakai panel Recap) ===
  socket.on('dm:log-star', ({ code, id, starred }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    const entry = session.log.find(e => e.id === id);
    if (!entry) return;
    entry.starred = !!starred;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:starred', { id, starred: entry.starred });
  });

  // === Chat & dice log bersama ===
  // Roll dadu DM BISA dipilih rahasia atau engga (checkbox di sisi DM, dikirim
  // lewat `secret`). Roll/chat dari player selalu terlihat semua orang.
  // Status DM diambil dari socket.data.role (bukan dari payload client) biar
  // gak bisa dipalsukan oleh player.
  socket.on('chat:send', ({ code, from, text, type, secret }) => {
    const session = sessions[code];
    if (!session) return;
    const isDM = socket.data.role === 'dm';
    const isSecret = isDM && type === 'roll' && !!secret;
    const entry = { id: genId('log'), from, text, type: type || 'chat', ts: Date.now(), secret: isSecret };
    session.log.push(entry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    if (isSecret) {
      io.to('dm-' + code).emit('chat:new', entry);
    } else {
      io.to('room-' + code).emit('chat:new', entry);
    }
  });

  // === DM: pesan pribadi ke 1 player — cuma DM & player itu yang lihat, gak masuk ke log ===
  // === umum player lain. Tersimpan sebagai entry secret+toPlayerId biar tetap ada pas player ===
  // === reconnect (lihat sessionStateForPlayer di atas).
  socket.on('dm:whisper', ({ code, playerId, text }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Sesi tidak ditemukan.' });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false, error: 'Cuma DM yang bisa kirim pesan pribadi.' });
    const player = session.players[playerId];
    if (!player) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const msg = (text || '').trim();
    if (!msg) return cb && cb({ ok: false, error: 'Pesan kosong.' });
    const entry = {
      id: genId('log'), from: `DM ➜ ${player.sheet.nama_karakter || player.name} (privat)`,
      text: msg, type: 'whisper', ts: Date.now(), secret: true, toPlayerId: playerId
    };
    session.log.push(entry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('chat:new', entry);
    if (player.socketId) io.to(player.socketId).emit('chat:new', entry);
    cb && cb({ ok: true });
  });

  // === DM: perlihatkan roll rahasia yang sudah dilempar ke semua player ===
  socket.on('dm:reveal-roll', ({ code, id }) => {
    const session = sessions[code];
    if (!session) return;
    if (socket.data.role !== 'dm') return;
    const entry = session.log.find(e => e.id === id);
    if (!entry || !entry.secret) return;
    entry.secret = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:revealed', entry);
  });

  socket.on('chat:clear', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    if (socket.data.role !== 'dm') return;
    session.log = [];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:cleared');
  });

  // === Disconnect ===

  // ====================== CODEX DM: library kustom, villain/faksi/lore, kalender ======================
  function dmOnly(code) {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return null;
    ensureSessionDefaults(session);
    return session;
  }
  const str = (v, max) => String(v == null ? '' : v).slice(0, max || 500);

  // Library kustom (monster/spell hasil Paste & Go atau buatan sendiri). Bawaan SRD ada di client (srd-data.js).
  socket.on('dm:library-save', ({ code, kind, entry }, cb) => {
    const session = dmOnly(code); if (!session || !entry) return cb && cb({ ok: false });
    if (kind !== 'monsters' && kind !== 'spells') return cb && cb({ ok: false, error: 'Jenis library tidak dikenal.' });
    if (!entry.n || !String(entry.n).trim()) return cb && cb({ ok: false, error: 'Nama wajib diisi.' });
    if (JSON.stringify(entry).length > 60000) return cb && cb({ ok: false, error: 'Entri terlalu besar.' });
    if (Object.keys(session.library[kind]).length >= 500) return cb && cb({ ok: false, error: 'Library penuh (maks 500 entri).' });
    entry.id = entry.id || genId(kind === 'spells' ? 'sp' : 'mn');
    entry.custom = true;
    session.library[kind][entry.id] = entry;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('library-update', session.library);
    cb && cb({ ok: true, id: entry.id });
  });
  // Ras homebrew: tampil di pemilih ras pemain (bertanda Homebrew) dan mengisi trait dengan efek stat.
  const RACE_STATS = ['', 'ac', 'hp_max', 'mp_max', 'sp_max', 'atk', 'def', 'other'];
  socket.on('dm:race-save', ({ code, race }, cb) => {
    const session = dmOnly(code); if (!session || !race) return cb && cb({ ok: false });
    const nama = str(race.nama, 40).trim();
    if (!nama) return cb && cb({ ok: false, error: 'Nama ras wajib diisi.' });
    const dup = Object.values(session.races).find(r => r.nama.toLowerCase() === nama.toLowerCase() && r.id !== race.id);
    if (dup) return cb && cb({ ok: false, error: 'Sudah ada ras dengan nama itu.' });
    const id = race.id && session.races[race.id] ? race.id : genId('rc');
    if (!session.races[id] && Object.keys(session.races).length >= 60) return cb && cb({ ok: false, error: 'Maksimal 60 ras homebrew.' });
    const traits = (Array.isArray(race.traits) ? race.traits : []).slice(0, 4).map(t => ({
      nama: str(t && t.nama, 40).trim(),
      stat: RACE_STATS.includes(t && t.stat) ? t.stat : '',
      amount: (t && t.amount !== '' && t.amount != null && !isNaN(parseFloat(t.amount))) ? String(parseFloat(t.amount)) : ''
    })).filter(t => t.nama || t.stat);
    session.races[id] = { id, nama, desc: str(race.desc, 300).trim(), traits, updatedAt: Date.now() };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('races-update', session.races);
    io.to('dm-' + code).emit('races-update', session.races);
    cb && cb({ ok: true, id });
  });
  socket.on('dm:race-delete', ({ code, id }) => {
    const session = dmOnly(code); if (!session || !session.races[id]) return;
    delete session.races[id];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('races-update', session.races);
    io.to('dm-' + code).emit('races-update', session.races);
  });

  socket.on('dm:library-delete', ({ code, kind, id }) => {
    const session = dmOnly(code); if (!session || !session.library[kind]) return;
    delete session.library[kind][id];
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('library-update', session.library);
  });

  // Codex: villain / faction / lore / location (khusus DM; berisi rahasia)
  const CODEX_TYPES = ['villain', 'faction', 'lore', 'location'];
  socket.on('dm:codex-save', ({ code, entry }, cb) => {
    const session = dmOnly(code); if (!session || !entry) return cb && cb({ ok: false });
    if (!CODEX_TYPES.includes(entry.type)) return cb && cb({ ok: false, error: 'Jenis entri tidak dikenal.' });
    if (!entry.name || !String(entry.name).trim()) return cb && cb({ ok: false, error: 'Nama wajib diisi.' });
    const id = entry.id && session.codex[entry.id] ? entry.id : (entry.id || genId('cx'));
    if (!session.codex[id] && Object.keys(session.codex).length >= 600) return cb && cb({ ok: false, error: 'Codex penuh (maks 600 entri).' });
    const prev = session.codex[id] || {};
    session.codex[id] = {
      id, type: entry.type,
      name: str(entry.name, 120),
      rank: str(entry.rank, 40),                    // villain: Minion / Lieutenant / Elite / Boss / Overlord
      status: str(entry.status, 40) || 'aktif',     // aktif / defeated / bersembunyi / ...
      hp: str(entry.hp, 12), ac: str(entry.ac, 12),
      desc: str(entry.desc, 4000),
      plan: str(entry.plan, 4000),                  // rencana jahat / tujuan faksi / catatan
      secret: str(entry.secret, 4000),
      attitude: str(entry.attitude, 40),            // faction: sekutu / netral / musuh
      loyalty: Math.max(-100, Math.min(100, parseInt(entry.loyalty, 10) || 0)),
      members: (Array.isArray(entry.members) ? entry.members : []).slice(0, 100).map(m => str(m, 60)),
      imageUrl: typeof entry.imageUrl === 'string' && entry.imageUrl.length < 700000 ? entry.imageUrl : (prev.imageUrl || null),
      updatedAt: Date.now()
    };
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('codex-update', session.codex);
    cb && cb({ ok: true, id });
  });
  socket.on('dm:codex-delete', ({ code, id }) => {
    const session = dmOnly(code); if (!session) return;
    delete session.codex[id];
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('codex-update', session.codex);
  });

  // Encounter tersimpan (daftar makhluk + jumlah) — dipakai Encounter Builder
  socket.on('dm:encounter-save', ({ code, encounter }, cb) => {
    const session = dmOnly(code); if (!session || !encounter) return cb && cb({ ok: false });
    if (!encounter.name || !String(encounter.name).trim()) return cb && cb({ ok: false, error: 'Nama encounter wajib diisi.' });
    const list = (Array.isArray(encounter.creatures) ? encounter.creatures : []).slice(0, 40).map(c => ({
      name: str(c && c.name, 80), cr: str(c && c.cr, 8) || '0', count: Math.max(1, Math.min(50, parseInt(c && c.count, 10) || 1)),
      hp: str(c && c.hp, 8), ac: str(c && c.ac, 8), dexMod: parseInt(c && c.dexMod, 10) || 0
    })).filter(c => c.name);
    if (!list.length) return cb && cb({ ok: false, error: 'Tambahkan minimal 1 makhluk.' });
    const id = encounter.id && session.encounters[encounter.id] ? encounter.id : genId('enc');
    if (!session.encounters[id] && Object.keys(session.encounters).length >= 200) return cb && cb({ ok: false, error: 'Terlalu banyak encounter tersimpan.' });
    session.encounters[id] = { id, name: str(encounter.name, 80), notes: str(encounter.notes, 1000), creatures: list, updatedAt: Date.now() };
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('encounters-update', session.encounters);
    cb && cb({ ok: true, id });
  });
  socket.on('dm:encounter-delete', ({ code, id }) => {
    const session = dmOnly(code); if (!session) return;
    delete session.encounters[id];
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('encounters-update', session.encounters);
  });

  // Kalender dunia
  function calYearLen(cal) { return cal.months.reduce((a, m) => a + m.days, 0) || 1; }
  function calToIndex(cal, y, mo, d) {
    let idx = y * calYearLen(cal);
    for (let i = 0; i < mo; i++) idx += cal.months[i].days;
    return idx + (d - 1);
  }
  function calFromIndex(cal, idx) {
    const yl = calYearLen(cal);
    let y = Math.floor(idx / yl), rem = idx - y * yl, mo = 0;
    while (mo < cal.months.length - 1 && rem >= cal.months[mo].days) { rem -= cal.months[mo].days; mo++; }
    return { year: y, month: mo, day: rem + 1 };
  }
  function calBroadcast(code, session) {
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('calendar-update', session.calendar);
    io.to('dm-' + code).emit('calendar-update', session.calendar);
  }
  socket.on('dm:calendar-advance', ({ code, days }, cb) => {
    const session = dmOnly(code); if (!session) return cb && cb({ ok: false });
    const n = Math.max(-3650, Math.min(3650, parseInt(days, 10) || 0));
    if (!n) return cb && cb({ ok: false });
    const cal = session.calendar;
    const from = calToIndex(cal, cal.year, cal.month, cal.day);
    const to = Math.max(0, from + n);
    const nd = calFromIndex(cal, to);
    cal.year = nd.year; cal.month = nd.month; cal.day = nd.day;
    // event yang jatuh di antara tanggal lama (tidak termasuk) dan baru (termasuk)
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const triggered = Object.values(cal.events || {}).filter(ev => {
      const i = calToIndex(cal, ev.year, ev.month, ev.day);
      return i > lo && i <= hi || (n > 0 ? false : i === lo && lo !== hi && false);
    });
    const logEntry = {
      id: genId('log'), from: 'Kalender',
      text: `📅 ${n > 0 ? 'Waktu berlalu' : 'Waktu mundur'} ${Math.abs(n)} hari → ${cal.day} ${cal.months[cal.month].name}, Tahun ${cal.year}`,
      type: 'narrative', ts: Date.now(), secret: false
    };
    session.log.push(logEntry); if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    calBroadcast(code, session);
    cb && cb({ ok: true, triggered });
  });
  socket.on('dm:calendar-set', ({ code, year, month, day }) => {
    const session = dmOnly(code); if (!session) return;
    const cal = session.calendar;
    const mo = Math.max(0, Math.min(cal.months.length - 1, (parseInt(month, 10) || 1) - 1));
    cal.year = Math.max(0, parseInt(year, 10) || 0);
    cal.month = mo;
    cal.day = Math.max(1, Math.min(cal.months[mo].days, parseInt(day, 10) || 1));
    calBroadcast(code, session);
  });
  socket.on('dm:calendar-config', ({ code, months }, cb) => {
    const session = dmOnly(code); if (!session) return cb && cb({ ok: false });
    const clean = (Array.isArray(months) ? months : []).slice(0, 24).map(m => ({
      name: str(m && m.name, 30) || 'Bulan', days: Math.max(1, Math.min(60, parseInt(m && m.days, 10) || 30))
    }));
    if (!clean.length) return cb && cb({ ok: false, error: 'Minimal 1 bulan.' });
    const cal = session.calendar;
    cal.months = clean;
    cal.month = Math.min(cal.month, clean.length - 1);
    cal.day = Math.min(cal.day, clean[cal.month].days);
    Object.values(cal.events || {}).forEach(ev => { ev.month = Math.min(ev.month, clean.length - 1); ev.day = Math.min(ev.day, clean[ev.month].days); });
    calBroadcast(code, session);
    cb && cb({ ok: true });
  });
  socket.on('dm:calendar-event-save', ({ code, event }, cb) => {
    const session = dmOnly(code); if (!session || !event) return cb && cb({ ok: false });
    const cal = session.calendar;
    if (!event.title || !String(event.title).trim()) return cb && cb({ ok: false, error: 'Judul event wajib diisi.' });
    if (!cal.events) cal.events = {};
    if (!cal.events[event.id] && Object.keys(cal.events).length >= 500) return cb && cb({ ok: false, error: 'Terlalu banyak event.' });
    const id = event.id || genId('ev');
    const mo = Math.max(0, Math.min(cal.months.length - 1, parseInt(event.month, 10) || 0));
    cal.events[id] = { id, title: str(event.title, 120), desc: str(event.desc, 1000), year: Math.max(0, parseInt(event.year, 10) || 0), month: mo,
      day: Math.max(1, Math.min(cal.months[mo].days, parseInt(event.day, 10) || 1)) };
    calBroadcast(code, session);
    cb && cb({ ok: true, id });
  });
  socket.on('dm:calendar-event-delete', ({ code, id }) => {
    const session = dmOnly(code); if (!session) return;
    if (session.calendar.events) delete session.calendar.events[id];
    calBroadcast(code, session);
  });

  // === TV / layar bersama: penonton baca-saja (tanpa nama, tanpa sheet) ===
  // Cukup buka /tv.html?code=KODE di laptop/TV yang disambung ke layar besar.
  socket.on('tv:join', ({ code }, cb) => {
    code = (code || '').toUpperCase().trim();
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Kode sesi tidak ditemukan.' });
    ensureSessionDefaults(session);
    socket.join('room-' + code);
    socket.data.role = 'tv';
    socket.data.code = code;
    cb && cb({
      ok: true,
      code,
      state: {
        maps: mapTabList(session),
        activeMapId: session.activeMapId,
        map: activeMap(session),
        tokens: activeMap(session).tokens,
        battle: session.battle,
        story: session.story,
        players: publicPlayerList(session),
        calendar: session.calendar
      }
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code || !sessions[code]) return;
    const session = sessions[code];
    if (socket.data.role === 'dm' && session.dmSocketId === socket.id) {
      session.dmSocketId = null;
      socket.to('room-' + code).emit('dm:online', false);
    } else if (socket.data.role === 'player' && socket.data.playerId) {
      const p = session.players[socket.data.playerId];
      if (p && p.socketId === socket.id) {
        p.socketId = null;
        io.to('dm-' + code).emit('player-online', { id: p.id, online: false });
      }
    }
    saveSessionsDebounced(code);
  });
});


