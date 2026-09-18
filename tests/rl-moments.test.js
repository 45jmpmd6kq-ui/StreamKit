// Moments forts Rocket League : la detection, pure.
//
// Le detecteur est rejoue evenement par evenement, horloge comprise : une
// soiree entiere tient en quelques lignes. (La connexion partagee avec le
// compteur de session est testee avec ses briques, dans rl-session-briques.)

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerDetecteur, PAUSE_SESSION_MS } from '../src/modules/rl-moments/detection.js';

const H = 3600 * 1000;

// Un detecteur a horloge reglable.
function banc(memoire = {}) {
  let t = 10 * H;
  const det = creerDetecteur({ memoire, maintenant: () => t });
  const types = (evenements) => evenements.flatMap((e) => det.recevoir(e)).map((s) => s.type);
  return { det, types, avancer: (ms) => (t += ms), heure: () => t };
}

const joueurs = (n) => Array.from({ length: n }, (_, i) => ({ Name: 'Joueur ' + i, TeamNum: i % 2 }));
const image = (n, jeu = {}) => ({
  evenement: 'UpdateState',
  data: { Players: joueurs(n), Game: { ...jeu } },
});

const debut = (n = 4) => [
  { evenement: 'MatchCreated', data: {} },
  { evenement: 'MatchInitialized', data: {} },
  image(n),
  { evenement: 'CountdownBegin', data: {} },
  { evenement: 'RoundStarted', data: {} },
];
const fin = () => [
  { evenement: 'MatchEnded', data: { WinnerTeamNum: 0 } },
  image(4, { bHasWinner: true, bOvertime: true }),
  { evenement: 'MatchDestroyed', data: {} },
];

test('chauffe : premier coup d’envoi de la premiere partie, une seule fois', () => {
  const b = banc();
  assert.equal(b.det.arme(), true, 'jamais joue : armee');
  assert.deepEqual(b.types(debut()), ['chauffe']);
  assert.equal(b.det.enChauffe(), true);
  assert.deepEqual(b.det.memoire(), { derniereActiviteA: b.heure(), rearme: false });

  // Les engagements apres un but ne relancent rien.
  assert.deepEqual(b.types([image(4), { evenement: 'CountdownBegin', data: {} }]), []);

  b.avancer(6 * 60 * 1000);
  assert.deepEqual(b.types(fin()), ['finChauffe']);
  assert.equal(b.det.enChauffe(), false);
  assert.equal(b.det.memoire().derniereActiviteA, b.heure(), 'la fin de partie repousse la prochaine');

  // La partie suivante, cinq minutes plus tard : pas de chauffe.
  b.avancer(5 * 60 * 1000);
  assert.deepEqual(b.types([...debut(), ...fin()]), []);
});

test('chauffe : de nouveau apres trois heures sans jouer, ou a la main', () => {
  const b = banc();
  b.types([...debut(), ...fin()]);

  b.avancer(PAUSE_SESSION_MS - 1000);
  assert.equal(b.det.arme(), false);
  b.avancer(2000);
  assert.equal(b.det.arme(), true);
  assert.deepEqual(b.types(debut()), ['chauffe']);
  b.types(fin());

  // Deux lives le meme apres-midi : le bouton rearme.
  b.avancer(10 * 60 * 1000);
  b.det.rearmer();
  assert.equal(b.det.memoire().rearme, true);
  assert.deepEqual(b.types(debut()), ['chauffe']);
  assert.equal(b.det.memoire().rearme, false, 'une chauffe annoncee desarme');
});

test('chauffe : l’entrainement libre ne la consomme pas', () => {
  const b = banc();
  // Un seul joueur : pas d'adversaire, pas de partie.
  assert.deepEqual(b.types([...debut(1), ...fin()]), []);
  assert.equal(b.det.memoire().derniereActiviteA, 0, 'aucune activite retenue');
  assert.deepEqual(b.types(debut(2)), ['chauffe'], 'le premier vrai 1v1 est annonce');
});

