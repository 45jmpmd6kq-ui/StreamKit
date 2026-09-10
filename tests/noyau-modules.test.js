// Arreter un module doit VRAIMENT l'arreter.
//
// Un module recoit ses minuteurs par ctx.minuteur : le socle les suit et promet
// de les couper quand le module s'eteint. Sans cette promesse, desactiver un
// module depuis le dashboard laisserait ses setInterval tourner jusqu'au
// prochain redemarrage -- et comme StreamKit peut tourner des jours (demarrage
// avec Windows), un module « eteint » continuerait d'appeler Riot ou Spotify
// pendant toute la semaine, sans plus rien afficher nulle part.
//
// Le test est de bout en bout, sur un vrai noyau : c'est le seul moyen de
// verifier ce que le contexte fabrique dans sa fermeture.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 45460;

// La configuration est posee AVANT le demarrage : le module de demonstration
// part actif, au rythme le plus rapide qu'il accepte (une seconde).
writeFileSync(
  join(DONNEES, 'config.json'),
  JSON.stringify({
    version: 2, // deja migree : sinon le socle desactive les modules de developpement
    twitch: { channel: '', broadcasterId: '', utilisateurId: '' },
    reseau: { port: PORT },
    maj: { auto: false, depot: '' },
    modules: { exemple: { actif: true, schemaVersion: 1, reglages: { intervalle: 1, bavard: false } } },
  }),
  'utf8'
);

const { demarrerNoyau } = await import('../src/noyau.js');

let noyau;

before(async () => {
  noyau = await demarrerNoyau();
});

after(async () => {
  await noyau?.fermer();
  nettoyer(DONNEES);
});

const attendre = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

// Se branche sur l'overlay d'un module comme le ferait une source OBS, et
// compte ce qui en sort. C'est l'observation la plus honnete : si le minuteur
// tourne encore, l'overlay recoit encore.
function ecouterOverlay(chemin) {
  const recus = [];
  const requete = http.request(
    { host: '127.0.0.1', port: PORT, path: chemin, headers: { Host: '127.0.0.1:' + PORT } },
    (res) => {
      res.setEncoding('utf8');
      res.on('data', (bout) => {
        for (const ligne of bout.split('\n')) {
          if (ligne.startsWith('event: ')) recus.push(ligne.slice('event: '.length).trim());
        }
      });
    }
  );
  requete.on('error', () => {});
  requete.end();
  return { recus, fermer: () => requete.destroy() };
}

test('le module actif au demarrage tourne vraiment', async () => {
  const vue = noyau.etatGeneral();
  assert.equal(vue.modules.demarres, 1, 'le module de demonstration doit avoir demarre');
});

test('desactiver un module coupe ses minuteurs', { timeout: 20000 }, async () => {
  const flux = ecouterOverlay('/overlay/exemple/compteur/flux');

  try {
    // Le socle rejoue l'etat memorise a la connexion : on laisse passer ce
    // premier envoi, puis on compte ce qui arrive vraiment du minuteur.
    await attendre(300);
    flux.recus.length = 0;

    await attendre(2200);
    const pendant = flux.recus.length;
    assert.ok(pendant >= 1, 'le module actif devrait alimenter son overlay (recu : ' + pendant + ')');

    await noyau.app.definirActif('exemple', false);

    // Tout ce qui arrive apres l'arret vient d'un minuteur qu'on croyait coupe.
    flux.recus.length = 0;
    await attendre(2200);
    assert.deepEqual(flux.recus, [], 'le minuteur du module tourne encore apres son arret');
  } finally {
    flux.fermer();
  }
});

test('le module redemarre proprement, sans minuteur en double', { timeout: 20000 }, async () => {
  // Le streamer qui rallume un module ne doit pas se retrouver avec un overlay
  // alimente deux fois plus vite qu'avant : ce serait la trace d'un minuteur
  // resté de la session precedente.
  await noyau.app.definirActif('exemple', true);

  const flux = ecouterOverlay('/overlay/exemple/compteur/flux');
  try {
    await attendre(300);
    flux.recus.length = 0;

    await attendre(3200);
    // Trois secondes a un tic par seconde : au-dela de cinq envois, un second
    // minuteur tourne en parallele.
    assert.ok(flux.recus.length <= 5, 'trop d envois (' + flux.recus.length + ') : minuteur en double ?');
    assert.ok(flux.recus.length >= 1, 'le module rallume devrait alimenter son overlay');
  } finally {
    flux.fermer();
    await noyau.app.definirActif('exemple', false);
  }
});

test('fermer le noyau libere le port', { timeout: 20000 }, async () => {
  await noyau.fermer();
  noyau = null;

  // Si un minuteur de module gardait l'evenementiel en vie, le port resterait
  // pris — c'est exactement ce qui empechait l'installeur de mise a jour de
  // reprendre la main en 0.2.0.
  const libre = await new Promise((ok) => {
    const s = http.createServer();
    s.once('error', () => ok(false));
    s.listen(PORT, '127.0.0.1', () => s.close(() => ok(true)));
  });
  assert.ok(libre, 'le port ' + PORT + ' devrait etre rendu');
});
