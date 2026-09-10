// Catalogue des carrosseries Rocket League et selection du streamer.
//
// Les noms arrivent de partout : coches dans la page « Mes voitures », recopies
// depuis le wiki, tapes a la main dans un ancien cars.json. La normalisation est
// ce qui evite de dire « voiture inconnue » a un streamer qui a simplement ecrit
// « X Devil » au lieu de « X-Devil ».

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliser,
  trouver,
  resoudre,
  nettoyer,
  catalogue,
  VOITURES_DE_BASE,
} from '../src/modules/roue-rl/voitures.js';

test('le catalogue livre avec le module est lisible', () => {
  const liste = catalogue();
  assert.ok(liste.length > 100, 'catalogue anormalement court : ' + liste.length);
  for (const c of liste.slice(0, 5)) {
    assert.ok(c.name && c.slug && c.file, 'entree incomplete : ' + JSON.stringify(c));
  }
});

test('les voitures offertes a tous existent bien au catalogue', () => {
  // Elles sont proposees d'office : si l'une disparaissait du catalogue, le
  // streamer se verrait cocher une voiture sans icone.
  for (const nom of VOITURES_DE_BASE) {
    assert.ok(trouver(nom), 'voiture de base absente du catalogue : ' + nom);
  }
});

test('la normalisation absorbe casse, tirets, accents et apostrophes', () => {
  assert.equal(normaliser('X-Devil'), normaliser('x devil'));
  assert.equal(normaliser('  Road   Hog '), 'road hog', 'espaces multiples reduits');
  assert.equal(normaliser("007's"), normaliser('007s'), 'apostrophe droite');
  assert.equal(normaliser('007’s'), normaliser('007s'), 'apostrophe typographique');
  assert.equal(normaliser('Éclair'), 'eclair');
});

test('un nom ecrit autrement retrouve quand meme sa voiture', () => {
  assert.equal(trouver('x devil').name, 'X-Devil');
  assert.equal(trouver('OCTANE').name, 'Octane');
  assert.equal(trouver('  road hog  ').name, 'Road Hog');
});

test('un nom inconnu vaut mieux que deviner de travers', () => {
  assert.equal(trouver('Voiture Inventee'), null);
  assert.equal(trouver(''), null);
  assert.equal(trouver('   '), null);
});

test('resoudre range les connues et met les autres de cote', () => {
  const { voitures, inconnues } = resoudre(['octane', 'X Devil', 'Voiture Inventee', 'dominus']);

  assert.deepEqual(
    voitures.map((c) => c.name),
    ['Dominus', 'Octane', 'X-Devil'],
    'triees par nom'
  );
  assert.deepEqual(inconnues, ['Voiture Inventee'], 'signalees telles quelles, au streamer de corriger');
});

test('resoudre ne compte pas deux fois la meme voiture', () => {
  // « octane » et « OCTANE » sont la meme voiture : la tirer deux fois plus
  // souvent que les autres serait un biais invisible.
  const { voitures } = resoudre(['octane', 'OCTANE', 'Octane']);
  assert.equal(voitures.length, 1);
});

test('resoudre accepte une selection vide', () => {
  assert.deepEqual(resoudre(), { voitures: [], inconnues: [] });
  assert.deepEqual(resoudre([]), { voitures: [], inconnues: [] });
});

test('nettoyer remet les libelles officiels, sans doublon ni vide', () => {
  const propre = nettoyer(['octane', 'OCTANE', 'x devil', '   ', 'breakout']);
  assert.deepEqual(propre, ['Breakout', 'Octane', 'X-Devil']);
});

test('nettoyer conserve un nom inconnu plutot que de le jeter', () => {
  // Une voiture ajoutee par Psyonix apres la derniere mise a jour du catalogue
  // ne doit pas disparaitre de la selection du streamer sans prevenir.
  assert.deepEqual(nettoyer(['Voiture Toute Neuve', 'octane']), ['Octane', 'Voiture Toute Neuve']);
});

test('nettoyer accepte une liste vide', () => {
  assert.deepEqual(nettoyer(), []);
  assert.deepEqual(nettoyer([]), []);
});
