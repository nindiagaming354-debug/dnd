# DnD VTT — Character Sheet + DM Board (lokal, via localhost)

Aplikasi kecil untuk main D&D (atau sistem sejenis) bareng teman lewat browser:
- **Character sheet interaktif** untuk player (auto-hitung modifier, auto-save).
- **DM Board / VTT ringan**: peta + grid + token, daftar pemain (lihat HP & sheet real-time), sheet NPC, initiative tracker, dan log chat/dice.
- Jalan sebagai **server lokal** (Node.js), semua orang connect ke satu komputer host lewat jaringan yang sama. Tidak butuh database atau akun — cukup **kode sesi 5 karakter**.

## 1. Yang perlu di-install
- **Node.js** (versi 18 ke atas) — download di https://nodejs.org (pilih versi LTS).

## 2. Cara menjalankan

Buka terminal / command prompt di folder ini (`dnd-vtt`), lalu:

```bash
npm install
npm start
```

Kalau berhasil, akan muncul:

```
DnD VTT server jalan di http://localhost:3000
```

## 3. Cara main

### Jika kamu DM (host)
1. Buka `http://localhost:3000` di browser.
2. Pilih **"Aku Dungeon Master"** → isi nama → **Buat Sesi Baru**.
3. Kamu akan diarahkan ke **DM Board**, dan dapat **kode sesi 5 karakter** (mis. `K7X2P`) yang muncul di pojok kanan atas.
4. Bagikan kode itu ke pemain lain.
5. Kalau browser DM tertutup / server restart, tinggal buka lagi `http://localhost:3000` → pilih DM → masukkan kode sesi yang sama di kolom **"Lanjutkan Sesi"**. Data tidak hilang (tersimpan di `data/sessions.json`).

### Jika kamu Player
1. Buka `http://localhost:3000` (kalau main di komputer yang sama), **atau** alamat IP DM (lihat bagian "Main lewat jaringan" di bawah).
2. Pilih **"Aku Player"** → isi nama & kode sesi dari DM → **Gabung Sesi**.
3. Kamu masuk ke halaman **Character Sheet** — isi semua data karaktermu. Semua perubahan **otomatis tersimpan** dan langsung terlihat oleh DM (nama, HP, level, dll).
4. Kalau kamu tutup tab / refresh, tinggal join lagi dengan kode & nama yang sama — sheet-mu tetap ada (disimpan otomatis di browser lewat `localStorage` + di server).

### Main lewat jaringan (DM & player beda laptop/HP, tapi satu WiFi)
`localhost` hanya bisa diakses dari komputer yang sama dengan servernya. Supaya teman lain (di WiFi yang sama) bisa ikut:

1. Di komputer DM, cari **alamat IP lokal**-nya:
   - Windows: buka CMD → ketik `ipconfig` → lihat `IPv4 Address` (contoh: `192.168.1.5`)
   - Mac/Linux: buka terminal → ketik `ifconfig` atau `ip a` → cari alamat yang mirip `192.168.x.x`
2. Pastikan server sudah jalan (`npm start`).
3. Pemain lain buka browser dan ketik: `http://192.168.1.5:3000` (ganti dengan IP DM tadi).
4. Kalau tidak bisa connect, cek firewall komputer DM — izinkan koneksi masuk ke port `3000`.

Semua device harus terhubung ke **WiFi/jaringan yang sama** dengan komputer DM.

