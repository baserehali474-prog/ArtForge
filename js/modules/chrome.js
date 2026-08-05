/* =========================================================================
   ArtForge v2.0 — Shared page chrome (loader + custom cursor + mouse glow)
   Mirrors the behavior already used in index.html / signup.html so new
   pages feel identical. Purely additive: existing pages keep their own
   inline copies untouched; this module is only used by new v2.0 pages.
   ========================================================================= */
(function () {
  'use strict';

  function initLoader() {
    window.addEventListener('load', function () {
      setTimeout(function () {
        var loader = document.getElementById('loader');
        if (loader) loader.classList.add('hide');
      }, 400);
    });
  }

  function initCursor() {
    var dot = document.getElementById('cursor-dot');
    var ring = document.getElementById('cursor-ring');
    if (!dot || !ring) return;
    var rx = 0, ry = 0, mx = 0, my = 0;
    window.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0) translate(-50%,-50%)';
      document.documentElement.style.setProperty('--mx', mx + 'px');
      document.documentElement.style.setProperty('--my', my + 'px');
    });
    (function ringLoop() {
      rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
      ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0) translate(-50%,-50%)';
      requestAnimationFrame(ringLoop);
    })();
    document.querySelectorAll('a,button,.tab,.af-nav-link,.af-chip').forEach(function (el) {
      el.addEventListener('mouseenter', function () { ring.classList.add('hover'); });
      el.addEventListener('mouseleave', function () { ring.classList.remove('hover'); });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initLoader();
    initCursor();
  });
})();
