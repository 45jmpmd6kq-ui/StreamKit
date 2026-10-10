// Theme d'overlay : suit en direct les reglages de « Personnalisation ».
//
// Pose par le serveur sur chaque overlay (voir poserTheme dans
// src/core/serveur.js), avec la feuille du theme de son univers :
//   <html data-sk-theme="neon" data-sk-univers="lol" style="--sk-neon-1: ...">
//   ...  <link id="sk-theme" href="/commun/themes/neon.css">
//
// Quand le streamer change un theme ou les couleurs du Neon, StreamKit pousse
// ses reglages sur le canal « themes » : on remplace la feuille, l'attribut et
// les couleurs sans recharger la page -- l'overlay garde son etat (morceau en
// cours, session, tirage...). Un overlay qui dessine lui-meme ses couleurs
// (canvas) peut ecouter l'evenement « sk-theme » sur window.
//
// data-sk-fige : une source figee sur un theme (?theme=), dont les vignettes de
// la page Personnalisation. Elle garde son theme, mais suit les couleurs du Neon.
//
// WebSocket pour la meme raison que flux.js : un flux SSE par overlay
// epuiserait les 6 connexions que le Chromium d'OBS garde par hote.

(function () {
  'use strict';

  const racine = document.documentElement;
  const fige = racine.hasAttribute('data-sk-fige');
  const univers = racine.getAttribute('data-sk-univers') || '';
  const RECONNEXION = 2000;

  function poserNeon(variables) {
    for (const [nom, valeur] of Object.entries(variables || {})) {
      if (/^--sk-neon-[\w-]+$/.test(nom)) racine.style.setProperty(nom, String(valeur));
    }
  }

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
        const etat = JSON.parse(texte.slice(i + 1));
        poserNeon(etat.neon);
        if (!fige) appliquer(String(etat.univers?.[univers] || etat.defaut || ''));
      } catch {
        /* message illisible : on garde le theme en place */
      }
    };
    ws.onclose = () => setTimeout(connecter, RECONNEXION);
  }

  connecter();
})();
