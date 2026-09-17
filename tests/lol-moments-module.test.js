// Moments forts LoL, branches de bout en bout.
//
// Un faux jeu : un serveur HTTP local qui repond comme l'API de la partie
// (port 2999 du vrai jeu), et un faux Twitch qui note les messages et les clips.
// Le module est demarre avec un contexte de test : chaque « tic » est un tour
// d'une seconde, et les delais (clip differe, exemple) se declenchent a la main.
//
// Ce qui compte ici, c'est le RACCORD : lecture de la partie, aiguillage carte /
// annonce, message, un seul clip par combat, fin de partie, Twitch absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import manifeste from '../src/modules/lol-moments/module.js';
import { creerApi, PasDePartie } from '../src/modules/lol-moments/api.js';
import { REGLAGES } from '../src/modules/lol-moments/moments.js';

const joueur = (nom, cle, equipe) => ({
  riotId: nom + '#EUW',
  riotIdGameName: nom,
  riotIdTagLine: 'EUW',
  summonerName: nom + '#EUW',
  championName: cle,
  rawChampionName: 'game_character_displayname_' + cle,
  team: equipe,
});

const JOUEURS = [
  joueur('Pseudo', 'Ahri', 'ORDER'),
  joueur('Allie', 'Jinx', 'ORDER'),
  joueur('Rival1', 'Zed', 'CHAOS'),
  joueur('Rival2', 'LeeSin', 'CHAOS'),
  joueur('Rival3', 'Darius', 'CHAOS'),
  joueur('Rival4', 'Thresh', 'CHAOS'),
  joueur('Rival5', 'Lux', 'CHAOS'),
];

async function fauxJeu(t) {
  const etat = {
    enPartie: true, // false : le jeu a ferme son port
    chargement: false, // true : le service repond deja, mais en 404
    coupeJoueurs: false, // true : le jeu se ferme pendant la lecture des joueurs
    nom: 'Pseudo#EUW',
    joueurs: JOUEURS,
    temps: 30,
    evenements: [{ EventID: 0, EventName: 'GameStart', EventTime: 0.02 }],
  };
  const serveur = http.createServer((req, res) => {
    if (!etat.enPartie || (etat.coupeJoueurs && req.url === '/liveclientdata/playerlist')) {
      req.socket.destroy();
      return;
    }
    const json = (code, corps) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corps));
    };
    if (etat.chargement) return json(404, { errorCode: 'RESOURCE_NOT_FOUND' });
    if (req.url === '/liveclientdata/eventdata') return json(200, { Events: etat.evenements });
    if (req.url === '/liveclientdata/playerlist') return json(200, etat.joueurs);
    if (req.url === '/liveclientdata/activeplayername') return json(200, etat.nom);
    if (req.url === '/liveclientdata/gamestats')
      return json(200, { gameMode: 'CLASSIC', gameTime: etat.temps });
    return json(404, {});
  });
  await new Promise((r) => {
    serveur.listen(0, '127.0.0.1', r);
  });
  t.after(() => serveur.close());

  const ajouter = (e) => etat.evenements.push({ EventID: etat.evenements.length, ...e });
  return {
    etat,
    api: creerApi({ port: serveur.address().port, protocole: 'http' }),
    kill: (tueur, victime, temps) =>
      ajouter({
        EventName: 'ChampionKill',
        KillerName: tueur,
        VictimName: victime,
        Assisters: [],
        EventTime: temps,
      }),
    multi: (tueur, n, temps) =>
      ajouter({ EventName: 'Multikill', KillerName: tueur, KillStreak: n, EventTime: temps }),
    ajouter,
    nouvellePartie: () => {
      etat.enPartie = true;
      etat.temps = 20;
      etat.evenements = [{ EventID: 0, EventName: 'GameStart', EventTime: 0.02 }];
    },
  };
}

function fauxTwitch({ connecte = true } = {}) {
  const chat = [];
  const clips = [];
  return {
    chat,
    clips,
    broadcasterId: '12345',
    get api() {
      if (!connecte) throw new Error('Twitch non connecte (non demarre)');
      return {
        clips: {
          createClip: async (p) => {
            clips.push(p);
            return 'Clip' + clips.length;
          },
          getClipById: async (id) => ({ url: 'https://clips.twitch.tv/' + id, title: clips.at(-1).title }),
        },
      };
    },
    aLeDroit: (s) => connecte && ['chat:read', 'chat:edit', 'clips:edit'].includes(s),
    dire: (m) => {
      if (connecte) chat.push(m);
    },
  };
}

