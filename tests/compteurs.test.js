// L'historique des compteurs alimente la page « Métriques » : par jour, par
// live, et qui a fait quoi. Il doit survivre à un redémarrage, et un StreamKit
// relancé en plein stream ne doit pas couper le live en deux.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const compteurs = await import('../src/core/compteurs.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();
after(() => nettoyer(DONNEES));
beforeEach(() => compteurs.charger());

const aujourdhui = () => compteurs.jourDe(new Date());

test('un compteur va au total, a la session et au jour, avec le viewer', () => {
  compteurs.incr('musique', 'demandes', 1, { par: 'ziggy' });
  compteurs.incr('musique', 'demandes', 1, { par: 'ziggy' });
  compteurs.incr('musique', 'demandes', 1, { par: 'luna' });

  const h = compteurs.historique();
  const jour = h.jours[aujourdhui()];
  assert.equal(h.session.musique.demandes, 3);
  assert.equal(jour.m.musique.demandes, 3);
  assert.deepEqual(jour.par.musique.demandes, { ziggy: 2, luna: 1 });
});

test('pendant un live, les compteurs vont aussi dans le live', () => {
  compteurs.incr('clips', 'crees'); // avant le live
  compteurs.debutLive(Date.now());
  compteurs.incr('clips', 'crees', 1, { par: 'kevin' });
  compteurs.finLive();
  compteurs.incr('clips', 'crees'); // apres

  const live = compteurs.historique().lives.at(-1);
  assert.equal(live.m.clips.crees, 1);
  assert.deepEqual(live.par.clips.crees, { kevin: 1 });
  assert.ok(live.fin >= live.debut);
  assert.equal(compteurs.historique().liveEnCours, false);
});

test('StreamKit relance en plein stream reprend le meme live', () => {
  const debut = Date.now() - 60 * 60 * 1000;
  compteurs.debutLive(debut);
  compteurs.incr('clips', 'crees');
  compteurs.vider(); // ecrit sur le disque, comme a l'arret

  compteurs.charger(); // redemarrage : le live est toujours ouvert
  compteurs.debutLive(debut + 30 * 1000); // Twitch redonne (presque) le meme debut
  compteurs.incr('clips', 'crees');

  const lives = compteurs.historique().lives.filter((l) => l.debut === debut);
  assert.equal(lives.length, 1, 'un seul live, pas deux');
  assert.equal(lives[0].m.clips.crees, 2);
  compteurs.finLive();
});

test('un live reste ouvert se ferme a la derniere minute ou on l a vu', () => {
  const debut = Date.now() - 3 * 60 * 60 * 1000;
  compteurs.debutLive(debut);
  compteurs.tic();
  const vu = compteurs.historique().lives.at(-1).vu;
  compteurs.vider();

  compteurs.charger(); // StreamKit relance, plus en live
  compteurs.fermerOuverts();
  const live = compteurs.historique().lives.find((l) => l.debut === debut);
  assert.equal(live.fin, vu);
});

test('l historique survit a un redemarrage', () => {
  compteurs.incr('sondages', 'sondages');
  compteurs.vider();
  compteurs.charger();
  const h = compteurs.historique();
  assert.ok(h.jours[aujourdhui()].m.sondages.sondages >= 1);
  assert.ok(h.totaux.sondages.sondages >= 1);
  assert.deepEqual(h.session, {}, 'la session, elle, repart de zero');
});
