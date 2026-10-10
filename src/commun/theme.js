// Theme d'overlay : suit en direct le theme choisi dans « Personnalisation ».
//
// Pose par le serveur sur chaque overlay (voir poserTheme dans
// src/core/serveur.js), avec la feuille du theme en cours :
//   <html data-sk-theme="neon">  ...  <link id="sk-theme" href="/commun/themes/neon.css">
//
// Quand le streamer change de theme, StreamKit le pousse sur le canal
// « themes » : on remplace la feuille et l'attribut, sans recharger la page --
// l'overlay garde son etat (morceau en cours, session, tirage...). Un overlay
// qui dessine lui-meme ses couleurs (canvas) peut ecouter l'evenement
// « sk-theme » sur window.
//
// WebSocket pour la meme raison que flux.js : un flux SSE par overlay
// epuiserait les 6 connexions que le Chromium d'OBS garde par hote.
// data-sk-fige : l'apercu d'un theme dans le dashboard, qui ne bouge pas.

(function () {
  'use strict';

  const racine = document.documentElement;
  if (racine.hasAttribute('data-sk-fige')) return;

  const RECONNEXION = 2000;

  function appliquer(theme) {
    if (!/^[\w-]+$/.test(theme) || racine.getAttribute('data-sk-theme') === theme) return;
    const lien = document.getElementById('sk-theme');
    if (lien) lien.href = '/commun/themes/' + theme + '.css';
    racine.setAttribute('data-sk-theme', theme);
    window.dispatchEvent(new CustomEvent('sk-theme', { detail: { theme } }));
  }

  function connecter() {
    const u = new URL('/commun/theme/flux', location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(u.href);
    } catch {
      setTimeout(connecter, RECONNEXION);
      return;
    }
    // Meme format que flux.js : « type », saut de ligne, donnees JSON.
    ws.onmessage = (m) => {
      const texte = String(m.data);
      const i = texte.indexOf('\n');
      if (i < 0 || texte.slice(0, i) !== 'etat') return;
      try {
        appliquer(String(JSON.parse(texte.slice(i + 1)).theme || ''));
      } catch {
        /* message illisible : on garde le theme en place */
      }
    };
    ws.onclose = () => setTimeout(connecter, RECONNEXION);
  }

  connecter();
})();