function contexte({ api, reglages = {}, twitch = fauxTwitch() }) {
  const diffusions = [];
  const journal = [];
  const compteurs = {};
  const intervalles = [];
  const delais = [];
  // Table des champions fraiche : le module ne va pas sur Data Dragon.
  let stocke = {
    champions: {
      version: '16.18.1',
      parId: {
        103: { cle: 'Ahri', nom: 'Ahri' },
        238: { cle: 'Zed', nom: 'Zed' },
        64: { cle: 'LeeSin', nom: 'Lee Sin' },
      },
      chargeA: Date.now(),
    },
  };
  const ctx = {
    config: {
      positionAnnonce: 'haut',
      positionCartes: 'sous-bandeau',
      ...Object.fromEntries(REGLAGES.map((r) => [r.cle, r.defaut])),
      ...reglages,
    },
    log: Object.fromEntries(
      ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => journal.push([n, m])])
    ),
    overlay: {
      etat: (vue, data) => diffusions.push(['etat', data]),
      diffuser: (vue, type, data) => diffusions.push([type, data]),
      url: (vue) => 'http://127.0.0.1:47455/overlay/lol-moments/' + vue,
    },
    compteur: { incr: (cle, n = 1) => (compteurs[cle] = (compteurs[cle] ?? 0) + n) },
    etat: {
      lire: (defaut) => stocke ?? defaut,
      sauver: (v) => (stocke = v),
    },
    minuteur: {
      intervalle: (fn, ms) => intervalles.push({ fn, ms }),
      delai: (fn, ms) => delais.push({ fn, ms }),
    },
    twitch,
    apiJeu: api,
    attenteLectureClipMs: 0,
  };
  return {
    ctx,
    twitch,
    journal,
    compteurs,
    delais,
    tic: async () => {
      for (const i of intervalles.filter((x) => x.ms === 1000)) await i.fn();
    },
    // Declenche les delais en attente (clip differe, sequence d'exemple).
    echeances: async () => {
      for (const d of delais.splice(0)) await d.fn();
    },
    moments: () => diffusions.filter(([type]) => type === 'moment').map(([, v]) => v),
    types: () => diffusions.map(([type]) => type),
    sante: async () => (await manifeste.sante(ctx))[0],
  };
}

