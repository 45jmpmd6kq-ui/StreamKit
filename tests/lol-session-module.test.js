// Suivi de session LoL, branche de bout en bout.
//
// Un faux client League of Legends : un serveur HTTP local qui repond comme
// l'API du vrai client (avec son mot de passe), et un lockfile ecrit dans un
// dossier de jeu jetable. Le module est demarre avec un contexte de test dont
// on actionne les minuteurs a la main : chaque « tic » est un tour de 2 secondes,
// joue instantanement.
//
// Le deroule d'une partie tour par tour (LP, remakes, rattrapage) est dans
// lol-suivi.test.js ; ici, on verifie que tout est bien RACCORDE : lockfile,
// authentification, overlay, compteurs, vue d'ensemble, bouton d'exemple.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import manifeste from '../src/modules/lol-session/module.js';

const MOT_DE_PASSE = 'secret-du-client';

function fauxClientLoL() {
  const etat = {
    phase: 'None',
    session: null,
    rang: { tier: 'EMERALD', division: 'III', leaguePoints: 41 },
    jeux: [],
  };
  const serveur = http.createServer((req, res) => {
    const json = (code, corps) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corps ?? {}));
    };
    const attendu = 'Basic ' + Buffer.from('riot:' + MOT_DE_PASSE).toString('base64');
    if (req.headers.authorization !== attendu) return json(401, { message: 'mauvais mot de passe' });

    const chemin = req.url.split('?')[0];
    if (chemin === '/lol-gameflow/v1/gameflow-phase') return json(200, etat.phase);
    if (chemin === '/lol-gameflow/v1/session') return etat.session ? json(200, etat.session) : json(404);
    if (chemin === '/lol-summoner/v1/current-summoner') {
      // Pseudo accentue : il doit survivre au decodage de la reponse.
      return json(200, { puuid: 'puuid-moi', summonerId: 7, gameName: 'Pséudo', tagLine: 'EUW' });
    }
    if (chemin === '/lol-ranked/v1/current-ranked-stats') {
      return json(200, { queueMap: { RANKED_SOLO_5x5: { queueType: 'RANKED_SOLO_5x5', ...etat.rang } } });
    }
    if (chemin === '/lol-match-history/v1/products/lol/current-summoner/matches') {
      return json(200, { games: { games: etat.jeux } });
    }
    return json(404);
  });
  return { etat, serveur };
}

const jeuGagne = (gameId) => ({
  gameId,
  queueId: 420,
  gameCreation: Date.now() - 1800 * 1000,
  gameDuration: 1800,
  participantIdentities: [{ participantId: 1, player: { puuid: 'puuid-moi' } }],
  participants: [
    {
      participantId: 1,
      championId: 103,
      teamId: 100,
      stats: {
        win: true,
        kills: 6,
        deaths: 2,
        assists: 8,
        totalMinionsKilled: 200,
        neutralMinionsKilled: 10,
        visionScore: 30,
      },
    },
  ],
});

function contexte({ dossierJeu, memoire = null, reglages = {} }) {
  const etats = [];
  const journal = [];
  const compteurs = {};
  const intervalles = [];
  // Table des champions fraiche : le module ne va pas sur Data Dragon.
  let stocke = memoire ?? {
    parties: [],
    reinitA: 0,
    champions: { version: '16.18.1', parId: { 103: { cle: 'Ahri', nom: 'Ahri' } }, chargeA: Date.now() },
  };
  const ctx = {
    config: {
      bandeau: 'partie',
      file: 'solo',
      sessionMode: 'launch',
      dossierJeu,
      ...reglages,
    },
    log: Object.fromEntries(
      ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => journal.push([n, m])])
    ),
    overlay: {
      etat: (vue, data) => etats.push([vue, data]),
      url: (vue) => 'http://127.0.0.1:47455/overlay/lol-session/' + vue,
    },
    compteur: { incr: (cle, n = 1) => (compteurs[cle] = (compteurs[cle] ?? 0) + n) },
    etat: {
      lire: (defaut) => stocke ?? defaut,
      sauver: (v) => (stocke = JSON.parse(JSON.stringify(v))),
    },
    minuteur: {
      intervalle: (fn, ms) => intervalles.push({ fn, ms }),
      delai: () => {},
    },
  };
  const tic = async () => {
    for (const i of intervalles.filter((x) => x.ms === 2000)) await i.fn();
  };
  return { ctx, etats, journal, compteurs, tic, vue: () => etats.at(-1)?.[1], stocke: () => stocke };
}

