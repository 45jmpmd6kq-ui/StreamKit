// Suivi des parties LoL, rejoue tour par tour.
//
// Un faux client (phase, classement, historique, detail) et une fausse horloge :
// on deroule une soiree a la seconde pres, sans rien attendre. Chaque test est
// un moment qui a deja piege ce genre d'outil : les LP qui arrivent apres le
// resultat, la defaite a 0 LP qui ne fait rien bouger, la partie refaite, la
// partie normale entre deux classees, le client qui se ferme en plein suivi.

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerSuivi, DELAIS } from '../src/modules/lol-session/suivi.js';
import { ErreurClient } from '../src/modules/lol-session/client.js';

const MOI = { puuid: 'puuid-moi', summonerId: 7, accountId: 9, gameName: 'Pseudo', tagLine: 'EUW' };

function jeu({
  id,
  victoire = true,
  champion = 103,
  queue = 420,
  fin = 0,
  remake = false,
  k = 6,
  d = 2,
  a = 8,
}) {
  return {
    gameId: id,
    queueId: queue,
    gameCreation: fin - 1800 * 1000,
    gameDuration: 1800,
    participantIdentities: [{ participantId: 1, player: { puuid: MOI.puuid } }],
    participants: [
      {
        participantId: 1,
        championId: champion,
        teamId: 100,
        stats: {
          win: victoire,
          kills: k,
          deaths: d,
          assists: a,
          totalMinionsKilled: 190,
          neutralMinionsKilled: 10,
          visionScore: 30,
          gameEndedInEarlySurrender: remake,
        },
      },
    ],
  };
}

function monter({ depuis = 0 } = {}) {
  const client = {
    ouvert: true,
    sig: 'port:mdp',
    phaseCourante: 'None',
    enJeu: null, // { gameId, queueId }
    rang: { tier: 'EMERALD', division: 'III', leaguePoints: 41 },
    historiqueJeux: [],
    details: {},
    appelsHistorique: 0,
    rafraichir() {
      if (!client.ouvert) throw new ErreurClient('client fermé');
    },
    signature: () => client.sig,
    phase: async () => client.phaseCourante,
    session: async () =>
      client.enJeu
        ? { gameData: { gameId: client.enJeu.gameId, queue: { id: client.enJeu.queueId } } }
        : null,
    invocateur: async () => MOI,
    classement: async () => ({
      queueMap: { RANKED_SOLO_5x5: { queueType: 'RANKED_SOLO_5x5', ...client.rang } },
    }),
    historique: async () => {
      client.appelsHistorique++;
      return { games: { games: [...client.historiqueJeux].reverse() } };
    },
    partie: async (id) => client.details[id] ?? null,
  };

  let t = 1_000_000;
  const parties = [];
  const evenements = [];
  const suivi = creerSuivi({
    client,
    file: 'solo',
    parties,
    depuis: () => depuis,
    maintenant: () => t,
    surClient: (ouvert) => evenements.push(['client', ouvert]),
    surPartie: (p) => evenements.push(['partie', p.id, p.victoire]),
    surLp: (p) => evenements.push(['lp', p.id, p.lp]),
    surIgnoree: (raison) => evenements.push(['ignoree', raison]),
  });

  // Avance l'horloge, puis joue un tour.
  const tour = async (secondes = 2) => {
    t += secondes * 1000;
    await suivi.tour();
  };

  // Une partie du lancement a l'ecran de fin (le resultat n'est pas encore dans
  // l'historique).
  const jouer = async (gameId, queueId = 420) => {
    client.phaseCourante = 'ChampSelect';
    await tour();
    client.phaseCourante = 'InProgress';
    client.enJeu = { gameId, queueId };
    await tour();
    await tour(600);
    client.phaseCourante = 'EndOfGame';
    client.enJeu = null;
    await tour();
  };

  return { client, suivi, parties, evenements, tour, jouer, heure: () => t };
}