## 4. Fitur DM Board
- **Peta & Grid**: upload gambar peta (JPG/PNG), atur ukuran grid, toggle tampil/sembunyi grid.
- **Token**: tambah token warna-warni dengan label singkat, drag untuk pindah posisi, klik-kanan untuk hapus. Token bisa di-assign ke seorang player lewat dropdown "Assign ke Player" — kalau di-assign, player itu bisa geser tokennya sendiri dari halaman sheet-nya.
- **Daftar Pemain**: lihat siapa yang online, HP real-time, klik nama untuk buka ringkasan sheet lengkap.
- **NPC**: buat/edit/hapus sheet NPC dengan stat, AC, bar HP/MP/SP, equipment (senjata/gear, bisa tambah berapa pun), inventory (bisa tambah berapa pun), skill/attack, dan catatan rahasia (hanya terlihat DM).
- **Beri Item ke Player**: dari panel detail seorang player, DM bisa ketik nama item + qty dan kirim — item langsung muncul di inventory player itu secara real-time (ditandai label "dari DM").
- **Lihat Inventory & Gold Player**: panel detail seorang player sekarang menampilkan isi inventory-nya dan **gold saat ini** secara langsung. DM bisa menambah/mengurangi gold (isi minus untuk mengurangi) atau langsung **"Set Ulang"** ke angka pasti — berguna kalau player mengisi gold asal-asalan.
- **Battle & Giliran**: tambah peserta battle langsung dari daftar Player atau NPC yang sudah ada (atau custom untuk ally tambahan), tandai tipe PC/Ally/Enemy, isi roll initiative + HP/MP/SP. Urutan giliran otomatis mengikuti roll terbesar; tombol Prev/Next menggerakkan giliran & round. Update ini langsung tersiar ke semua player. **HP tiap peserta terlihat oleh player** (di tab Peta & Battle mereka), tapi **MP & SP di daftar battle ini hanya terlihat & bisa diedit oleh DM** — player tidak melihat angka MP/SP musuh maupun ally di layar mereka.
- **Log & Dice**: klik tombol dadu cepat (d4–d100) atau ketik pesan / `/roll 1d20+3` untuk melempar dadu, hasilnya tercatat di log — log ini **sama persis** dengan yang dilihat semua player. Ada tombol **"Bersihkan Log"** untuk mereset seluruhnya kalau sudah penuh/tidak relevan lagi.

## 4b. Character Sheet — Inventory
Slot item **tidak dibatasi** — tekan "+ Tambah Slot Item" untuk menambah sebanyak yang dibutuhkan, dan tombol "×" di tiap baris untuk menghapus slot yang tidak dipakai. Item yang dikirim langsung oleh DM akan muncul otomatis dengan label hijau "dari DM" dan notifikasi singkat di pojok layar.

## 4c. Character Sheet — Tab "Peta & Battle"
Selain tab Sheet, player sekarang punya tab **🗺 Peta & Battle** yang menampilkan:
- Peta pertempuran yang sama dengan yang di-upload DM (gambar + grid), termasuk semua token — kalau DM meng-assign token ke karaktermu, token itu bisa kamu geser sendiri.
- Daftar battle & giliran yang sedang berjalan (siapa PC/Ally/Enemy, HP masing-masing, dan siapa yang sedang giliran) — kalau lagi giliranmu, ada penanda "⚡ Ini giliranmu!". Semua ini update otomatis begitu DM mengubahnya, tanpa perlu refresh halaman.
- **Status battle**: AC, HP, MP, SP (HP/MP/SP bisa diedit langsung dari sini), serta daftar skill Active/Passive/Ultimate.
- **Equipment & Buff Aktif**: Equipment (2 slot) dan Extra Slot Weapon (2 slot) ditampilkan sebagai referensi cepat (ATK/DMG-nya) biar gak lupa pas mau serang musuh — dan **Buff/Debuff bisa langsung ditambah, diedit, atau dihapus di tab ini juga** (otomatis sinkron dua arah dengan daftar Buff/Debuff di tab Sheet).
- **🎲 Roll Dadu**: tombol cepat d4–d100 atau formula custom (mis. `2d6+3`), hasilnya masuk ke log yang **sama dengan log milik DM** — jadi DM dan semua player lain langsung lihat siapa roll apa. Ada tombol "Bersihkan Log" di sini juga (siapa pun bisa mereset log bersama ini).
- **Pet/Summon**: kalau kolom pet di tab Sheet diisi, ringkasannya (HP/MP/Level/Skill) otomatis muncul di sini juga.

## 4d. DM: Beri Gold ke Player
Di panel detail seorang player (klik nama player di daftar Pemain), sekarang ada kotak **🪙 Beri Gold ke Player Ini**. DM tinggal isi jumlah dan klik Kirim — gold player itu langsung bertambah (isi angka minus untuk mengurangi, mis. saat belanja/kena pencurian). Perubahan langsung muncul di sheet player secara real-time beserta notifikasi singkat.

