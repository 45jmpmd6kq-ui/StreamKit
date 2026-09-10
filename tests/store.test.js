// Le stockage porte deux promesses que StreamKit fait au streamer :
//   « une mise a jour ne te fait jamais perdre tes reglages »
//   « un fichier abime ne t empeche jamais de demarrer en plein live »
// Ce sont elles qu'on teste ici, pas les fonctions une par une.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const store = await import('../src/core/store.js');
const { preparerDossiers } = await import('../src/core/paths.js');

// Comme au demarrage du noyau : les sous-dossiers (etat/, journaux/) doivent
// exister avant qu'on y ecrive.
preparerDossiers();

const CONFIG = join(DONNEES, 'config.json');
const TOKENS = join(DONNEES, 'tokens.json');

after(() => nettoyer(DONNEES));

// --- La promesse « tes reglages survivent aux mises a jour » ---------------

test('une nouvelle option apparait sans effacer les reglages existants', () => {
  // Le scenario que la fusion profonde existe pour rendre impossible : le
  // streamer a un config.json ou `maj` ne contient que `depot`. Une version
  // suivante ajoute `maj.auto`. Avec une fusion superficielle, l'objet stocke
  // ecraserait le defaut en bloc et `auto` n'existerait jamais chez lui.
  writeFileSync(CONFIG, JSON.stringify({ maj: { depot: 'moi/mon-fork' } }), 'utf8');

  const c = store.chargerConfig();
  assert.equal(c.maj.depot, 'moi/mon-fork', 'la valeur du streamer gagne');
  assert.equal(c.maj.auto, true, 'le defaut comble ce qui manque');
  assert.equal(c.reseau.port, 4455, 'les branches absentes arrivent entieres');
});

test('un reglage a false ou 0 n est pas remplace par son defaut', () => {
  // Piege classique des fusions ecrites avec || : `auto: false` deviendrait
  // `true`, et le streamer qui a coupe les mises a jour les reverrait.
  writeFileSync(CONFIG, JSON.stringify({ maj: { auto: false }, reseau: { port: 0 } }), 'utf8');

  const c = store.chargerConfig();
  assert.equal(c.maj.auto, false);
  assert.equal(c.reseau.port, 0);
});

// --- La promesse « un fichier abime ne bloque pas le demarrage » -----------

test('un config.json illisible est mis de cote, pas fatal', () => {
  writeFileSync(CONFIG, '{ ceci n est pas du JSON', 'utf8');

  const c = store.chargerConfig();
  assert.equal(c.reseau.port, 4455, 'on repart des defauts');
  assert.ok(existsSync(CONFIG + '.corrompu'), 'le fichier fautif est conserve a cote');
});

test('un BOM ajoute par le Bloc-notes ne coute pas ses reglages au streamer', () => {
  writeFileSync(CONFIG, '﻿' + JSON.stringify({ twitch: { channel: 'sylvain' } }), 'utf8');
  assert.equal(store.chargerConfig().twitch.channel, 'sylvain');
});

// --- Entrees de module ----------------------------------------------------

test('un module inconnu recoit une entree neutre plutot qu un plantage', () => {
  store.chargerConfig();
  const e = store.entreeModule('module-jamais-vu');
  assert.deepEqual(e, { actif: false, schemaVersion: 0, reglages: {} });
});

test('sauver une partie d une entree de module garde le reste', () => {
  store.chargerConfig();
  store.sauverModule('musique', { actif: true, reglages: { cout: 500 } });
  store.sauverModule('musique', { actif: false });

  const e = store.entreeModule('musique');
  assert.equal(e.actif, false);
  assert.deepEqual(e.reglages, { cout: 500 }, 'les reglages ne partent pas avec la bascule');
});

// --- Jetons : le cache memoire --------------------------------------------

test('un jeton ecrit est relu tel quel', () => {
  store.sauverTokens({ twitchApp: { clientId: 'abc' } });
  assert.equal(store.lireTokens().twitchApp.clientId, 'abc');
});

test('majTokens relit avant d ecrire : deux modules ne s ecrasent pas', () => {
  // Deux modules peuvent rafraichir leur jeton en meme temps. Le second ne
  // doit pas repartir d'une copie perimee et effacer le premier.
  store.sauverTokens({});
  store.majTokens((t) => {
    t.modules = { musique: { jeton: 'A' } };
  });
  store.majTokens((t) => {
    t.modules.valorant = { jeton: 'B' };
  });

  const t = store.lireTokens();
  assert.equal(t.modules.musique.jeton, 'A');
  assert.equal(t.modules.valorant.jeton, 'B');
  assert.deepEqual(JSON.parse(readFileSync(TOKENS, 'utf8')).modules.musique, { jeton: 'A' });
});

test('le cache est invalide quand le fichier change sous nos pieds', () => {
  // Le cache ne doit pas rendre tokens.json aveugle a une edition a la main.
  // On force la date de modification : sans ca, l'ecriture pourrait tomber
  // dans la meme milliseconde que la precedente et le test serait instable.
  store.sauverTokens({ marqueur: 'avant' });
  assert.equal(store.lireTokens().marqueur, 'avant');

  writeFileSync(TOKENS, JSON.stringify({ marqueur: 'apres' }), 'utf8');
  const plusTard = new Date(Date.now() + 5000);
  utimesSync(TOKENS, plusTard, plusTard);

  assert.equal(store.lireTokens().marqueur, 'apres');
});

// --- Etat persistant d'un module ------------------------------------------

test('l etat d un module fait l aller-retour', () => {
  store.sauverEtat('roue-rl', { possedees: ['Octane', 'Fennec'] });
  assert.deepEqual(store.lireEtat('roue-rl').possedees, ['Octane', 'Fennec']);
});

test('l etat d un module jamais ecrit renvoie le defaut fourni', () => {
  assert.deepEqual(store.lireEtat('module-vierge', { possedees: [] }), { possedees: [] });
});
