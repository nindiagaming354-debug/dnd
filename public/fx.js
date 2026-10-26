/* fx.js — gerak kecil yang menjawab aksi: token meluncur/muncul, giliran baru, log baru, cahaya mengikuti kursor.
 * Aman: tanpa efek bila prefers-reduced-motion; semua pengamat hanya menambah class, tidak mengubah data. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  function $(s, r) { return (r || document).querySelector(s); }

  /* Token: glide saat posisi berubah, spawn saat token baru muncul (lewati batch awal) */
  function watchTokens(root) {
    if (!root) return;
    var ready = false;
    setTimeout(function () { ready = true; }, 1200);
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'childList' && ready) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType === 1 && n.classList && n.classList.contains('token')) {
              n.classList.add('spawn');
              setTimeout(function () { n.classList.remove('spawn'); }, 600);
            }
          });
        }
      });
    });
    mo.observe(root, { childList: true });
    /* glide: tambahkan class ke token yang ada; transisi left/top hanya aktif saat bukan sedang di-drag */
    root.addEventListener('pointerdown', function () { root.classList.add('dragging'); }, true);
    window.addEventListener('pointerup', function () { root.classList.remove('dragging'); }, true);
    var addGlide = function () {
      root.querySelectorAll('.token:not(.glide)').forEach(function (t) { t.classList.add('glide'); });
    };
    new MutationObserver(addGlide).observe(root, { childList: true });
    addGlide();
  }
  ['mapInner', 'pMapInner', 'tvMapOverlay'].forEach(function (id) { watchTokens(document.getElementById(id)); });

  /* Log chat: tandai entri baru */
  function watchLog(el) {
    if (!el) return;
    var count = el.children.length;
    new MutationObserver(function () {
      var n = el.children.length;
      if (n > count) {
        for (var i = count; i < n; i++) {
          var c = el.children[i];
          if (c && c.classList) { c.classList.add('fresh'); (function (x) { setTimeout(function () { x.classList.remove('fresh'); }, 1800); })(c); }
        }
      }
      count = n;
    }).observe(el, { childList: true });
  }
  document.querySelectorAll('.chat-log').forEach(watchLog);

  /* Giliran baru: denyut pada baris battle yang baru aktif */
  function watchTurn(root) {
    if (!root) return;
    var last = null;
    new MutationObserver(function () {
      var a = root.querySelector('.battle-row.active');
      var id = a ? (a.dataset.id || a.textContent.slice(0, 20)) : null;
      if (a && id !== last && last !== null) {
        a.classList.add('turn-arrive');
        setTimeout(function () { a.classList.remove('turn-arrive'); }, 900);
      }
      last = id;
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  watchTurn(document.getElementById('battleList') || document.getElementById('tab-dm-battle'));
  watchTurn(document.getElementById('tvBattle'));

  /* Cahaya mengikuti kursor pada panel & ubin peran (hanya pointer halus) */
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointermove', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.role-tile') : null;
      if (!t) return;
      var r = t.getBoundingClientRect();
      t.style.backgroundImage = 'radial-gradient(220px circle at ' + (e.clientX - r.left) + 'px ' + (e.clientY - r.top) + 'px, var(--lantern-soft), transparent 70%)';
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.role-tile') : null;
      if (t) t.style.backgroundImage = '';
    });
  }
})();
