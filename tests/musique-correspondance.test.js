// Reconnaissance du morceau demande par un viewer.
//
// C'est la regle la plus consequente du bot musique : elle decide si le viewer
// entend son morceau ou se fait rembourser ses points de chaine. Trop laxiste,
// le bot passe n'importe quoi ; trop stricte, il rembourse des demandes
// legitimes. Les deux se voient en direct, jamais dans un journal.

import test from 'node:test';
import assert from 'node:assert/strict';

import { looseMatch, choisirMeilleur } from '../src/modules/musique/spotify.js';

const piste = (nom, ...artistes) => ({
  uri: 'spotify:track:' + nom.toLowerCase().replaceAll(' ', '-'),
  name: nom,
  artists: artistes.map((name) => ({ name })),
});

// --- looseMatch : « quelle demande le viewer veut-il annuler ? » -----------

test('la demande est reconnue meme partielle ou dans le desordre', () => {
  assert.ok(looseMatch('beautiful things', 'Beautiful Things Benson Boone'));
  assert.ok(looseMatch('queen bohemian', 'Bohemian Rhapsody Queen'), "l'ordre ne compte pas");
  assert.ok(looseMatch('beautiful', 'Beautiful Things Benson Boone'), 'un mot sur deux suffit');
});

test('un titre etranger ne correspond pas', () => {
  assert.equal(looseMatch('bohemian rhapsody', 'Beautiful Things Benson Boone'), false);
});

test('une saisie vide ou sans mot utile ne correspond a rien', () => {
  // Les mots vides (« the », « a », « feat ») et les mots d'une lettre sont
  // ecartes : sans ca, « the » annulerait la premiere demande venue.
  assert.equal(looseMatch('', 'Bohemian Rhapsody Queen'), false);
  assert.equal(looseMatch('the a of', 'Bohemian Rhapsody Queen'), false);
});

test('la tolerance aux fautes s arrete aux mots courts', () => {
  // Choix assume : au-dela de 6 lettres on pardonne 2 corrections, en dessous
  // une seule, et rien sous 4 lettres. Une inversion de lettres compte pour
  // deux corrections -- « thigns » ne rattrape donc pas « things ».
  assert.ok(looseMatch('beautifull things', 'Beautiful Things Benson Boone'), 'une lettre en trop');
  assert.equal(
    looseMatch('beautifull thigns', 'Beautiful Things Benson Boone'),
    false,
    'deux mots abimes dont une inversion : on refuse'
  );
});

// --- choisirMeilleur : lequel des resultats Spotify retenir ? --------------

test('le meilleur candidat gagne, pas le premier renvoye', () => {
  // Spotify remonte souvent un titre plus court en premier.
  const choix = choisirMeilleur('beautiful things', [
    piste('Beautiful', 'Quelqu un'),
    piste('Beautiful Things', 'Benson Boone'),
  ]);
  assert.equal(choix.name, 'Beautiful Things');
  assert.equal(choix.uri, 'spotify:track:beautiful-things');
});

test('plusieurs artistes sont reunis en une seule chaine', () => {
  const choix = choisirMeilleur('bohemian rhapsody queen', [
    piste('Bohemian Rhapsody', 'Queen', 'David Bowie'),
  ]);
  assert.equal(choix.artists, 'Queen, David Bowie');
});

test('un titre plus long que la demande est refuse', () => {
  // « beautiful » ne doit PAS lancer « Beautiful Things » : le viewer visait
  // autre chose, mieux vaut rembourser que passer le mauvais morceau.
  assert.equal(choisirMeilleur('beautiful', [piste('Beautiful Things', 'Benson Boone')]), null);
});

test('un resultat sans rapport avec la demande est refuse', () => {
  assert.equal(choisirMeilleur('un truc qui nexiste pas', [piste('Bohemian Rhapsody', 'Queen')]), null);
});

test('aucun resultat, ou une demande vide, donnent null', () => {
  assert.equal(choisirMeilleur('bohemian rhapsody', []), null);
  assert.equal(choisirMeilleur('', [piste('Bohemian Rhapsody', 'Queen')]), null);
  assert.equal(choisirMeilleur('the a of', [piste('Bohemian Rhapsody', 'Queen')]), null);
});

test('citer l artiste aide a departager deux titres identiques', () => {
  const choix = choisirMeilleur('bohemian rhapsody queen', [
    piste('Bohemian Rhapsody', 'Panic At The Disco'),
    piste('Bohemian Rhapsody', 'Queen'),
  ]);
  assert.equal(choix.artists, 'Queen');
});