## 4e. Sistem Kelas (Class) & Rank Up
- **DM membuat katalog Kelas** di panel **🎓 Kelas & Skill** (sidebar kiri, sebelah panel NPC): nama kelas, tier/rank (opsional), deskripsi, dan daftar skill (Active/Passive/Ultimate) yang beda-beda untuk tiap kelas.
- **DM membuka ("rank up") kelas tertentu untuk seorang player** lewat panel detail player → kotak **🔓 Buka Kelas (Rank Up)**: centang kelas mana saja yang boleh dipilih player itu, lalu simpan.
- **Player memilih sendiri kelasnya** dari kelas-kelas yang sudah dibuka DM, lewat panel **🎓 Kelas & Rank Up** di sheet-nya. Player juga bisa **ganti kelas** kapan saja selama masih dalam daftar kelas yang terbuka untuknya.
- Begitu kelas dipilih/diganti, **Active/Passive/Ultimate Skill di sheet player otomatis terisi** sesuai skill kelas tersebut (menggantikan skill sebelumnya) — jadi tiap kelas benar-benar punya skill yang berbeda.

## 4f. DM: Hapus Player
Di panel detail player ada tombol **🗑 Hapus Player Ini** (juga tersedia sebagai ikon "×" kecil langsung di daftar Pemain). Sebelum benar-benar terhapus, selalu muncul konfirmasi **"Anda yakin?!"** dulu. Kalau dikonfirmasi: player beserta sheet-nya dihapus permanen dari sesi, token & entri battle miliknya ikut dibersihkan, dan kalau playernya sedang online, dia otomatis dikeluarkan dan diarahkan balik ke halaman awal.

## 4g. DM: Beri & Kelola Pet Player
Pet sekarang **harus diberikan dulu oleh DM** lewat kotak **🐾 Beri / Atur Pet Player Ini** di panel detail player (nama, tipe, level, HP, MP, skill, catatan). Setelah disimpan, pet langsung muncul di sheet player. Nama/Tipe/Level/Skill/Catatan pet hanya bisa diubah DM (read-only di sisi player, sama seperti kelas) — tapi **HP & MP pet tetap bisa diupdate sendiri oleh player**, termasuk lewat quick-edit di tab **Peta & Battle**, karena itu biasanya berubah-ubah pas lagi bertarung.

## 4h. Biar Gak Delay/Lag Pas Main Bareng
Gambar map sekarang **otomatis dikompres & di-resize di browser DM** sebelum dikirim ke server/pemain (maks. sisi terpanjang 1600px, kualitas ~82%) — foto map dari HP yang tadinya 5-10MB biasanya jadi di bawah 500KB tanpa kelihatan bedanya di layar. Ini penyebab lag paling umum karena gambar besar dikirim ke semua pemain lewat koneksi yang sama.
Beberapa hal lain di luar kode yang juga berpengaruh ke delay:
- **Jaringan**: jalankan server di komputer DM (atau laptop yang kabel LAN/WiFi-nya paling stabil), dan pastikan semua pemain satu WiFi dengan komputer itu. Lihat bagian "Main lewat jaringan" di atas.
- **Koneksi internet**: pastikan DM & pemain pakai koneksi yang stabil (hindari hotspot HP yang sinyalnya naik-turun).
- **Ukuran gambar token/aset lain**: kalau nambah gambar lain di masa depan, usahakan sudah dikompres juga sebelum upload.
- Kalau masih lag, coba cek jumlah tab/aplikasi berat lain yang dibuka bersamaan di HP/laptop masing-masing pemain — makin sedikit beban di device, makin responsif juga socket-nya.