test('victoire : comptee des qu elle est dans l historique, LP ensuite', async () => {
  const s = monter();
  await s.tour();
  assert.deepEqual(s.evenements, [['client', true]]);
  assert.equal(s.suivi.etat.rang.palier, 'EMERALD');

  await s.jouer(101);
  assert.equal(s.parties.length, 0, 'pas encore dans l historique');

  s.client.historiqueJeux.push(jeu({ id: 101, fin: s.heure() }));
  await s.tour(5);
  assert.equal(s.parties.length, 1, 'le bilan n attend pas les LP');
  assert.equal(s.parties[0].lpEnAttente, true);
  assert.deepEqual(s.parties[0].rangAvant, { palier: 'EMERALD', division: 'III', lp: 41 });

  // Le classement est publie quelques secondes plus tard.
  s.client.rang = { tier: 'EMERALD', division: 'III', leaguePoints: 65 };
  await s.tour(5);
  assert.equal(s.parties[0].lp, 24);
  assert.equal(s.parties[0].lpEnAttente, false);
  assert.deepEqual(s.parties[0].rangApres, { palier: 'EMERALD', division: 'III', lp: 65 });
  assert.equal(s.suivi.etat.enCours, null);
  assert.deepEqual(s.evenements.slice(1), [
    ['partie', 101, true],
    ['lp', 101, 24],
  ]);
});

test('promotion : les LP traversent la division', async () => {
  const s = monter();
  s.client.rang = { tier: 'EMERALD', division: 'III', leaguePoints: 76 };
  await s.tour();
  await s.jouer(102);
  s.client.historiqueJeux.push(jeu({ id: 102, fin: s.heure() }));
  s.client.rang = { tier: 'EMERALD', division: 'II', leaguePoints: 2 };
  await s.tour(5);
  assert.equal(s.parties[0].lp, 26);
});

test('defaite a 0 LP protegee : comptee tout de suite, 0 LP au bout du delai', async () => {
  const s = monter();
  s.client.rang = { tier: 'GOLD', division: 'I', leaguePoints: 0 };
  await s.tour();
  await s.jouer(103);
  s.client.historiqueJeux.push(jeu({ id: 103, victoire: false, fin: s.heure() }));
  await s.tour(5);
  assert.equal(s.parties.length, 1);
  assert.equal(s.parties[0].lpEnAttente, true);

  await s.tour(DELAIS.lpMax / 1000);
  assert.equal(s.parties[0].lp, 0);
  assert.equal(s.parties[0].lpEnAttente, false);
});

test('victoire dont les LP ne viennent jamais : inconnus, pas zero', async () => {
  const s = monter();
  await s.tour();
  await s.jouer(104);
  s.client.historiqueJeux.push(jeu({ id: 104, fin: s.heure() }));
  await s.tour(5);
  await s.tour(DELAIS.lpMax / 1000);
  assert.equal(s.parties[0].lp, null);
  assert.equal(s.parties[0].rangApres, null);
});

test('partie refaite et partie normale : jamais comptees', async () => {
  const s = monter();
  await s.tour();

  await s.jouer(105);
  s.client.historiqueJeux.push(jeu({ id: 105, fin: s.heure(), remake: true }));
  await s.tour(5);
  assert.equal(s.parties.length, 0);
  assert.equal(s.suivi.etat.enCours, null);

  // Une normale en selection (file 400).
  s.client.phaseCourante = 'InProgress';
  s.client.enJeu = { gameId: 106, queueId: 400 };
  await s.tour();
  const avant = s.client.appelsHistorique;
  s.client.phaseCourante = 'EndOfGame';
  s.client.enJeu = null;
  await s.tour();
  assert.equal(s.parties.length, 0);
  assert.equal(s.suivi.etat.enCours, null);
  assert.equal(s.client.appelsHistorique, avant, 'inutile de chercher une partie hors file');

  assert.deepEqual(
    s.evenements.filter((e) => e[0] === 'ignoree').map((e) => e[1]),
    ['partie refaite (remake)', 'hors Classée Solo/Duo']
  );
});