test('une partie : cartes du double au quadra, annonce du penta, un seul clip', async (t) => {
  const fetchOrigine = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('le test ne doit pas sortir sur internet');
  };
  t.after(() => {
    globalThis.fetch = fetchOrigine;
  });

  const jeu = await fauxJeu(t);
  const c = contexte({ api: jeu.api });
  await manifeste.demarrer(c.ctx);
  assert.deepEqual(c.types(), ['etat'], 'le theme part des le demarrage');

  await c.tic();
  assert.deepEqual(await c.sante(), {
    id: 'lol-partie',
    nom: 'Partie de League of Legends',
    etat: 'ok',
    detail: 'en partie · Ahri',
    aide: '',
  });
  assert.equal(c.moments().length, 0);

  // Double kill : une carte, ni message ni clip (reglage par defaut).
  jeu.kill('Pseudo', 'Rival1', 1400);
  jeu.kill('Pseudo', 'Rival2', 1402);
  jeu.multi('Pseudo', 2, 1402);
  await c.tic();
  let v = c.moments().at(-1);
  assert.deepEqual([v.format, v.groupe, v.titre], ['carte', 'multikill', 'Double kill']);
  assert.deepEqual(
    v.victimes.map((x) => x.icone),
    [
      'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Zed.png',
      'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/LeeSin.png',
    ]
  );
  assert.deepEqual(c.twitch.chat, []);
  assert.equal(c.delais.length, 0);

  // Triple puis quadra : la carte monte en grade ; le quadra parle et prevoit un clip.
  jeu.kill('Pseudo', 'Rival3', 1404);
  jeu.multi('Pseudo', 3, 1404);
  await c.tic();
  jeu.kill('Pseudo', 'Rival4', 1406);
  jeu.multi('Pseudo', 4, 1406);
  await c.tic();
  assert.deepEqual(
    c.moments().map((x) => [x.format, x.titre]),
    [
      ['carte', 'Double kill'],
      ['carte', 'Triple kill'],
      ['carte', 'Quadra kill'],
    ]
  );
  assert.deepEqual(c.twitch.chat, ['⚔️ QUADRA KILL avec Ahri !']);
  assert.equal(c.delais.length, 1);

  // Le penta tombe avant le clip du quadra : annonce, message, et un seul clip.
  jeu.kill('Pseudo', 'Rival5', 1421);
  jeu.multi('Pseudo', 5, 1421);
  await c.tic();
  v = c.moments().at(-1);
  assert.deepEqual(
    [v.format, v.groupe, v.titre, v.detail],
    ['annonce', 'multikill', 'Pentakill', 'Ahri · 23:41']
  );
  assert.equal(c.twitch.chat.at(-1), '🔥 PENTAKILL avec Ahri à 23:41 !');

  await c.echeances();
  assert.deepEqual(
    c.twitch.clips.map((x) => x.title),
    ['Pentakill · Ahri · 23:41']
  );
  assert.equal(
    c.twitch.chat.at(-1),
    '✂️ Le clip « Pentakill · Ahri · 23:41 » : https://clips.twitch.tv/Clip1'
  );
  assert.equal(c.compteurs.clips, 1);
  assert.equal(c.compteurs.moments, 4);
  assert.equal((await c.sante()).detail, 'en partie · Ahri · 4 moment(s) fort(s)');

  // Fin de partie : l'overlay range ses cartes.
  jeu.etat.enPartie = false;
  await c.tic();
  assert.equal(c.types().at(-1), 'effacer');
  assert.equal((await c.sante()).detail, 'pas de partie en cours');
  assert.ok(c.journal.some(([, m]) => m === 'Partie terminée : 4 moment(s) fort(s).'));

  // Partie suivante : les numeros d'evenement repartent de zero.
  jeu.nouvellePartie();
  jeu.ajouter({ EventName: 'FirstBlood', Recipient: 'Pseudo', EventTime: 95 });
  jeu.kill('Pseudo', 'Rival1', 95);
  await c.tic();
  v = c.moments().at(-1);
  assert.deepEqual([v.format, v.titre, v.detail], ['carte', 'Premier sang', 'Sur Zed · 1:35']);
});

test('StreamKit lance en pleine partie : les vieux moments ne sont pas rejoues', async (t) => {
  const jeu = await fauxJeu(t);
  jeu.etat.temps = 900;
  jeu.kill('Pseudo', 'Rival1', 300);
  jeu.kill('Pseudo', 'Rival2', 301);
  jeu.multi('Pseudo', 2, 301);
  const c = contexte({ api: jeu.api });
  await manifeste.demarrer(c.ctx);
  await c.tic();
  assert.equal(c.moments().length, 0);
  assert.ok(c.journal.some(([, m]) => /Partie déjà commencée \(15:00\)/.test(m)));

  jeu.kill('Pseudo', 'Rival3', 905);
  jeu.kill('Pseudo', 'Rival4', 906);
  jeu.multi('Pseudo', 2, 906);
  await c.tic();
  assert.deepEqual(
    c.moments().map((x) => x.titre),
    ['Double kill']
  );
});

test('sans Twitch : l overlay suit, ni message ni clip, et rien ne plante', async (t) => {
  const jeu = await fauxJeu(t);
  const c = contexte({ api: jeu.api, twitch: fauxTwitch({ connecte: false }) });
  await manifeste.demarrer(c.ctx);
  await c.tic();
  jeu.ajouter({ EventName: 'BaronKill', Stolen: 'True', KillerName: 'Pseudo', EventTime: 1625 });
  await c.tic();
  assert.deepEqual(
    c.moments().map((x) => [x.format, x.titre]),
    [['annonce', 'Nashor volé']]
  );
  await c.echeances();
  assert.deepEqual(c.twitch.chat, []);
  assert.ok(c.journal.some(([, m]) => m === 'Pas de clip : Twitch n’est pas connecté.'));
});