test('une partie gagnee, de la file d attente au tableau de bord', async (t) => {
  const fetchOrigine = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('le test ne doit pas sortir sur internet');
  };
  const dossierJeu = mkdtempSync(join(tmpdir(), 'lol-module-'));
  const { etat, serveur } = fauxClientLoL();
  await new Promise((r) => {
    serveur.listen(0, '127.0.0.1', r);
  });
  t.after(() => {
    globalThis.fetch = fetchOrigine;
    serveur.close();
    rmSync(dossierJeu, { recursive: true, force: true });
  });
  const lockfile = join(dossierJeu, 'lockfile');
  writeFileSync(lockfile, 'LeagueClient:4242:' + serveur.address().port + ':' + MOT_DE_PASSE + ':http');

  const c = contexte({ dossierJeu });
  const instance = await manifeste.demarrer(c.ctx);
  assert.deepEqual(c.vue().visible, { bandeau: false, tableau: false }, 'rien avant le premier tour');

  // Client ouvert, dans le salon : le bandeau, avec le rang.
  await c.tic();
  assert.deepEqual(c.vue().visible, { bandeau: true, tableau: false });
  assert.equal(c.vue().rang.nom, 'Émeraude III');
  assert.equal(c.vue().rang.lp, '41 LP');
  const [sante] = await manifeste.sante(c.ctx);
  assert.equal(sante.etat, 'ok');
  assert.equal(sante.detail, 'Pséudo#EUW · Émeraude III · 0 V / 0 D');

  // En partie : toujours le bandeau.
  etat.phase = 'InProgress';
  etat.session = { gameData: { gameId: 555, queue: { id: 420 } } };
  await c.tic();
  assert.deepEqual(c.vue().visible, { bandeau: true, tableau: false });

  // Ecran de fin, partie dans l'historique : comptee, tableau de bord.
  etat.phase = 'EndOfGame';
  etat.session = null;
  etat.jeux = [jeuGagne(555)];
  await c.tic();
  const v = c.vue();
  assert.deepEqual(v.visible, { bandeau: false, tableau: true });
  assert.equal(v.bilan.victoires, 1);
  assert.equal(v.bilan.serie.texte, '1 victoire');
  assert.equal(v.bilan.serie.type, '', 'une victoire seule n est pas une serie : ni flamme ni couleur');
  assert.equal(v.tableau.parties[0].nom, 'Ahri');
  assert.equal(v.tableau.parties[0].lp, '…', 'LP pas encore publies');
  assert.equal(c.compteurs.victoires, 1);
  assert.ok(c.journal.some(([, m]) => m === 'Victoire (6/2/8) — comptée.'));

  // Chaque changement part aux deux sources, et a l'ancienne source unique
  // pour qui l'a encore dans OBS : le meme etat, chaque page n'en montre que
  // sa part.
  const dernier = c.etats.slice(-3);
  assert.deepEqual(
    dernier.map(([vue]) => vue),
    ['bandeau', 'tableau', 'session']
  );
  assert.ok(dernier.every(([, data]) => data === v));

  // Un tour sans changement ne renvoie rien a l'overlay.
  const envois = c.etats.length;
  await c.tic();
  assert.equal(c.etats.length, envois);

  // Client ferme : plus rien a l'ecran, carte « inactif ».
  rmSync(lockfile);
  await c.tic();
  assert.deepEqual(c.vue().visible, { bandeau: false, tableau: false });
  const [fermee] = await manifeste.sante(c.ctx);
  assert.equal(fermee.etat, 'inactif');
  assert.equal(fermee.detail, 'client fermé');

  // Le bouton d'exemple montre les deux, meme client ferme.
  const r = await manifeste.actions.exemple(c.ctx);
  assert.match(r.message, /30 secondes/);
  assert.deepEqual(c.vue().visible, { bandeau: true, tableau: true });
  assert.match(c.vue().tableau.sousTitre, /6 parties/);

  await instance.arreter();
  assert.equal(c.stocke().parties.length, 1);

  // Redemarrage en mode « lancement » : nouvelle session, l'ancienne partie
  // n'y figure plus.
  const c2 = contexte({ dossierJeu, memoire: JSON.parse(JSON.stringify(c.stocke())) });
  await manifeste.demarrer(c2.ctx);
  assert.equal(c2.vue().tableau.parties.length, 0);

  // En mode « journee », elle y est toujours -- et ses LP, attendus au moment de
  // l'arret, ne viendront plus : inconnus plutot qu'en attente pour toujours.
  const c3 = contexte({
    dossierJeu,
    memoire: JSON.parse(JSON.stringify(c.stocke())),
    reglages: { sessionMode: 'day' },
  });
  await manifeste.demarrer(c3.ctx);
  assert.equal(c3.vue().tableau.parties[0].lp, '—');
});

test('jeu introuvable : la vue d ensemble dit ou regler le dossier', async () => {
  const c = contexte({ dossierJeu: join(tmpdir(), 'lol-dossier-qui-n-existe-pas') });
  await manifeste.demarrer(c.ctx);
  await c.tic();
  const [carte] = await manifeste.sante(c.ctx);
  assert.equal(carte.etat, 'attention');
  assert.equal(carte.detail, 'League of Legends introuvable');
});

test('actions module arrete : un message clair plutot qu un plantage', async () => {
  const ctx = {};
  assert.equal((await manifeste.actions.exemple(ctx)).ok, false);
  assert.equal((await manifeste.actions.reinitialiserSession(ctx)).ok, false);
  assert.deepEqual(await manifeste.sante(ctx), [
    { id: 'lol', nom: 'League of Legends', etat: 'inactif', detail: 'module au repos', aide: '' },
  ]);
});