## 4i. Musik Sesi (BGM)
Ada panel **🎵 Musik** di sidebar kiri DM Board:
- **Tambah lagu**: upload file audio (MP3/OGG/WAV, dll) dari komputer, atau tempel link audio langsung (URL yang berakhiran file audio, atau server streaming audio langsung). Lagu yang sudah ditambah muncul sebagai daftar, tinggal klik **"Putar"** untuk memainkannya.
- **Kontrol**: Pause/Resume, Stop, checkbox **Ulangi** (loop), dan slider volume — semua ini adalah kontrol "master" yang berlaku buat semua orang di sesi.
- **Otomatis tersiar ke semua player** secara real-time & tersinkron (kalau player baru join/refresh di tengah lagu, posisi lagu ikut menyesuaikan).
- **Di sisi player**: muncul bar musik kecil di bagian bawah layar (nama lagu yang sedang main + tombol mute/volume). Tombol **"🔊 Aktifkan Musik"** wajib diklik sekali oleh tiap player — ini karena browser (Chrome, Safari, dll) memblokir audio otomatis sebelum ada klik dari user, bukan bug. Volume/mute di bar player ini **hanya berlaku lokal** di device masing-masing, tidak memengaruhi player lain.
- **Catatan ukuran file**: berbeda dari gambar map, file audio belum dikompres otomatis oleh aplikasi ini. Kalau upload file besar (misal >10-15MB) bisa terasa lag saat pertama kali dikirim ke semua pemain — kalau memungkinkan, pakai file MP3 yang sudah dikompres/durasi pendek, atau pakai opsi "tempel URL" untuk lagu yang sudah di-hosting di tempat lain.

## 4j. Export / Import Character Sheet (Player)
Di topbar halaman sheet ada tombol **⬇ Export** dan **⬆ Import**:
- **Export** mengunduh seluruh data sheet (identitas, ability, HP/MP/SP, equipment, inventory, skill, buff, dll) sebagai file `.json`.
- **Import** membaca file `.json` itu kembali, mengisi ulang seluruh sheet, lalu **otomatis tersimpan ke server** — sehingga data lama itu langsung muncul/update di **daftar Pemain milik DM** juga, sama seperti autosave biasa.

## 4k. Export / Import NPC (DM)
Di panel **👹 NPC**, tombol **⬇ Export NPC** mengunduh semua NPC (beserta stats, HP/MP/SP, equipment, inventory, catatan) sebagai satu file `.json`. Tombol **⬆ Import NPC** membaca file itu (atau file export dari sesi lain) dan menambahkan semua NPC di dalamnya sebagai NPC baru ke sesi yang sedang berjalan.

## 4l. Shop Item + Import/Export Excel (DM)
Panel **🛒 Shop Item** di sidebar kiri DM Board:
- Kelola katalog item toko manual (nama, harga, tipe, stok, deskripsi) lewat form kecil — klik item di daftar untuk edit, tombol "×" untuk hapus satu-satu, atau "Kosongkan Semua" untuk reset total.
- **Import langsung dari file Excel/CSV** (`.xlsx`/`.xls`/`.csv`) — cukup pilih file dengan kolom `nama, harga, tipe, stok, deskripsi` (nama kolom besar/kecil tidak masalah), semua barisnya otomatis masuk sebagai item toko.
- **Export ke Excel** untuk mengunduh seluruh katalog toko saat ini sebagai file `.xlsx`, gampang untuk diedit di Excel/Google Sheets lalu diimpor ulang.

## 4m. Skill dengan Cost MP/SP (auto-kurang saat dipakai)
Tiap skill (Active/Passive/Ultimate) di sheet sekarang punya kolom tambahan: **Cost MP**, **Cost SP**, dan **Formula Dadu** (opsional, mis. `1d8+3`). Skill yang dibuat DM di katalog Kelas juga bisa diisi cost yang sama, dan otomatis ikut ter-copy ke player saat memilih/ganti kelas.

Di tab **Peta & Battle**, tiap skill yang sudah diisi punya tombol **⚡ Pakai**:
- Begitu diklik, **MP dan/atau SP karaktermu otomatis berkurang** sesuai cost skill itu (kalau MP/SP tidak cukup, tombol akan menolak & memberi peringatan).
- Penggunaan skill tercatat di log chat bersama.
- Kalau skill itu punya Formula Dadu, formula-nya otomatis diisi ke panel **🎯 Aksi Roll** di bawahnya — tinggal pilih target & klik Roll.

## 4n. Aksi Roll: Damage / Heal / Buff / Debuff / Ultimate / Regen / AC
Baik player (tab Peta & Battle) maupun DM (sidebar kanan DM Board) punya panel **🎯 Aksi Roll**:
1. Pilih **target** dari daftar peserta battle yang sedang berjalan.
2. Pilih **jenis aksi**: Damage, Heal, Buff, Debuff, Ultimate, Regen Mana, Regen SP, Buff AC, atau Debuff AC.
3. Isi **formula dadu** (mis. `1d8+3`, `2d6`, atau angka flat) lalu klik **🎲 Roll & Terapkan**.

