// Comparaison de versions. Trois lignes de code, mais elles decident si le
// streamer se voit proposer une mise a jour — ou si on lui propose de revenir
// en arriere. Le piege classique est de comparer des chaines : « 0.10.0 » est
// alors juge PLUS PETIT que « 0.9.0 », et une release passe inapercue.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const maj = await import('../src/core/maj.js');

after(() => nettoyer(DONNEES));

test('10 vient bien apres 9', () => {
  assert.equal(maj.comparer('0.10.0', '0.9.0'), 1);
  assert.equal(maj.comparer('0.9.0', '0.10.0'), -1);
  assert.equal(maj.comparer('1.0.0', '0.99.99'), 1);
});

test('deux versions identiques sont egales', () => {
  assert.equal(maj.comparer('0.12.0', '0.12.0'), 0);
});

test('le « v » des tags GitHub est ignore', () => {
  // Les releases sont taguees v0.12.0 mais package.json dit 0.12.0.
  assert.equal(maj.comparer('v0.12.0', '0.12.0'), 0);
  assert.equal(maj.comparer('v0.12.1', '0.12.0'), 1);
});

test('une version incomplete est traitee comme se terminant par des zeros', () => {
  assert.equal(maj.comparer('1.2', '1.2.0'), 0);
  assert.equal(maj.comparer('1.2.1', '1.2'), 1);
});

test('chaque cran de version est compare separement', () => {
  assert.equal(maj.comparer('0.12.0', '0.11.9'), 1);
  assert.equal(maj.comparer('0.11.10', '0.11.9'), 1);
});

test('la version installee est celle de package.json', async () => {
  const { readFileSync } = await import('node:fs');
  const { RACINE } = await import('../src/core/paths.js');
  const { join } = await import('node:path');

  const attendue = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).version;
  assert.equal(maj.versionActuelle(), attendue);
  // Elle est mise en cache : deux appels doivent donner la meme chose.
  assert.equal(maj.versionActuelle(), attendue);
});
