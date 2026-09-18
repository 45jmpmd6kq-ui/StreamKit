// Moments forts Rocket League, branches de bout en bout.
//
// Un faux jeu : un serveur TCP local qui parle comme l'API de stats (Data en
// chaine JSON, messages colles et coupes n'importe ou). Le module est demarre
// avec un contexte de test ; on regarde ce qui part vers l'overlay. Le dernier
// test branche aussi le compteur de session : une seule connexion au jeu pour
// les deux, et chacun fait son travail.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import manifeste from '../src/modules/rl-moments/module.js';
import compteur from '../src/modules/rl-session/module.js';

const MOI = 'Epic|84d786aaaaaaaaaaaaaaaaaaaaaaaaaa|0';

const attendre = async (condition, message, ms = 4000) => {
  const limite = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > limite) throw new Error('delai depasse : ' + message);
    await new Promise((r) => {
      setTimeout(r, 15);
    });
  }
};

// minuteurManuel : les delais sont gardes, pour les declencher a la main.
function contexte({ config, portJeu, minuteurManuel = false }) {
  const etats = [];
  const diffusions = [];
  const journal = [];
  const compteurs = {};
  const minuteurs = new Set();
  const delais = [];
  let memoire = null;
  const ctx = {
    config,
    portJeu,
    log: Object.fromEntries(
      ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => journal.push([n, m])])
    ),
    overlay: {
      etat: (vue, data) => etats.push([vue, data]),
      diffuser: (vue, type, data) => diffusions.push([vue, type, data]),
      url: (vue) => 'http://127.0.0.1:47455/overlay/x/' + vue,
    },
    compteur: { incr: (cle, n = 1) => (compteurs[cle] = (compteurs[cle] ?? 0) + n) },
    etat: {
      lire: (defaut) => memoire ?? defaut,
      sauver: (v) => (memoire = JSON.parse(JSON.stringify(v))),
    },
    minuteur: {
      delai(fn, ms) {
        if (minuteurManuel) return delais.push([ms, fn]);
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
  return {
    ctx,
    etats,
    diffusions,
    journal,
    compteurs,
    delais,
    memoire: () => memoire,
    couper: () => minuteurs.forEach((t) => (clearTimeout(t), clearInterval(t))),
    pastilles: () => etats.at(-1)?.[1].pastilles,
    moments: () => diffusions.filter(([, type]) => type === 'moment').map(([, , d]) => d.type),
  };
}

const REGLAGES = { chauffe: true, texteChauffe: 'Soyez sympas, je me réveille', overtime: true, pouls: true };

// Envoie comme le vrai jeu : Data en CHAINE JSON, messages colles et coupes.
function envoyer(socket, evenements) {
  const flux = evenements
    .map(([Event, data]) => JSON.stringify({ Event, Data: JSON.stringify(data) }))
    .join('');
  const octets = Buffer.from(flux, 'utf8');
  for (let i = 0; i < octets.length; i += 89) socket.write(octets.subarray(i, i + 89));
}

const image = (guid, jeu = {}) => ({
  MatchGuid: guid,
  Players: [
    { Name: 'AceOfSpade26', PrimaryId: MOI, TeamNum: 0 },
    { Name: 'Coéquipier', PrimaryId: 'Steam|1|0', TeamNum: 0 },
    { Name: 'Adversaire', PrimaryId: 'Steam|2|0', TeamNum: 1 },
    { Name: 'Adversaire 2', PrimaryId: 'Steam|3|0', TeamNum: 1 },
  ],
  Game: {
    Teams: [
      { TeamNum: 0, Score: jeu.score?.[0] ?? 0 },
      { TeamNum: 1, Score: jeu.score?.[1] ?? 0 },
    ],
    bOvertime: !!jeu.overtime,
    bHasWinner: !!jeu.gagnee,
  },
});

const debut = (guid) => [
  ['MatchCreated', { MatchGuid: guid }],
  ['MatchInitialized', { MatchGuid: guid }],
  ['UpdateState', image(guid)],
  ['CountdownBegin', { MatchGuid: guid }],
  ['RoundStarted', { MatchGuid: guid }],
];
const fin = (guid, score) => [
  ['MatchEnded', { MatchGuid: guid, WinnerTeamNum: 0 }],
  ['UpdateState', image(guid, { score, gagnee: true, overtime: true })],
  ['MatchDestroyed', { MatchGuid: guid }],
];

async function fauxJeu() {
  const connexions = [];
  const serveur = net.createServer((s) => {
    connexions.push(s);
    s.on('error', () => {});
  });
  await new Promise((r) => {
    serveur.listen(0, '127.0.0.1', r);
  });
  return {
    connexions,
    port: serveur.address().port,
    fermer: () => {
      connexions.forEach((s) => s.destroy());
      serveur.close();
    },
  };
}

test('une soiree : chauffe, overtime, puis une partie sans rien', async () => {
  const jeu = await fauxJeu();
  const t = contexte({ config: { ...REGLAGES }, portJeu: jeu.port });
  let instance;
  try {
    instance = await manifeste.demarrer(t.ctx);
    assert.deepEqual(t.pastilles(), { chauffe: false, overtime: false });
    assert.equal(t.etats.at(-1)[1].texte, REGLAGES.texteChauffe);
    await attendre(() => jeu.connexions.length === 1, 'connexion au faux jeu');

    // 1. Premiere partie : la chauffe au coup d'envoi, avec le texte du streamer.
    envoyer(jeu.connexions[0], debut('G1'));
    await attendre(() => t.moments().includes('chauffe'), 'chauffe annoncee');
    const chauffe = t.diffusions.find(([, , d]) => d.type === 'chauffe');
    assert.deepEqual(chauffe, ['moments', 'moment', { type: 'chauffe', texte: REGLAGES.texteChauffe }]);
    assert.deepEqual(t.pastilles(), { chauffe: true, overtime: false });

    // Egalite au bout du temps : l'overtime, jusqu'au but en or.
    envoyer(jeu.connexions[0], [['UpdateState', image('G1', { score: [2, 2], overtime: true })]]);
    await attendre(() => t.moments().includes('overtime'), 'overtime annonce');
    assert.deepEqual(t.pastilles(), { chauffe: true, overtime: true });
    const [sante] = await manifeste.sante(t.ctx);
    assert.deepEqual([sante.etat, sante.detail], ['ok', 'connecté — overtime en cours']);

    envoyer(jeu.connexions[0], [['GoalScored', { MatchGuid: 'G1', Scorer: { Name: 'AceOfSpade26' } }]]);
    await attendre(() => t.pastilles()?.overtime === false, 'fin de l overtime');
    assert.equal(t.pastilles().chauffe, true, 'la chauffe tient jusqu’a la fin de la partie');

    envoyer(jeu.connexions[0], fin('G1', [3, 2]));
    await attendre(() => t.pastilles()?.chauffe === false, 'fin de la chauffe');
    assert.ok(t.memoire().derniereActiviteA > 0, 'la session est memorisee');

    // 2. La partie suivante : ni chauffe ni overtime.
    const avant = t.memoire().derniereActiviteA;
    await new Promise((r) => {
      setTimeout(r, 20);
    });
    envoyer(jeu.connexions[0], [...debut('G2'), ...fin('G2', [1, 0])]);
    await attendre(() => t.memoire().derniereActiviteA > avant, 'partie 2 terminee');
    assert.deepEqual(t.moments(), ['chauffe', 'overtime']);
    assert.deepEqual(t.compteurs, { chauffes: 1, overtimes: 1 });
    assert.ok(
      t.journal.some(([n, m]) => n === 'debug' && /Champs de Game : Teams, bOvertime, bHasWinner/.test(m)),
      'les champs de Game sont au journal, pour le support'
    );
  } finally {
    await instance?.arreter();
    t.couper();
    jeu.fermer();
  }
});

test('reglages coupes : rien a l ecran, mais la chauffe compte comme jouee', async () => {
  const jeu = await fauxJeu();
  const t = contexte({ config: { ...REGLAGES, chauffe: false, overtime: false }, portJeu: jeu.port });
  let instance;
  try {
    instance = await manifeste.demarrer(t.ctx);
    await attendre(() => jeu.connexions.length === 1, 'connexion au faux jeu');
    envoyer(jeu.connexions[0], [
      ...debut('G1'),
      ['UpdateState', image('G1', { overtime: true })],
      ...fin('G1', [3, 2]),
    ]);
    await attendre(() => {
      const e = t.ctx._etatMoments();
      return t.memoire()?.derniereActiviteA > 0 && !e.enChauffe && !e.enOvertime;
    }, 'partie vue jusqu’au bout');
    assert.deepEqual(t.moments(), []);
    assert.ok(t.etats.every(([, e]) => !e.pastilles.chauffe && !e.pastilles.overtime));
    // La rallumer en plein live n'annonce pas une chauffe a la partie suivante.
    const [sante] = await manifeste.sante(t.ctx);
    assert.equal(sante.detail, 'connecté');
  } finally {
    await instance?.arreter();
    t.couper();
    jeu.fermer();
  }
});

test('boutons : exemple complet, et rearmement', async () => {
  const jeu = await fauxJeu();
  const t = contexte({ config: { ...REGLAGES }, portJeu: jeu.port, minuteurManuel: true });
  let instance;
  try {
    instance = await manifeste.demarrer(t.ctx);
    const r = await manifeste.actions.exemple(t.ctx);
    assert.match(r.message, /Exemple en cours/);
    assert.deepEqual(t.moments(), ['chauffe']);
    assert.deepEqual(t.pastilles(), { chauffe: true, overtime: false });

    // Les etapes suivantes, dans l'ordre de leurs delais.
    for (const [, fn] of [...t.delais].sort((a, b) => a[0] - b[0])) fn();
    assert.deepEqual(t.moments(), ['chauffe', 'overtime']);
    assert.deepEqual(t.pastilles(), { chauffe: false, overtime: false }, 'tout revient a l’etat reel');
    assert.deepEqual(t.compteurs, {}, 'un exemple ne compte pas');

    await attendre(() => jeu.connexions.length === 1, 'connexion au faux jeu');
    envoyer(jeu.connexions[0], [...debut('G1'), ...fin('G1', [1, 0])]);
    await attendre(() => t.moments().filter((m) => m === 'chauffe').length === 2, 'vraie chauffe');

    // Juste apres une partie, la chauffe n'est plus armee... sauf a la main.
    const r2 = await manifeste.actions.rearmer(t.ctx);
    assert.match(r2.message, /prochaine partie/);
    assert.equal(t.memoire().rearme, true);
    envoyer(jeu.connexions[0], debut('G2'));
    await attendre(() => t.moments().filter((m) => m === 'chauffe').length === 3, 'chauffe rearmee');
  } finally {
    await instance?.arreter();
    t.couper();
    jeu.fermer();
  }
});

test('avec le compteur de session : une seule connexion, chacun son travail', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'rl-moments-'));
  const launchLog = join(dossier, 'Launch.log');
  writeFileSync(
    launchLog,
    [
      'Log: Log file open, 09/18/26 21:00:00',
      '[0024.61] SettingsExport: CreateSnapshot Metadata {"userId":"' + MOI + '","platformKey":"Epic"}',
      '[0169.11] Online: TryToPlayOnlineWithAntiCheat bIsRanked=(True) PlaylistId=(13)',
      '',
    ].join('\r\n')
  );
  const jeu = await fauxJeu();
  const moments = contexte({ config: { ...REGLAGES }, portJeu: jeu.port });
  const session = contexte({
    config: {
      filtre: 'classe',
      format: 'tous',
      sessionMode: 'launch',
      coin: 'top-left',
      pseudo: '',
      cheminLaunchLog: launchLog,
      port: jeu.port,
    },
  });
  let a;
  let b;
  try {
    a = await compteur.demarrer(session.ctx);
    b = await manifeste.demarrer(moments.ctx);
    await attendre(() => session.ctx._etatRL().connecte && moments.ctx._etatMoments().connecte, 'connectes');
    assert.equal(jeu.connexions.length, 1, 'une seule connexion au jeu pour les deux modules');

    envoyer(jeu.connexions[0], [...debut('G1'), ...fin('G1', [3, 1])]);
    await attendre(() => session.etats.at(-1)?.[1].session?.victoires === 1, 'victoire comptee');
    assert.deepEqual(moments.moments(), ['chauffe']);

    // Le compteur redemarre (un reglage change) : les moments ne perdent pas le jeu.
    await a.arreter();
    a = null;
    envoyer(jeu.connexions[0], [...debut('G2'), ['UpdateState', image('G2', { overtime: true })]]);
    await attendre(() => moments.moments().includes('overtime'), 'overtime vu seul');
    a = await compteur.demarrer(session.ctx);
    await attendre(() => session.ctx._etatRL().connecte, 'le compteur retrouve la connexion');
    assert.equal(jeu.connexions.length, 1, 'toujours la meme connexion');
  } finally {
    await a?.arreter();
    await b?.arreter();
    moments.couper();
    session.couper();
    jeu.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});
