// Historique des matchs classes et calcul du bandeau de session.
//
// Le bandeau est a l'ecran pendant tout le stream : un W compte pour un L, une
// serie fausse ou un RR de travers se voient immediatement, et le chat le fait
// savoir. Le point delicat est le match de PLACEMENT, ou Riot ne publie aucun
// RR : gain nul ne veut alors pas dire match nul, ca veut dire « on ne sait pas
// encore ».

import test from 'node:test';
import assert from 'node:assert/strict';

import { enregistrer, aConfirmer, appliquerDetail, blocSession } from '../src/modules/valorant/session.js';

// Un match tel que Riot le renvoie (noms de champs compris).
const brut = (id, debut, rrGagne) => ({
  MatchID: id,
  MatchStartTime: debut,
  RankedRatingEarned: rrGagne,
  MapID: '/Game/Maps/Ascent/Ascent',
  TierAfterUpdate: 12,
  TierBeforeUpdate: 12,
  RankedRatingAfterUpdate: 40,
  RankedRatingBeforeUpdate: 20,
});

// --- Enregistrement --------------------------------------------------------

test('le resultat se deduit du signe du RR', () => {
  const matchs = [];
  enregistrer(matchs, [brut('gagne', 3000, 20), brut('perdu', 2000, -18)]);

  assert.equal(matchs.find((m) => m.id === 'gagne').resultat, 'W');
  assert.equal(matchs.find((m) => m.id === 'perdu').resultat, 'L');
});

test('un gain nul reste SANS resultat, ce n est pas un match nul', () => {
  // C'est le cas de tous les placements : Riot ne publie pas de RR avant
  // l'attribution du rang. Trancher ici afficherait un faux resultat au chat.
  const matchs = [];
  enregistrer(matchs, [brut('placement', 1000, 0)]);

  assert.equal(matchs[0].resultat, '', 'le detail du match tranchera plus tard');
});

test('un match deja connu n est pas enregistre deux fois', () => {
  const matchs = [];
  assert.equal(enregistrer(matchs, [brut('a', 1000, 20), brut('b', 2000, -18)]), 2);
  assert.equal(enregistrer(matchs, [brut('a', 1000, 20)]), 0, 'aucun nouveau');
  assert.equal(matchs.length, 2);
});

test('les matchs sont ranges du plus recent au plus ancien', () => {
  const matchs = [];
  enregistrer(matchs, [brut('vieux', 1000, 20), brut('neuf', 3000, 20), brut('milieu', 2000, 20)]);

  assert.deepEqual(
    matchs.map((m) => m.id),
    ['neuf', 'milieu', 'vieux']
  );
});

test('l historique est plafonne, et ce sont les vieux qui partent', () => {
  const matchs = [];
  enregistrer(
    matchs,
    Array.from({ length: 250 }, (_, i) => brut('m' + i, i * 1000, 20))
  );

  assert.equal(matchs.length, 200);
  assert.equal(matchs[0].id, 'm249', 'le plus recent doit rester en tete');
  assert.ok(!matchs.some((m) => m.id === 'm0'), 'le plus vieux doit avoir saute');
});

// --- Matchs a confirmer par le detail complet ------------------------------

test('la session passe avant, les placements suivent', () => {
  const matchs = [];
  enregistrer(matchs, [
    brut('ancien-resolu', 1000, 20),
    brut('ancien-placement', 1100, 0),
    brut('session', 5000, -18),
  ]);

  const aFaire = aConfirmer(matchs, 4000);
  assert.equal(aFaire[0], 'session', 'la session est prioritaire');
  assert.ok(aFaire.includes('ancien-placement'), 'un placement non resolu reste a confirmer');
  assert.ok(!aFaire.includes('ancien-resolu'), 'un vieux match deja tranche ne coute pas un appel');
});

test('on ne demande que quelques details a la fois', () => {
  // Ces reponses pesent plusieurs Mo : tout rapatrier d'un coup ferait tomber
  // le module dans le 429 de Riot.
  const matchs = [];
  enregistrer(
    matchs,
    Array.from({ length: 10 }, (_, i) => brut('m' + i, 9000 + i, -18))
  );

  assert.equal(aConfirmer(matchs, 0).length, 3, 'limite par defaut');
  assert.equal(aConfirmer(matchs, 0, 5).length, 5);
});