Hasilnya langsung diterapkan ke data battle target secara real-time untuk semua orang:
- **Damage/Ultimate** → HP target langsung berkurang sebesar hasil roll.
- **Heal** → HP target bertambah (juga cocok dipakai untuk pemakaian item yang menambah HP — tinggal target diri sendiri).
- **Regen Mana/Regen SP** → MP/SP target bertambah.
- **Buff AC/Debuff AC** → AC target ikut naik/turun.
- **Buff/Debuff** → tercatat di log sebagai penanda efek (tidak mengubah angka HP/MP/SP/AC, dipakai bareng catatan Buff/Debuff manual yang sudah ada di sheet).

Semua hasil roll otomatis masuk ke log chat bersama, kelihatan oleh semua orang di sesi.

**Penting — DM hanya memantau PC:** kolom HP/MP/SP/AC milik PC di daftar battle DM otomatis jadi **read-only**. Stat karakter player hanya bisa diubah oleh player itu sendiri lewat sheet-nya — DM cuma bisa lihat perkembangannya secara real-time.

**DM tidak "roll sendiri" — harus lewat Aktor:** di panel Aksi Roll DM, sebelum bisa Roll & Terapkan, DM wajib pilih dulu **Aktor** — yaitu peserta battle bertipe NPC/Ally/Enemy yang lagi melakukan aksi itu (bukan DM yang asal roll tanpa sumber). Kalau Aktor itu terhubung ke NPC yang skill-nya sudah diisi (lihat poin di bawah), tinggal pilih skill dari dropdown **Skill** — formula dadu, jenis aksi, dan cost MP/SP-nya otomatis terisi & otomatis dikurangi dari Aktor pas di-roll (persis seperti player pakai skill dari sheet-nya). Kalau tidak pilih skill, formula bisa diisi manual seperti biasa.

## 4n2. NPC: Skill Terstruktur (Active/Passive/Ultimate)
Panel **👹 NPC** sekarang punya bagian skill terstruktur yang formatnya sama seperti skill Kelas: tiap skill punya nama, jenis aksi (Damage/Heal/Buff/dst), Cost MP, Cost SP, dan Formula Dadu — bisa tambah sebanyak yang dibutuhkan per kategori (Active/Passive/Ultimate). Skill ini yang muncul di dropdown **Skill** pada panel Aksi Roll DM begitu NPC itu dijadikan Aktor di battle. Kolom "Catatan Skill / Attack" lama tetap ada untuk catatan bebas di luar skill terstruktur.

## 4n3. NPC sebagai Daftar Enemy Siap Pakai
NPC yang sudah dibuat berfungsi sebagai daftar enemy/ally yang bisa dipakai berkali-kali. Tiap kartu NPC di panel **👹 NPC** sekarang punya tombol **⚔** — klik untuk langsung menambahkan NPC itu ke Battle & Giliran (sebagai Enemy) tanpa perlu mengisi ulang form "Tambah ke Battle" satu-satu. Roll initiative-nya dikosongkan dulu dan tinggal diisi langsung di baris battle-nya. Kombinasikan dengan Export/Import NPC (poin 4k) untuk punya "bestiary" musuh yang bisa dipakai ulang lintas sesi.

## 4o. Story-telling: Scene Banner, Dialog NPC, Quest Tracker, Handout, Recap
Tab baru **📖 Cerita** (DM Board) berisi 5 fitur yang saling melengkapi untuk membangun narasi sesi:

