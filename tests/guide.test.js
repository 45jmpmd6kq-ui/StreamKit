// Guide d'utilisation (src/dashboard/guide/) : la page dont le dashboard
// reprend le contenu dans sa fenêtre « Guide ».

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';

const { creerServeur, ecouter } = await import('../src/core/serveur.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();

const PORT = 45466;
const GUIDE = join(import.meta.dirname, '..', 'src', 'dashboard', 'guide');
const html = readFileSync(join(GUIDE, 'guide.html'), 'utf8');
// Ce que le streamer voit : sans les commentaires techniques.
const affiche = html.replace(/<!--[\s\S]*?-->/g, '');

const app = {
  port: PORT,
  registre: { get: () => undefined, vue: () => null, vues: () => [] },
  etatGeneral: () => ({ version: 'test', port: PORT }),
};

let serveur;
before(async () => {
  serveur = creerServeur(app);
  await ecouter(serveur, PORT);
});
after(() => {
  serveur.close();
  serveur.jumeauIPv6?.close();
  nettoyer(DONNEES);
});

test('chaque capture citee par le guide existe', () => {
  const images = [...html.matchAll(/src="\/guide\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(images.length >= 8);
  for (const f of images) assert.ok(existsSync(join(GUIDE, f)), f + ' manquante : npm run guide');
});

test('le guide ne parle jamais de l entree Moderateur', () => {
  // Elle n'existe que sur le PC du developpeur : un streamer ne doit pas la
  // decouvrir par le guide.
  assert.doesNotMatch(affiche, /mod[ée]rateur/i);
});

test('chaque chapitre a un titre pour le sommaire', () => {
  const chapitres = [...html.matchAll(/<article class="guide-chap" id="([\w-]+)" data-titre="([^"]+)"/g)];
  assert.equal(chapitres.length, 6);
});

test('la page du guide et ses captures sont servies', async () => {
  for (const chemin of ['/guide/guide.html', '/guide/guide.css', '/guide/accueil.jpg']) {
    // node:http et pas fetch : fetch garde la connexion ouverte, et sa fermeture
    // en fin de fichier fait tomber Node sous Windows (assertion libuv).
    const code = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: PORT, path: chemin, agent: false }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
    assert.equal(code, 200, chemin);
  }
});
