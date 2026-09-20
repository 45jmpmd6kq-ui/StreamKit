// Compteur de session Rocket League, branche de bout en bout.
//
// Un faux jeu : un serveur TCP local qui parle comme l'API de stats (messages
// colles, Data en chaine JSON), et un Launch.log ecrit au fil des parties. Le
// module est demarre avec un contexte de test ; on regarde ce qui arrive a
// l'overlay. C'est le parcours d'une soiree, en accelere : une victoire en
// classe, un match prive qui ne doit pas compter, une defaite dans une autre
// playlist classee.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import manifeste from '../src/modules/rl-session/module.js';

const MOI = 'Epic|84d786aaaaaaaaaaaaaaaaaaaaaaaaaa|0';

const attendre = async (condition, message, ms = 4000) => {
  const fin = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('delai depasse : ' + message);
    await new Promise((r) => {
      setTimeout(r, 15);
    });
  }
};

function contexte({ port, cheminLaunchLog, reglages = {} }) {
  const etats = [];
  const journal = [];
  const compteurs = {};
  const minuteurs = new Set();
  let memoire = null;
  const ctx = {
    config: {
      filtre: 'classe',
      format: 'tous',
      sessionMode: 'launch',
      coin: 'top-left',
      pseudo: '',
      cheminLaunchLog,
      port,
      ...reglages,
    },
    log: Object.fromEntries(
      ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => journal.push([n, m])])
    ),
    overlay: {
      etat: (vue, data) => etats.push([vue, data]),
      url: (vue) => 'http://127.0.0.1:47455/overlay/rl-session/' + vue,
    },
    compteur: { incr: (cle, n = 1) => (compteurs[cle] = (compteurs[cle] ?? 0) + n) },
    etat: {
      lire: (defaut) => memoire ?? defaut,
      sauver: (v) => (memoire = JSON.parse(JSON.stringify(v))),
    },
    minuteur: {
      delai(fn, ms) {
        const t = setTimeout(fn, ms);
        minuteurs.add(t);
        return t;
      },
      intervalle(fn, ms) {
        const t = setInterval(fn, ms);
        minuteurs.add(t);
        return t;
      },
    },
  };
  const couper = () => minuteurs.forEach((t) => (clearTimeout(t), clearInterval(t)));
  const session = () => etats.at(-1)?.[1].session;
  return { ctx, etats, journal, compteurs, couper, session, memoire: () => memoire };
}

// Envoie comme le vrai jeu : Data en CHAINE JSON, messages colles, et coupes a
// des endroits arbitraires.
function envoyer(socket, evenements) {
  const flux = evenements
    .map(([Event, data]) => JSON.stringify({ Event, Data: JSON.stringify(data) }))
    .join('');
  const octets = Buffer.from(flux, 'utf8');
  for (let i = 0; i < octets.length; i += 97) socket.write(octets.subarray(i, i + 97));
}

const image = (guid, equipe, score) => ({
  MatchGuid: guid,
  Players: [
    { Name: 'AceOfSpade26', PrimaryId: MOI, TeamNum: equipe },
    { Name: 'Coéquipier', PrimaryId: 'Steam|1|0', TeamNum: equipe },
    { Name: 'Adversaire', PrimaryId: 'Steam|2|0', TeamNum: 1 - equipe },
    { Name: 'Adversaire 2', PrimaryId: 'Steam|3|0', TeamNum: 1 - equipe },
  ],
  Game: {
    Teams: [
      { TeamNum: 0, Score: score[0] },
      { TeamNum: 1, Score: score[1] },
    ],
    bHasWinner: false,
  },
});

const partie = (guid, { equipe = 0, score, gagnant }) => [
  ['MatchCreated', { MatchGuid: guid }],
  ['MatchInitialized', { MatchGuid: guid }],
  ['UpdateState', image(guid, equipe, [0, 0])],
  ['UpdateState', image(guid, equipe, score)],
  ['MatchEnded', { MatchGuid: guid, WinnerTeamNum: gagnant }],
  [
    'UpdateState',
    { ...image(guid, equipe, score), Game: { ...image(guid, equipe, score).Game, bHasWinner: true } },
  ],
  ['MatchDestroyed', { MatchGuid: guid }],
];