test('nouvelle partie avant les LP de la precedente : la precedente est soldee', async () => {
  const s = monter();
  await s.tour();
  await s.jouer(107);
  s.client.historiqueJeux.push(jeu({ id: 107, victoire: false, fin: s.heure() }));
  await s.tour(5);
  assert.equal(s.parties[0].lpEnAttente, true);

  // Relance immediate : la partie 108 demarre, les LP de 107 n'ont pas bouge.
  s.client.phaseCourante = 'InProgress';
  s.client.enJeu = { gameId: 108, queueId: 420 };
  await s.tour();
  assert.equal(s.parties[0].lpEnAttente, false);
  assert.equal(s.parties[0].lp, 0, 'defaite sans mouvement : 0');
  assert.equal(s.suivi.etat.enCours.gameId, 108);
});

test('client ferme en plein suivi, puis rouvert : la partie est retrouvee', async () => {
  const s = monter();
  await s.tour();
  s.client.phaseCourante = 'InProgress';
  s.client.enJeu = { gameId: 109, queueId: 420 };
  await s.tour();

  s.client.ouvert = false;
  await s.tour(900);
  assert.equal(s.suivi.etat.clientOuvert, false);
  assert.equal(s.suivi.etat.statut, 'client_ferme');
  assert.equal(s.suivi.etat.enCours.gameId, 109, 'la partie en cours n est pas oubliee');

  s.client.ouvert = true;
  s.client.sig = 'nouveau-port:nouveau-mdp';
  s.client.phaseCourante = 'EndOfGame';
  s.client.enJeu = null;
  s.client.historiqueJeux.push(jeu({ id: 109, fin: s.heure() }));
  await s.tour();
  assert.equal(s.parties.length, 1);
  assert.deepEqual(
    s.evenements.filter((e) => e[0] === 'client'),
    [
      ['client', true],
      ['client', false],
      ['client', true],
    ]
  );
});

test('reconnexion apres un plantage du jeu : la partie n etait pas finie', async () => {
  const s = monter();
  await s.tour();
  s.client.phaseCourante = 'InProgress';
  s.client.enJeu = { gameId: 110, queueId: 420 };
  await s.tour();

  s.client.phaseCourante = 'None'; // le jeu plante
  s.client.enJeu = null;
  await s.tour();
  assert.ok(s.suivi.etat.enCours.finA > 0);

  s.client.phaseCourante = 'Reconnect';
  s.client.enJeu = { gameId: 110, queueId: 420 };
  await s.tour();
  assert.equal(s.suivi.etat.enCours.finA, 0, 'on attend de nouveau la fin');
});

test('rattrapage : une partie jouee hors suivi est retrouvee, sans ses LP', async () => {
  const s = monter({ depuis: 500_000 });
  s.client.historiqueJeux.push(jeu({ id: 90, fin: 400_000 })); // avant la session
  s.client.historiqueJeux.push(jeu({ id: 111, fin: 900_000, victoire: false }));
  s.client.historiqueJeux.push(jeu({ id: 112, fin: 950_000, queue: 450 })); // ARAM
  s.client.details[111] = null;
  await s.tour();

  assert.deepEqual(
    s.parties.map((p) => [p.id, p.victoire, p.lp, p.rattrapee]),
    [[111, false, null, true]]
  );

  // Pas de nouveau rattrapage avant le delai.
  const avant = s.client.appelsHistorique;
  await s.tour();
  assert.equal(s.client.appelsHistorique, avant);
});

test('compte pas encore connecte : on attend sans rien compter', async () => {
  const s = monter();
  s.client.invocateur = async () => null;
  await s.tour();
  assert.equal(s.suivi.etat.statut, 'demarrage');
  assert.equal(s.suivi.etat.moi, null);
  assert.equal(s.parties.length, 0);
});

test('client qui demarre (404, 503) : « démarrage », pas une erreur', async () => {
  const s = monter();
  for (const status of [404, 503]) {
    s.client.phase = async () => {
      const e = new Error('le client a répondu ' + status + ' sur /lol-gameflow/v1/gameflow-phase');
      e.status = status;
      throw e;
    };
    await s.tour(); // ne leve pas
    assert.equal(s.suivi.etat.statut, 'demarrage');
  }

  // Une vraie erreur, elle, remonte au module qui la journalise.
  s.client.phase = async () => {
    throw new Error('réponse illisible du client');
  };
  await assert.rejects(s.tour(), /illisible/);
});
