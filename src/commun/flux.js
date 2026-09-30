// Flux temps reel d'un overlay, en WebSocket, avec l'interface d'EventSource.
//
// Pourquoi pas EventSource : toutes les sources Navigateur d'OBS partagent un
// meme moteur Chromium, qui ne garde que 6 connexions HTTP ouvertes par hote.
// Chaque flux SSE en occupait une pour toujours : au 7e overlay StreamKit
// charge dans OBS (toutes scenes confondues), la page restait vide. Les
// WebSocket ne comptent pas dans ces 6. Detail dans src/core/diffusion.js.
//
// Meme usage qu'EventSource, pour que les overlays n'aient a changer que leur
// constructeur :
//
//   const flux = new FluxStreamKit(BASE + "/flux");
//   flux.addEventListener("etat", (e) => appliquer(JSON.parse(e.data)));
//   flux.addEventListener("error", () => { if (flux.readyState === FluxStreamKit.CLOSED) ... });
//
// Comme EventSource, il se reconnecte tout seul (redemarrage ou mise a jour de
// StreamKit) : « error » a chaque coupure, readyState repasse a CONNECTING, et
// ne vaut CLOSED qu'apres close().
//
// Charge par <script src="/commun/flux.js"></script>, AVANT le script de l'overlay.

(function () {
  'use strict';

  const RECONNEXION = 2000; // le « retry: 2000 » de l'ancien flux SSE

  class FluxStreamKit {
    constructor(chemin) {
      const u = new URL(chemin, location.href);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = u.href;
      this.readyState = FluxStreamKit.CONNECTING;
      this._ecouteurs = new Map();
      this._ws = null;
      this._minuteur = null;
      this._connecter();
    }

    addEventListener(type, fn) {
      if (!this._ecouteurs.has(type)) this._ecouteurs.set(type, new Set());
      this._ecouteurs.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this._ecouteurs.get(type)?.delete(fn);
    }

    close() {
      this.readyState = FluxStreamKit.CLOSED;
      clearTimeout(this._minuteur);
      if (this._ws) {
        this._ws.onclose = null;
        this._ws.close();
      }
    }

    _emettre(type, evenement) {
      const e = Object.assign({ type }, evenement);
      const direct = this['on' + type];
      if (typeof direct === 'function') direct.call(this, e);
      for (const fn of this._ecouteurs.get(type) ?? []) {
        try {
          fn.call(this, e);
        } catch (err) {
          // Un ecouteur qui plante ne doit pas priver les autres du message.
          setTimeout(() => {
            throw err;
          });
        }
      }
    }

    _connecter() {
      if (this.readyState === FluxStreamKit.CLOSED) return;
      this.readyState = FluxStreamKit.CONNECTING;
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch {
        this._plusTard();
        return;
      }
      this._ws = ws;
      ws.onopen = () => {
        this.readyState = FluxStreamKit.OPEN;
        this._emettre('open', {});
      };
      // « type », saut de ligne, puis les donnees en JSON : data garde la forme
      // d'un evenement EventSource, que les overlays passent a JSON.parse.
      ws.onmessage = (m) => {
        const texte = String(m.data);
        const i = texte.indexOf('\n');
        if (i < 0) return;
        this._emettre(texte.slice(0, i), { data: texte.slice(i + 1) });
      };
      ws.onclose = () => {
        this._ws = null;
        if (this.readyState === FluxStreamKit.CLOSED) return;
        this.readyState = FluxStreamKit.CONNECTING;
        this._emettre('error', {});
        this._plusTard();
      };
    }

    _plusTard() {
      clearTimeout(this._minuteur);
      this._minuteur = setTimeout(() => this._connecter(), RECONNEXION);
    }
  }

  FluxStreamKit.CONNECTING = 0;
  FluxStreamKit.OPEN = 1;
  FluxStreamKit.CLOSED = 2;

  window.FluxStreamKit = FluxStreamKit;
})();
