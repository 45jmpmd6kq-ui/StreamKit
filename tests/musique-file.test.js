// La file d'attente du bot musique.
//
// Spotify ne sait pas retirer un morceau de sa file : toute l'annulation repose
// sur ces statuts, et sur le fait qu'un morceau marque « annule » sera passe
// automatiquement au moment de sa lecture. Une erreur ici ne plante rien -- elle
// joue en direct un morceau que le viewer avait annule, ou en saute un qu'il
// attendait. Personne ne s'en apercevra dans un journal.

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerFile } from '../src/modules/musique/file.js';
import { looseMatch } from '../src/modules/musique/spotify.js';

const morceau = (nom, artiste = 'Artiste', qui = 'toto') => ({
  uri: 'spotify:track:' + nom.toLowerCase().replaceAll(' ', '-'),
  name: nom,
  artists: artiste,
  requester: qui,
});

test('une demande arrive en attente et recoit un numero', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  const b = f.ajouter(morceau('Beta'));

  assert.equal(a.status, 'pending');
  assert.equal(b.id, a.id + 1, 'les numeros doivent se suivre');
  assert.equal(f.enAttente().length, 2);
});

test('la liste « a venir » montre les annulees barrees, pas les jouees', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  f.ajouter(morceau('Beta'));
  const c = f.ajouter(morceau('Gamma'));

  f.annuler(c);
  f.marquerEnLecture(a.uri); // Alpha passe en lecture...
  f.marquerEnLecture('spotify:track:autre-chose'); // ...puis se termine

  const aVenir = f.aVenir();
  assert.deepEqual(
    aVenir.map((i) => [i.name, i.cancelled]),
    [
      ['Beta', false],
      ['Gamma', true],
    ]
  );
});

test('un morceau annule n est jamais mis en lecture', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  f.annuler(a);

  assert.equal(f.marquerEnLecture(a.uri), false, 'rien ne doit bouger');
  assert.equal(f.enCours(), null);
  assert.ok(f.estAnnule(a.uri), 'il reste annule, pour que le suivi le passe');
});

test('marquerEnLecture termine le precedent et ne repond que sur changement', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  const b = f.ajouter(morceau('Beta'));

  assert.equal(f.marquerEnLecture(a.uri), true);
  assert.equal(f.enCours().name, 'Alpha');

  // Meme morceau : rien n'a bouge, l'overlay n'a pas besoin d'etre repousse.
  assert.equal(f.marquerEnLecture(a.uri), false);

  assert.equal(f.marquerEnLecture(b.uri), true);
  assert.equal(f.enCours().name, 'Beta', 'Alpha doit etre termine, pas encore en lecture');
});

test('une annulee est retiree une fois passee, et seulement celle-la', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  f.ajouter(morceau('Beta'));
  f.annuler(a);

  f.retirer(a.uri);
  assert.equal(f.estAnnule(a.uri), false);
  assert.deepEqual(
    f.aVenir().map((i) => i.name),
    ['Beta']
  );

  // Retirer un morceau non annule ne doit rien casser.
  f.retirer('spotify:track:beta');
  assert.deepEqual(
    f.aVenir().map((i) => i.name),
    ['Beta']
  );
});

// --- Retrouver la demande a annuler ---------------------------------------
// C'est le viewer qui tape le titre, de memoire et souvent de travers.

test('on annule la demande la plus recente qui correspond', () => {
  const f = creerFile();
  f.ajouter(morceau('Bohemian Rhapsody', 'Queen'));
  f.ajouter(morceau('Beautiful Things', 'Benson Boone'));
  const tardive = f.ajouter(morceau('Bohemian Rhapsody', 'Panic At The Disco'));

  const trouve = f.trouverAAnnuler('bohemian rhapsody', looseMatch);
  assert.equal(trouve.id, tardive.id, 'la plus recente doit gagner');
});

test('une saisie vide vise la derniere demande, par securite', () => {
  const f = creerFile();
  f.ajouter(morceau('Alpha'));
  const derniere = f.ajouter(morceau('Beta'));

  assert.equal(f.trouverAAnnuler('', looseMatch).id, derniere.id);
  assert.equal(f.trouverAAnnuler('   ', looseMatch).id, derniere.id);
});

test('un titre qui ne correspond a rien ne fait rien annuler', () => {
  const f = creerFile();
  f.ajouter(morceau('Bohemian Rhapsody', 'Queen'));

  assert.equal(f.trouverAAnnuler('un titre inexistant', looseMatch), null);
  assert.equal(creerFile().trouverAAnnuler('quoi que ce soit', looseMatch), null, 'file vide');
});

test('annuler(null) est sans effet plutot que fatal', () => {
  // trouverAAnnuler peut renvoyer null : le module enchaine sans verifier.
  assert.equal(creerFile().annuler(null), null);
});

test('elaguer borne l historique en gardant les plus recentes', () => {
  const f = creerFile();
  for (let i = 1; i <= 10; i++) f.ajouter(morceau('Titre ' + i));

  f.elaguer(4);
  assert.deepEqual(
    f.aVenir().map((i) => i.name),
    ['Titre 7', 'Titre 8', 'Titre 9', 'Titre 10']
  );

  // Sous le plafond, elaguer ne touche a rien.
  f.elaguer(60);
  assert.equal(f.aVenir().length, 4);
});