- **🎬 Scene Banner**: DM isi judul + deskripsi + (opsional) gambar suasana, lalu klik "📢 Tampilkan ke Semua" — muncul sebagai banner besar di atas layar semua player (mirip transisi adegan di game), sampai DM klik "✖ Sembunyikan Banner" atau player menutupnya sendiri secara lokal. Setiap kali ditampilkan otomatis tercatat di log sebagai entri bertipe "narrative".
- **💬 Dialog NPC**: DM pilih NPC dari daftar (opsional, auto-isi nama) atau ketik nama bebas, upload potret (opsional), ketik dialog, lalu klik "🗣 Katakan" — muncul sebagai kotak dialog ala visual novel di bagian bawah layar semua player. Tiap dialog juga tercatat di log.
- **📜 Quest / Objective Tracker**: DM bikin/edit quest (judul, deskripsi, status Aktif/Selesai/Gagal). Player lihat versi read-only di tab **📖 Cerita** miliknya. Perubahan status otomatis diumumkan di log ("✅ Quest selesai: ...", dst).
- **🎁 Handout (kirim dokumen)**: DM kirim gambar/surat/catatan ke satu player tertentu atau semua sekaligus — muncul sebagai popup di layar penerima, plus notifikasi kecil di pojok layar.
- **⭐ Recap / Riwayat Cerita**: panel yang otomatis merangkum semua momen cerita (scene, dialog, quest, handout) secara kronologis — cocok dipakai DM untuk baca ulang "sebelumnya di sesi ini..." sebelum mulai sesi berikutnya. DM juga bisa menandai entri log biasa di tab Utama dengan tombol ⭐ supaya ikut masuk ke Recap ini.

Player bisa lihat Quest & Recap lewat tab **📖 Cerita** di sheet-nya (read-only) — Scene Banner dan Dialog NPC muncul otomatis sebagai overlay dari tab manapun yang sedang dibuka.


## 4p. Layar TV (tampilan bersama, baca-saja)
Untuk main tatap muka dengan peta di TV/proyektor dan sheet di HP masing-masing:
1. Di DM Board, klik tombol **📺 Layar TV** di pojok atas (atau buka `http://IP-DM:3000/tv.html?code=KODE` dari laptop yang tersambung ke TV).
2. Layar TV menampilkan **peta + grid + token + fog of war** (enemy di area gelap tetap tersembunyi, sama seperti layar player), **urutan giliran** battle lengkap dengan bar HP, serta **Scene Banner** dan **Dialog NPC** dari DM.
3. Tidak ada tombol atau input — murni layar tampilan. Tekan **F** untuk layar penuh, **S** untuk menyembunyikan/menampilkan daftar giliran.
4. Kalau koneksi terputus, layar otomatis menyambung ulang sendiri.

## 4q. Peta Lanjutan: Dinding, Pintu, Lampu & Lighting Dinamis
Semua ada di tab **🗺 Peta & Grid** (DM Board). Koordinat disimpan dalam persen, jadi pas di HP, laptop, maupun TV.
- **Alat gambar**: pilih **Tembok** (klik titik demi titik, klik-kanan untuk selesai), **Pintu** (satu klik dua titik), **Lampu** (klik di peta, atur *Sinar lampu*), **Hapus**, atau **Normal**. Centang **Snap** agar ujung dinding menempel rapi.
- **Pintu**: klik = buka/tutup · **Shift+klik** = kunci · **Alt+klik** = pintu satu arah. Pintu terkunci/tertutup menghalangi pandangan, cahaya, dan token player.
- **💡 Lighting Dinamis**: ganti fog manual dengan penglihatan token party + dinding + lampu. Slider **Gelap** mengatur kegelapan (0 = terang, 100 = gelap total), **Jarak pandang** mengatur sejauh apa party melihat tanpa lampu. Area yang pernah dijelajahi diingat (redup) di tiap perangkat; **Reset Jelajah** menghapus ingatan itu.
- **Dinding menahan token player** (DM tetap boleh menembus untuk mengatur adegan). Token musuh/NPC di area yang belum terlihat disembunyikan dari player dan TV.
- **Multi-lantai**: buat beberapa map (tab di atas peta), lalu **Pindahkan Party** membawa seluruh party ke map lain sekaligus.
- **Spotlight**: arahkan kamera ke satu titik dengan zoom 1.2–5×; layar player dan TV mengikuti.
- **Import map** (tombol di toolbar):
  - **📥 Import .uvtt** — file `.uvtt` / `.dd2vtt` / `.df2vtt`: gambar, ukuran grid, dinding, pintu, dan lampu ikut masuk.
  - **📥 Foundry JSON** — export Scene dari Foundry VTT: dinding, pintu (termasuk terkunci/satu arah), dan lampu. Gambar map tidak ada di file export Foundry, jadi upload terpisah.
  - **🎞 Background Video** — MP4/WebM (maks. 12 MB; loop pendek lebih ringan untuk semua pemain). Video tampil di DM, player, dan TV.
  - Atau upload gambar biasa lalu gambar sendiri dindingnya.