test('un match qu on n arrive pas a lire finit par etre abandonne', () => {
  const matchs = [];
  enregistrer(matchs, [brut('illisible', 5000, -18)]);

  for (let i = 0; i < 5; i++) {
    assert.deepEqual(aConfirmer(matchs, 0), ['illisible'], 'essai ' + i);
    appliquerDetail(matchs, 'illisible', null);
  }
  assert.deepEqual(aConfirmer(matchs, 0), [], 'apres 5 essais, on arrete de le redemander');
});

test('le detail tranche le resultat et fige la source', () => {
  const matchs = [];
  enregistrer(matchs, [brut('placement', 1000, 0)]);
  appliquerDetail(matchs, 'placement', { resultat: 'D', gagnes: 12, perdus: 12 });

  const m = matchs[0];
  assert.equal(m.resultat, 'D');
  assert.equal(m.roundsGagnes, 12);
  assert.equal(m.source, 'details');
  assert.deepEqual(aConfirmer(matchs, 0), [], 'un match tranche ne revient pas');
});

test('appliquer un detail a un match inconnu ne casse rien', () => {
  const matchs = [];
  assert.doesNotThrow(() => appliquerDetail(matchs, 'jamais-vu', { resultat: 'W' }));
});

// --- Le bandeau lui-meme ---------------------------------------------------

test('le bilan ne compte que les matchs de la session', () => {
  const matchs = [];
  enregistrer(matchs, [brut('avant', 1000, 20), brut('pendant', 5000, -18), brut('pendant2', 6000, 25)]);

  const bloc = blocSession(matchs, 4000, 'competitive');
  assert.equal(bloc.count, 2, 'le match d avant la session ne compte pas');
  assert.equal(bloc.wins, 1);
  assert.equal(bloc.losses, 1);
  assert.equal(bloc.rr, 7, '-18 puis +25');
  assert.equal(bloc.mode, 'competitive');
});

test('la serie se lit depuis le dernier match', () => {
  const matchs = [];
  enregistrer(matchs, [brut('a', 1000, 20), brut('b', 2000, 20), brut('c', 3000, 20)]);

  const bloc = blocSession(matchs, 0, 'competitive');
  assert.equal(bloc.streak_type, 'W');
  assert.equal(bloc.streak, 3);
  assert.deepEqual(bloc.results, ['W', 'W', 'W'], 'du plus ancien au plus recent');
});

test('un resultat contraire arrete la serie', () => {
  const matchs = [];
  enregistrer(matchs, [brut('a', 1000, 20), brut('b', 2000, 20), brut('c', 3000, -18)]);

  const bloc = blocSession(matchs, 0, 'competitive');
  assert.equal(bloc.streak_type, 'L');
  assert.equal(bloc.streak, 1, 'la defaite qui vient de tomber');
});

test('un placement non resolu coupe la serie au lieu de mentir', () => {
  const matchs = [];
  enregistrer(matchs, [brut('a', 1000, 20), brut('b', 2000, 20), brut('placement', 3000, 0)]);

  const bloc = blocSession(matchs, 0, 'competitive');
  assert.equal(bloc.streak, 0);
  assert.equal(bloc.streak_type, '', 'mieux vaut ne rien afficher qu une serie inventee');
});

test('un match nul compte a part, sans casser le bilan', () => {
  const matchs = [];
  enregistrer(matchs, [brut('nul', 1000, 0), brut('gagne', 2000, 20)]);
  appliquerDetail(matchs, 'nul', { resultat: 'D', gagnes: 12, perdus: 12 });

  const bloc = blocSession(matchs, 0, 'competitive');
  assert.equal(bloc.draws, 1);
  assert.equal(bloc.wins, 1);
  assert.equal(bloc.count, 2);
});

test('le bandeau ne montre que les dix derniers resultats', () => {
  // Au-dela, les pastilles deborderaient de la source OBS.
  const matchs = [];
  enregistrer(
    matchs,
    Array.from({ length: 15 }, (_, i) => brut('m' + i, 1000 + i, 20))
  );

  assert.equal(blocSession(matchs, 0, 'competitive').results.length, 10);
});

test('une session sans match donne un bandeau vide, pas une erreur', () => {
  const bloc = blocSession([], 4000, 'competitive');
  assert.equal(bloc.count, 0);
  assert.equal(bloc.rr, 0);
  assert.equal(bloc.streak, 0);
  assert.deepEqual(bloc.results, []);
});

test('l heure de debut est affichee sur deux chiffres', () => {
  // Construite en heure locale : le test doit passer quel que soit le fuseau.
  const depart = new Date(2026, 8, 10, 9, 5, 0).getTime();
  assert.equal(blocSession([], depart, 'competitive').since, '09:05');
  assert.equal(blocSession([], depart, 'competitive').since_ms, depart);
});
