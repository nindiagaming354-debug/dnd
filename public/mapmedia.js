// mapmedia.js — background map berupa gambar ATAU video (mp4/webm), dipakai DM, player, dan layar TV.
//
// Trik: <img> tetap jadi penentu ukuran/layout map (supaya semua hitungan koordinat, fog, lighting, dan
// token yang sudah ada tidak berubah). Kalau map-nya video, <img> diisi placeholder transparan dengan rasio
// yang sama, dan <video> diletakkan tepat di belakang lapisan overlay (grid/fog/token) lewat CSS .map-video.
(function (global) {
  'use strict';

  const MAX_VIDEO_BYTES = 12 * 1024 * 1024; // video disimpan & dikirim ke semua pemain — jaga tetap ringan

  function placeholder(w, h) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"></svg>');
  }
  function isVideo(u) {
    return typeof u === 'string' && (/^data:video\//i.test(u) || /\.(mp4|webm)(\?|#|$)/i.test(u));
  }
  function videoFor(img, create) {
    let v = img.nextElementSibling;
    if (v && v.classList && v.classList.contains('map-video')) return v;
    if (!create) return null;
    v = document.createElement('video');
    v.className = 'map-video';
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('loop', ''); v.setAttribute('autoplay', '');
    img.parentNode.insertBefore(v, img.nextSibling);
    v.addEventListener('loadedmetadata', function () {
      // Rasio asli video -> placeholder <img> ikut berubah, lalu beri tahu pemilik map (fog/lighting) untuk render ulang
      const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
      img.src = placeholder(1600, Math.max(1, Math.round(1600 * vh / vw)));
      img.dispatchEvent(new Event('load'));
    });
    return v;
  }

  // Terapkan background ke <img> peta. Mengembalikan true kalau yang dipakai video.
  function apply(img, url) {
    if (!img) return false;
    if (isVideo(url)) {
      const v = videoFor(img, true);
      if (v.dataset.src !== url) {
        v.dataset.src = url;
        v.src = url;
        const p = v.play && v.play(); if (p && p.catch) p.catch(function () {});
        img.src = placeholder(1600, 900);
      }
      img.style.display = 'block';
      return true;
    }
    const old = videoFor(img, false);
    if (old) { try { old.pause(); } catch (e) {} old.removeAttribute('src'); old.remove(); }
    if (url) {
      if (img.getAttribute('src') !== url) img.src = url;
      img.style.display = 'block';
    } else {
      img.removeAttribute('src'); img.style.display = 'none';
    }
    return false;
  }

  // Baca file video jadi data URL (dengan batas ukuran).
  function readVideoFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Tidak ada file.'));
      if (!/^video\/(mp4|webm)$/i.test(file.type) && !/\.(mp4|webm)$/i.test(file.name || '')) return reject(new Error('Format harus MP4 atau WebM.'));
      if (file.size > MAX_VIDEO_BYTES) return reject(new Error('Video terlalu besar (' + (file.size / 1048576).toFixed(1) + ' MB). Maksimal ' + (MAX_VIDEO_BYTES / 1048576) + ' MB — pakai loop pendek dan kompres dulu.'));
      const r = new FileReader();
      r.onerror = function () { reject(new Error('Gagal membaca file.')); };
      r.onload = function () {
        let u = String(r.result);
        if (!/^data:video\//i.test(u)) u = u.replace(/^data:[^;,]*/, file.name && /\.webm$/i.test(file.name) ? 'data:video/webm' : 'data:video/mp4');
        resolve(u);
      };
      r.readAsDataURL(file);
    });
  }

  global.MapMedia = { apply: apply, isVideo: isVideo, readVideoFile: readVideoFile, MAX_VIDEO_BYTES: MAX_VIDEO_BYTES };
})(window);