## 4r. Codex DM (tab 📚 Codex)
Alat kampanye untuk DM, semuanya real-time dan tersimpan di sesi:
- **📖 Library**: **336 monster, 320 spell, dan 611 item** dari **SRD 5.1** (bisa dicari & difilter berdasarkan CR, level/kelas spell, jenis/rarity item; Custom/homebrew buatanmu ikut muncul). Monster bisa langsung dijadikan NPC, dimasukkan ke Battle, atau ke encounter; item bisa masuk Shop atau diberikan ke pemain; spell bisa dikirim ke pemain.
  - Sekitar 50 monster, 86 spell, dan 48 item awal sudah disunting dan sebagian diringkas dalam bahasa Indonesia. Sisanya diimpor apa adanya dari SRD 5.1 dalam **bahasa Inggris**.
  - Harga magic item hanya perkiraan berdasarkan rarity (Common 100 gp … Legendary 100.000 gp); sesuaikan sendiri kalau perlu.
  - Aksi monster non-serangan (Multiattack, Legendary Actions, Reaction) masuk ke catatan NPC sebagai teks, bukan tombol roll.
- **📥 Paste & Go**: tempel stat block monster atau teks spell dari buku/catatan, klik **Baca**, lalu simpan ke library atau langsung jadikan NPC. Tersedia tombol contoh.
- **😈 Villain Tracker**: pangkat ancaman **Minion → Lieutenant → Elite → Boss → Overlord**, status (aktif/bersembunyi/kalah), rencana berikutnya, catatan rahasia, HP/AC. Tombol **⚔ Battle** dan **👹 NPC** untuk memakainya.
- **🏴 Faksi**: sikap (sekutu/netral/musuh), reputasi, anggota, tujuan, rahasia.
- **🗺 Lore & Lokasi**: catatan dunia, sejarah, tempat penting.
- **📅 Kalender**: tanggal dunia yang bisa dimajukan (-1/+1/+7/+30 hari), nama bulan sendiri, dan event per tanggal. Tanggal juga tampil di layar TV.
- **⚔ Encounter Builder**: susun makhluk dari library/NPC, isi level party, lalu lihat penilaian kesulitan (Easy/Medium/Hard/Deadly, aturan DMG 5e). Encounter bisa disimpan dan **Mulai Battle** langsung memasukkan semua peserta ke Battle & Giliran.
- **Ctrl+K**: pencarian cepat di mana saja di DM Board.
- Teks SRD 5.1 © Wizards of the Coast, lisensi CC-BY-4.0 (lihat catatan lisensi di bagian bawah tab Codex).

## 4s. Tampilan Baru "Lantern table" & Animasi
- Tema **Night** (default, cocok untuk main di ruangan redup) dan **Day**; ganti lewat tombol ☀ di pojok. Pilihan tersimpan per perangkat.
- Font dipasang lokal di `public/fonts` (Grenze + Atkinson Hyperlegible), jadi tampilan sama walau offline.
- Gerak: layar landing "menyala" saat dibuka, tab bergaris lentera, panel/modal/toast masuk halus, token meluncur saat dipindah dan muncul saat baru, baris giliran berdenyut saat ganti giliran, entri chat baru berkedip sebentar, bar HP/MP/SP bergeser mulus.
- Semua gerak otomatis mati bila sistem diatur "kurangi gerakan".
- Semua gaya ada di `public/theme.css` (warna di bagian atas), gerak token/log di `public/fx.js`.

## 4t. Ras Homebrew (Codex > 🧬 Ras)
DM membuat ras sendiri (maks 4 trait dengan bonus stat). Ras muncul di pemilih ras semua pemain bertanda "homebrew" dan trait-nya ikut dihitung.