test('moment ignore dans les reglages : la carte n arrive qu au triple', async (t) => {
  const jeu = await fauxJeu(t);
  const c = contexte({ api: jeu.api, reglages: { doubleKill: 'off', tripleKill: 'chat' } });
  await manifeste.demarrer(c.ctx);
  await c.tic();
  jeu.kill('Pseudo', 'Rival1', 500);
  jeu.kill('Pseudo', 'Rival2', 501);
  jeu.multi('Pseudo', 2, 501);
  jeu.kill('Pseudo', 'Rival3', 503);
  jeu.multi('Pseudo', 3, 503);
  await c.tic();
  assert.deepEqual(
    c.moments().map((x) => x.titre),
    ['Triple kill']
  );
  assert.deepEqual(c.twitch.chat, ['⚔️ TRIPLE KILL avec Ahri !']);
  assert.equal(c.delais.length, 0, 'pas de clip au niveau « chat »');
});

test('chargement puis partie regardee en spectateur : rien a annoncer', async (t) => {
  const jeu = await fauxJeu(t);
  jeu.etat.chargement = true;
  const c = contexte({ api: jeu.api });
  await manifeste.demarrer(c.ctx);
  await c.tic();
  assert.equal((await c.sante()).detail, 'partie en cours de chargement');

  jeu.etat.chargement = false;
  jeu.etat.nom = 'Quelqu’un#EUW';
  jeu.kill('Rival1', 'Allie', 200);
  await c.tic();
  assert.equal((await c.sante()).detail, 'partie regardée en spectateur');
  assert.equal(c.moments().length, 0);
});

test('le jeu se ferme pendant la lecture des joueurs : fin de partie, pas une erreur', async (t) => {
  const jeu = await fauxJeu(t);
  jeu.etat.coupeJoueurs = true;
  const c = contexte({ api: jeu.api });
  await manifeste.demarrer(c.ctx);
  await c.tic();
  assert.equal((await c.sante()).detail, 'pas de partie en cours');
  assert.equal(
    c.journal.filter(([niveau]) => niveau === 'warn').length,
    0,
    'rien d alarmant dans le journal'
  );
});

test('api de la partie : port ferme = pas de partie, 404 = chargement', async (t) => {
  // Un port qu'on vient de liberer : plus personne n'y ecoute.
  const libre = http.createServer();
  await new Promise((r) => {
    libre.listen(0, '127.0.0.1', r);
  });
  const port = libre.address().port;
  await new Promise((r) => {
    libre.close(r);
  });
  await assert.rejects(creerApi({ port, protocole: 'http' }).evenements(), PasDePartie);

  const jeu = await fauxJeu(t);
  jeu.etat.chargement = true;
  await assert.rejects(jeu.api.evenements(), (e) => e.status === 404);
  jeu.etat.chargement = false;
  assert.equal(await jeu.api.nomJoueurActif(), 'Pseudo#EUW');
  assert.equal((await jeu.api.joueurs()).length, 7);
});

test('exemple : la sequence passe a l ecran, rien dans le chat ni en clip', async (t) => {
  const jeu = await fauxJeu(t);
  jeu.etat.enPartie = false;
  const c = contexte({ api: jeu.api });
  await manifeste.demarrer(c.ctx);
  const r = await manifeste.actions.exemple(c.ctx);
  assert.match(r.message, /25 secondes/);
  await c.echeances();
  assert.deepEqual(
    c.moments().map((x) => x.titre),
    ['Premier sang', 'Double kill', 'Triple kill', 'Quadra kill', 'Pentakill', 'Nashor volé', 'Ace']
  );
  assert.equal(
    c.moments()[0].champion.icone,
    'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Ahri.png'
  );
  assert.deepEqual(c.twitch.chat, []);
  assert.deepEqual(c.twitch.clips, []);
});

test('module arrete : un message clair plutot qu un plantage', async () => {
  const ctx = {};
  assert.equal((await manifeste.actions.exemple(ctx)).ok, false);
  assert.deepEqual(await manifeste.sante(ctx), [
    {
      id: 'lol-partie',
      nom: 'Partie de League of Legends',
      etat: 'inactif',
      detail: 'module au repos',
      aide: '',
    },
  ]);
});
