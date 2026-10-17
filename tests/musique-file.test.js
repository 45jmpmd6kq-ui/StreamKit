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

test('la liste « a venir » porte la vignette et un id stable par demande', () => {
  // L'id permet a l'overlay d'animer la seule ligne qui arrive ; la vignette
  // et le pseudo s'affichent quand le morceau en cours est active.
  const f = creerFile();
  const a = f.ajouter({ ...morceau('Alpha', 'Artiste', 'Viewer42'), image: 'https://i.scdn.co/image/64' });
  const b = f.ajouter(morceau('Beta'));

  const [la, lb] = f.aVenir();
  assert.equal(la.id, a.id);
  assert.equal(la.image, 'https://i.scdn.co/image/64');
  assert.equal(la.requester, 'Viewer42');
  assert.equal(lb.id, b.id);
  assert.equal(lb.image, null, 'sans pochette : null, pas undefined');
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

// SK-D319 (seigneurpercevai, 17/10/2026) : trois demandes restees « a venir »
// 25 min, aucune vue en lecture par un releve. La liste ne doit pas dependre
// du seul fait de voir chaque demande jouer.
test('une demande qui joue termine celles d avant, meme jamais vues', () => {
  const f = creerFile();
  f.ajouter(morceau('Alpha')); // passee entre deux releves
  const b = f.ajouter(morceau('Beta'));
  f.annuler(b); // annulee, et Spotify l'a deja depassee
  const c = f.ajouter(morceau('Gamma'));
  f.ajouter(morceau('Delta'));

  assert.equal(f.marquerEnLecture(c.uri), true);
  assert.deepEqual(
    f.aVenir().map((i) => i.name),
    ['Delta']
  );
  assert.equal(f.enCours().name, 'Gamma');
  assert.equal(f.estAnnule(b.uri), false, 'l annulee depassee ne doit plus faire sauter un morceau');
});

test('reconcilier : une demande que Spotify n a plus quitte la liste au 2e releve', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  const b = f.ajouter(morceau('Beta'));
  const plus = a.at + 60000;
  // La file perdue (changement d'appareil) : Spotify n'a plus que la playlist.
  const spotify = { enCours: 'spotify:track:playlist-1', uris: ['spotify:track:playlist-2', b.uri] };

  assert.equal(f.reconcilier(spotify, { maintenant: plus }), false, 'un seul releve ne suffit pas');
  assert.equal(f.reconcilier(spotify, { maintenant: plus + 30000 }), true);
  assert.deepEqual(
    f.aVenir().map((i) => i.name),
    ['Beta']
  );
});

test('reconcilier : la demande en lecture et les fraiches restent', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  const b = f.ajouter(morceau('Beta'));
  const spotify = { enCours: a.uri, uris: ['spotify:track:playlist-1'] };

  for (const t of [1000, 2000, 3000]) f.reconcilier(spotify, { maintenant: b.at + t });
  assert.deepEqual(
    f.aVenir().map((i) => i.name),
    ['Alpha', 'Beta'],
    'Alpha joue, Beta vient d etre ajoutee (le releve a pu partir avant)'
  );
});

test('reconcilier : une reponse remplie de demandes ne conclut rien', () => {
  // Spotify ne renvoie qu'une vingtaine de morceaux : si ce sont toutes des
  // demandes, la 21e est peut-etre juste derriere.
  const f = creerFile();
  const items = [];
  for (let i = 1; i <= 21; i++) items.push(f.ajouter(morceau('Titre ' + i)));
  const spotify = { enCours: 'spotify:track:autre', uris: items.slice(0, 20).map((i) => i.uri) };
  const plus = items[0].at + 60000;

  f.reconcilier(spotify, { maintenant: plus });
  assert.equal(f.reconcilier(spotify, { maintenant: plus + 30000 }), false);
  assert.equal(f.aVenir().length, 21);
});

test('reconcilier : une demande revue entre deux releves repart de zero', () => {
  const f = creerFile();
  const a = f.ajouter(morceau('Alpha'));
  const plus = a.at + 60000;
  const sans = { enCours: 'spotify:track:autre', uris: ['spotify:track:playlist-1'] };
  const avec = { enCours: 'spotify:track:autre', uris: [a.uri, 'spotify:track:playlist-1'] };

  f.reconcilier(sans, { maintenant: plus });
  f.reconcilier(avec, { maintenant: plus + 30000 });
  assert.equal(f.reconcilier(sans, { maintenant: plus + 60000 }), false);
  assert.equal(f.aVenir().length, 1);
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