test('chauffe : decidee au coup d’envoi, annoncee quand les joueurs sont connus', () => {
  const b = banc();
  assert.deepEqual(
    b.types([
      { evenement: 'MatchCreated', data: {} },
      { evenement: 'CountdownBegin', data: {} },
    ]),
    [],
    'personne encore dans la liste'
  );
  assert.deepEqual(b.types([image(6)]), ['chauffe']);
});

test('chauffe : la memoire d’un lancement precedent est respectee', () => {
  // StreamKit relance en plein live (mise a jour) : la derniere partie date d'il
  // y a dix minutes, pas de nouvelle chauffe.
  const b = banc({ derniereActiviteA: 10 * H - 10 * 60 * 1000, rearme: false });
  assert.deepEqual(b.types(debut()), []);
  const c = banc({ derniereActiviteA: 10 * H - 10 * 60 * 1000, rearme: true });
  assert.deepEqual(c.types(debut()), ['chauffe'], 'un rearmement survit au redemarrage');
});

test('overtime : une annonce a la prolongation, fin au but en or', () => {
  const b = banc({ derniereActiviteA: 10 * H, rearme: false });
  b.types(debut());
  assert.deepEqual(b.types([image(4, { bOvertime: false }), image(4, { bOvertime: true })]), ['overtime']);
  assert.equal(b.det.enOvertime(), true);
  assert.deepEqual(b.types([image(4, { bOvertime: true }), { evenement: 'CountdownBegin', data: {} }]), []);
  assert.deepEqual(b.types([{ evenement: 'GoalScored', data: { Scorer: { Name: 'Joueur 1' } } }]), [
    'finOvertime',
  ]);
  assert.equal(b.det.enOvertime(), false);
  assert.deepEqual(b.types(fin()), [], 'rien a refermer : le but a deja clos la prolongation');
});

test('overtime : aussi par ClockUpdatedSeconds, et refermee si on quitte', () => {
  const b = banc({ derniereActiviteA: 10 * H });
  b.types(debut());
  assert.deepEqual(
    b.types([{ evenement: 'ClockUpdatedSeconds', data: { TimeSeconds: 0, bOvertime: true } }]),
    ['overtime']
  );
  assert.deepEqual(b.types([{ evenement: 'MatchDestroyed', data: {} }]), ['finOvertime']);
});

test('chauffe et overtime dans la meme partie', () => {
  const b = banc();
  assert.deepEqual(b.types([...debut(), image(4, { bOvertime: true })]), ['chauffe', 'overtime']);
  assert.deepEqual(b.types([{ evenement: 'GoalScored', data: {} }]), ['finOvertime']);
  assert.equal(b.det.enChauffe(), true, 'la chauffe tient jusqu’a la fin de la partie');
  assert.deepEqual(b.types(fin()), ['finChauffe']);
});

test('StreamKit lance en pleine prolongation : pas de chauffe en retard', () => {
  const b = banc();
  assert.deepEqual(b.types([image(4, { bOvertime: true }), { evenement: 'CountdownBegin', data: {} }]), [
    'overtime',
  ]);
  assert.equal(b.det.enChauffe(), false);
});

test('replay de l’historique et podium : rien ne s’annonce', () => {
  const b = banc();
  assert.deepEqual(
    b.types([{ evenement: 'ReplayCreated', data: {} }, ...debut(), image(4, { bOvertime: true })]),
    []
  );
  assert.deepEqual(b.types([{ evenement: 'MatchDestroyed', data: {} }]), []);
  // Le podium d'une partie qu'on n'a pas vue commencer n'ouvre rien.
  assert.deepEqual(b.types([image(4, { bHasWinner: true, bOvertime: true })]), []);
  assert.equal(b.det.arme(), true, 'la chauffe attend toujours la premiere vraie partie');
  assert.deepEqual(b.types(debut()), ['chauffe']);
});
