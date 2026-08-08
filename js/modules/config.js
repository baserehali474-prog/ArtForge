/* =========================================================================
   ArtForge — Production API config
   The frontend and API are served by the same Render service.
   ========================================================================= */
(function (global) {
  'use strict';
  global.ARTFORGE_API_BASE =
    (global.location && global.location.origin
      ? global.location.origin
      : '') + '/api';
})(window);