## 4u. Aksi Monster Otomatis (Multiattack, Legendary, Reaction, Recharge)
Monster dari Codex → **Ke Battle** (atau Mulai Battle dari Encounter) kini masuk sebagai NPC lengkap, jadi semua aksinya ada di dropdown skill pada panel **Aksi Roll DM**:
- **Multiattack**: dipecah jadi serangan terpisah (mis. naga: Bite ×1 + Claw ×2). Tiap serangan roll d20 vs AC sendiri memakai bonus serang monster (kena / meleset / critical sendiri-sendiri). Dibaca otomatis dari teks SRD untuk 146 dari 147 monster ber-Multiattack; 1 pengecualian (Werewolf, Human Form) memakai serangan biasa.
- **Serangan biasa** kini memakai bonus serang monster (dulu +0). Dadu tambahan seperti "+2d6 fire" ikut dihitung.
- **Legendary Action**: SP monster = jatah Legendary Action (3). Tiap aksi memotong SP sesuai biaya (Costs 2 Actions → -2 SP) dan **pulih otomatis di awal giliran monster itu**. Aksi berupa serangan di-roll; yang berbasis save (mis. Wing Attack) tidak memakai to-hit.
- **Legendary Resistance**: MP monster = sisa pemakaian (3/hari). Dipakai sekali klik, tercatat di log.
- **Reaction** (Parry, Shield, dst.): dicatat di log; untuk Parry, log menyebut AC sementara.
- **Recharge** (Fire Breath, dst.): setelah dipakai, tanda ⏳ muncul dan skill terkunci; di awal giliran monster, d6 di-roll otomatis dan hasilnya masuk log. Napas naga memakai Recharge 5–6.
- Serangan berbasis save (napas, dll.) tidak memakai to-hit; setengah damage saat save berhasil tetap kamu atur sendiri (teks DC tampil di status).
- Rumus dadu manual kini boleh berisi beberapa suku, mis. `2d10+8+2d6+1d4`.
Yang masih manual: efek tambahan monster (frightened, restrained, dst.), spellcasting monster, dan lair action.

## 5. Struktur folder
```
dnd-vtt/
├── server.js          # server Express + Socket.io (semua logika real-time)
├── package.json
├── data/
│   └── sessions.json  # penyimpanan sesi (dibuat otomatis)
└── public/
    ├── index.html      # halaman awal: pilih DM / Player, join sesi
    ├── character.html  # form character sheet (player)
    ├── character.js
    ├── dm.html         # DM board (peta, NPC, initiative, log)
    ├── dm.js
    ├── tv.html         # layar TV bersama (baca-saja)
    ├── lighting.js     # visibilitas, fog, & lighting berbasis dinding (DM/player/TV)
    ├── mapmedia.js     # background map gambar atau video
    ├── codex.js        # logika Codex: Paste & Go, hitung encounter
    ├── codex-ui.js     # tab Codex di DM Board
    ├── srd-data.js     # data SRD 5.1 (monster, spell, item)
    ├── battle-fx.js
    ├── style.css       # gaya dasar
    ├── theme.css       # tema Lantern table + animasi
    ├── fx.js           # animasi token/log/giliran
    └── fonts/          # font lokal
```

## 6. Catatan & batasan (biar tidak kaget)
- Ini alat bantu ringan, bukan pengganti VTT besar (Foundry/Roll20) — token & grid sengaja sederhana.
- Dice roll di log dihitung otomatis (RNG murni, bukan sistem anti-cheat) — cocok untuk main santai dengan sistem kepercayaan seperti biasa.
- Gambar peta disimpan langsung sebagai data di `sessions.json`, jadi hindari upload gambar yang sangat besar (idealnya di bawah beberapa MB) supaya tetap ringan.
- Semua data tersimpan **lokal di komputer DM** — tidak ada server online / cloud, tidak ada akun, dan tidak ada database eksternal. Kalau komputer DM mati, sesi berhenti (tapi datanya tetap ada di file `data/sessions.json` untuk dilanjutkan).
- File data ditulis secara aman (tulis ke file sementara lalu diganti), dan **backup otomatis** disimpan di `data/sessions.backup.json`. Kalau file utama rusak, server otomatis memakai backup. Untuk memindahkan sesi ke komputer lain, cukup salin folder `data/`.
- Mau data disimpan di folder lain? Jalankan dengan variabel `DATA_DIR`, misalnya `DATA_DIR=D:/dnd-data npm start`. Mau ganti port? Pakai `PORT=4000 npm start`.