test('une soiree : classe gagne, prive ignore, classe perdu', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'rl-module-'));
  const launchLog = join(dossier, 'Launch.log');
  writeFileSync(
    launchLog,
    [
      'Log: Log file open, 09/14/26 21:00:00',
      '[0024.61] SettingsExport: CreateSnapshot Metadata {"userId":"' + MOI + '","platformKey":"Epic"}',
      '[0169.11] Online: TryToPlayOnlineWithAntiCheat bIsRanked=(True) PlaylistId=(13)',
      '',
    ].join('\r\n')
  );

  const connexions = [];
  const jeu = net.createServer((s) => connexions.push(s));
  await new Promise((r) => {
    jeu.listen(0, '127.0.0.1', r);
  });
  const t = contexte({ port: jeu.address().port, cheminLaunchLog: launchLog });

  let instance;
  try {
    instance = await manifeste.demarrer(t.ctx);
    assert.deepEqual(t.session().victoires, 0);
    await attendre(() => connexions.length === 1, 'connexion au faux jeu');

    // 1. Classe 3v3, victoire 3-1.
    envoyer(connexions[0], partie('G1', { equipe: 0, score: [3, 1], gagnant: 0 }));
    await attendre(() => t.session()?.victoires === 1, 'victoire comptee');
    appendFileSync(launchLog, '[0572.42] ScriptLog: Match Ended - [Reservation: , MatchID: ]\r\n');

    // 2. Match prive : aucune ligne de file d'attente, donc pas de playlist.
    envoyer(connexions[0], partie('G2', { equipe: 1, score: [2, 0], gagnant: 0 }));
    await attendre(
      () => t.journal.some(([, m]) => /non comptée : playlist inconnue/.test(m)),
      'match prive ecarte'
    );
    assert.deepEqual([t.session().victoires, t.session().defaites], [1, 0]);

    // 3. Classe 2v2 : la ligne de file arrive dans le journal, puis la partie.
    appendFileSync(
      launchLog,
      '[0801.02] Online: TryToPlayOnlineWithAntiCheat bIsRanked=(True) PlaylistId=(11)\r\n'
    );
    envoyer(connexions[0], partie('G3', { equipe: 1, score: [4, 2], gagnant: 0 }));
    await attendre(() => t.session()?.defaites === 1, 'defaite comptee');

    const s = t.session();
    assert.deepEqual([s.victoires, s.defaites, s.parties], [1, 1, 2]);
    assert.deepEqual(s.serie, { victoire: false, n: 1 });
    assert.deepEqual(t.compteurs, { victoires: 1, defaites: 1 });
    assert.equal(t.memoire().historique.length, 2, 'la session survit a un redemarrage');

    const [sante] = await manifeste.sante(t.ctx);
    assert.equal(sante.etat, 'ok');
    assert.match(sante.detail, /1 V \/ 1 D/);
  } finally {
    await instance?.arreter();
    t.couper();
    jeu.close();
    connexions.forEach((s) => s.destroy());
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('reinitialiser la session remet l overlay a zero sans perdre l historique', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'rl-module-'));
  const launchLog = join(dossier, 'Launch.log');
  writeFileSync(
    launchLog,
    'Log: Log file open\r\n[0024.61] SettingsExport: {"userId":"' +
      MOI +
      '"}\r\n[0169.11] TryToPlayOnlineWithAntiCheat PlaylistId=(10)\r\n'
  );
  const connexions = [];
  const jeu = net.createServer((s) => connexions.push(s));
  await new Promise((r) => {
    jeu.listen(0, '127.0.0.1', r);
  });
  const t = contexte({ port: jeu.address().port, cheminLaunchLog: launchLog });

  let instance;
  try {
    instance = await manifeste.demarrer(t.ctx);
    await attendre(() => connexions.length === 1, 'connexion');
    envoyer(connexions[0], partie('D1', { score: [1, 0], gagnant: 0 }));
    await attendre(() => t.session()?.victoires === 1, 'victoire');

    await new Promise((r) => {
      setTimeout(r, 5);
    }); // la remise a zero doit etre posterieure
    const r = await manifeste.actions.reinitialiserSession(t.ctx);
    assert.match(r.message, /Session repartie de \d\d:\d\d/);
    assert.deepEqual([t.session().victoires, t.session().defaites], [0, 0]);
    assert.equal(t.memoire().historique.length, 1);
  } finally {
    await instance?.arreter();
    t.couper();
    jeu.close();
    connexions.forEach((s) => s.destroy());
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('sans joueur identifie, la vue d ensemble le dit une fois connecte', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'rl-module-'));
  const launchLog = join(dossier, 'Launch.log');
  writeFileSync(launchLog, 'Log: Log file open\r\n');
  const connexions = [];
  const jeu = net.createServer((s) => connexions.push(s));
  await new Promise((r) => {
    jeu.listen(0, '127.0.0.1', r);
  });
  const t = contexte({ port: jeu.address().port, cheminLaunchLog: launchLog });

  let instance;
  try {
    instance = await manifeste.demarrer(t.ctx);
    await attendre(() => connexions.length === 1, 'connexion');
    await attendre(() => t.ctx._etatRL().connecte, 'etat connecte');
    const [sante] = await manifeste.sante(t.ctx);
    assert.equal(sante.etat, 'attention');
    assert.match(sante.detail, /non identifié/);
  } finally {
    await instance?.arreter();
    t.couper();
    jeu.close();
    connexions.forEach((s) => s.destroy());
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('vue d ensemble : le jeu tourne, mais il a demarre avec l API eteinte', async () => {
  // Ce que dit le Launch.log du jeu lui-meme (PacketSendRate=0) : plus besoin
  // de deviner, et plus de « jeu fermé » pendant que le streamer joue.
  const ctx = {
    _etatRL: () => ({
      connecte: false,
      jeuLance: true,
      apiActive: true,
      apiDuJeu: { taux: 0, port: 49123 },
      bilan: { victoires: 0, defaites: 0 },
    }),
  };
  const [ligne] = await manifeste.sante(ctx);
  assert.equal(ligne.etat, 'attention');
  assert.match(ligne.detail, /API éteinte/);
  assert.match(ligne.aide, /Relance le jeu/);
});

test('vue d ensemble : API allumee au lancement du jeu, mais rien ne repond', async () => {
  const ctx = {
    _etatRL: () => ({
      connecte: false,
      jeuLance: true,
      apiActive: true,
      apiDuJeu: { taux: 30, port: 49123 },
      bilan: { victoires: 0, defaites: 0 },
    }),
  };
  const [ligne] = await manifeste.sante(ctx);
  assert.match(ligne.detail, /l’API ne répond pas/);
});
