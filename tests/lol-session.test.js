// Suivi de session LoL : les briques pures.
//
// Lecture d'une partie dans l'historique du client, calculs de session, regles
// d'affichage, mise en forme de l'overlay, table des champions. Rien ici ne
// demande League of Legends ni le reseau.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { extraireResultat, participation, trouverMoi, dureeSecondes, jeux } =
  await import('../src/modules/lol-session/partie.js');
const session = await import('../src/modules/lol-session/session.js');
const { construireVue, signe, duree, dureeSession } = await import('../src/modules/lol-session/vue.js');
const champions = await import('../src/modules/lol-session/champions.js');
const { dossierDepuisMetadonnees, lireLockfile, trouverDossier } =
  await import('../src/modules/lol-session/client.js');
const { sessionDemo, CHAMPIONS_DEMO } = await import('../src/modules/lol-session/demo.js');
const { depuisEchelle } = await import('../src/modules/lol-session/rang.js');

after(() => nettoyer(DONNEES));

const MOI = { puuid: 'puuid-moi', summonerId: 7, accountId: 9 };
const NNBSP = '\u202f';
const MOINS = '\u2212';

// Une partie telle que la liste de l'historique la donne : un seul joueur, moi.
function jeuListe({ id = 1, champion = 103, victoire = true, k = 8, d = 2, a = 11, remake = false } = {}) {
  return {
    gameId: id,
    queueId: 420,
    gameCreation: 1_700_000_000_000,
    gameDuration: 1862,
    participantIdentities: [{ participantId: 1, player: { puuid: MOI.puuid, summonerId: 7 } }],
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
          totalMinionsKilled: 200,
          neutralMinionsKilled: 14,
          visionScore: 31,
          gameEndedInEarlySurrender: remake,
        },
      },
    ],
  };
}

// Le detail : dix joueurs. Mon equipe fait 30 kills.
function detail() {
  const joueur = (participantId, teamId, kills, puuid = 'autre-' + participantId) => ({
    identite: { participantId, player: { puuid } },
    participant: { participantId, teamId, championId: 1, stats: { kills, assists: 3 } },
  });
  const tous = [
    joueur(1, 100, 8, MOI.puuid),
    joueur(2, 100, 10),
    joueur(3, 100, 5),
    joueur(4, 100, 4),
    joueur(5, 100, 3),
    joueur(6, 200, 9),
    joueur(7, 200, 2),
    joueur(8, 200, 1),
    joueur(9, 200, 0),
    joueur(10, 200, 4),
  ];
  // Les assists de mon joueur doivent etre les memes que dans la liste.
  tous[0].participant.stats.assists = 11;
  return {
    gameId: 1,
    participantIdentities: tous.map((j) => j.identite),
    participants: tous.map((j) => j.participant),
  };
}

// --- Lecture d'une partie ---------------------------------------------------

test('resultat lu dans la liste de l historique', () => {
  const r = extraireResultat(jeuListe(), MOI);
  assert.deepEqual(r, {
    id: 1,
    queueId: 420,
    championId: 103,
    victoire: true,
    remake: false,
    k: 8,
    d: 2,
    a: 11,
    cs: 214,
    dureeS: 1862,
    vision: 31,
    kp: null,
    finA: 1_700_000_000_000 + 1862 * 1000,
  });
});

test('participation aux eliminations calculee avec le detail des dix joueurs', () => {
  // (8 kills + 11 assists) / 30 kills de l'equipe = 63 %.
  assert.equal(participation(detail(), MOI), 63);
  assert.equal(extraireResultat(jeuListe(), MOI, detail()).kp, 63);
  // Sans detail exploitable : inconnue, pas zero.
  assert.equal(participation({ participants: [] }, MOI), null);
});

test('le joueur est reconnu par puuid, et a defaut par les anciens identifiants', () => {
  const d = detail();
  assert.equal(trouverMoi(d, MOI).participantId, 1);
  d.participantIdentities[0].player = { summonerId: 7 };
  assert.equal(trouverMoi(d, { summonerId: 7 }).participantId, 1);
  assert.equal(trouverMoi(d, { puuid: 'inconnu' }), null);
});

test('une partie refaite est reperee, une duree en millisecondes est corrigee', () => {
  assert.equal(extraireResultat(jeuListe({ remake: true }), MOI).remake, true);
  assert.equal(dureeSecondes({ gameDuration: 1862 }), 1862);
  assert.equal(dureeSecondes({ gameDuration: 1_862_000 }), 1862);
  assert.deepEqual(jeux({ games: { games: [jeuListe()] } }).length, 1);
  assert.deepEqual(jeux(null), []);
});

// --- Calculs de session -------------------------------------------------------

const partie = (finA, victoire, extra = {}) => ({
  id: finA,
  finA,
  victoire,
  championId: 103,
  k: 5,
  d: 5,
  a: 5,
  cs: 180,
  dureeS: 1800,
  vision: 30,
  kp: 50,
  lp: victoire ? 20 : -15,
  ...extra,
});

test('bilan : serie, pourcentage de victoires, somme des LP connus', () => {
  const joues = [partie(1, false), partie(2, true), partie(3, true, { lp: null }), partie(4, true)];
  const b = session.bilan(joues);
  assert.equal(b.victoires, 3);
  assert.equal(b.defaites, 1);
  assert.equal(b.winrate, 75);
  assert.equal(b.lp, 25, 'la partie sans LP connus ne compte pas');
  assert.equal(b.lpConnu, true);
  assert.deepEqual(b.serie, { victoire: true, n: 3 });
  assert.deepEqual(session.bilan([]).serie, null);
  assert.equal(session.bilan([]).winrate, null);
});

test('moyennes ponderees par la duree', () => {
  const m = session.moyennes([
    partie(1, true, { k: 10, d: 0, a: 10, cs: 300, dureeS: 1800, vision: 60, kp: 80 }),
    partie(2, false, { k: 0, d: 4, a: 2, cs: 100, dureeS: 1200, vision: 20, kp: null }),
  ]);
  assert.equal(m.kda, 22 / 4);
  assert.equal(m.csMin, 400 / 50);
  assert.equal(m.visionMin, 80 / 50);
  assert.equal(m.kp, 80, 'une participation inconnue ne tire pas la moyenne vers zero');
  assert.equal(session.moyennes([]), null);
});

test('meilleure partie : le KDA, puis les kills', () => {
  const a = partie(1, true, { k: 6, d: 1, a: 9 }); // 15
  const b = partie(2, true, { k: 11, d: 3, a: 7 }); // 6
  const c = partie(3, true, { k: 10, d: 1, a: 5 }); // 15 aussi, plus de kills
  assert.equal(session.meilleurePartie([a, b]), a);
  assert.equal(session.meilleurePartie([a, b, c]), c);
});

test('champions joues : le plus joue d abord, puis le plus gagnant', () => {
  const liste = session.championsJoues([
    partie(1, true, { championId: 134 }),
    partie(2, false, { championId: 61 }),
    partie(3, true, { championId: 103 }),
    partie(4, true, { championId: 103 }),
    partie(5, false, { championId: 134 }),
  ]);
  assert.deepEqual(
    liste.map((c) => [c.championId, c.parties, c.victoires, c.defaites]),
    [
      [103, 2, 2, 0],
      [134, 2, 1, 1],
      [61, 1, 0, 1],
    ]
  );
});

test('courbe des LP : point de depart, un point par partie, seuils franchis', () => {
  const r = (v) => depuisEchelle(v);
  const c = session.courbe([
    partie(1, true, { rangAvant: r(2176), rangApres: r(2202) }),
    partie(2, true, { rangAvant: null, rangApres: null }), // rattrapee : sautee
    partie(3, false, { rangAvant: r(2202), rangApres: r(2185) }),
  ]);
  assert.deepEqual(
    c.points.map((p) => [p.valeur, p.victoire]),
    [
      [2176, null],
      [2202, true],
      [2185, false],
    ]
  );
  assert.deepEqual(c.seuils, [{ valeur: 2200, nom: 'Émeraude II' }]);
  assert.equal(c.zone, 'Émeraude III');
  assert.equal(session.courbe([partie(1, true)]), null, 'sans rang connu, pas de courbe');
});

test('affichage : qui se montre selon le reglage et la phase du client', () => {
  const vis = (affichage, phase, nbParties = 2, clientOuvert = true) =>
    session.visibilite({ affichage, phase, clientOuvert, nbParties });

  // Les deux : bandeau en partie (selection comprise), tableau de bord entre.
  assert.deepEqual(vis('deux', 'InProgress'), { bandeau: true, tableau: false });
  assert.deepEqual(vis('deux', 'ChampSelect'), { bandeau: true, tableau: false });
  assert.deepEqual(vis('deux', 'EndOfGame'), { bandeau: false, tableau: true });
  assert.deepEqual(vis('deux', 'Lobby'), { bandeau: false, tableau: true });
  // Pas encore de partie : rien a recapituler, le bandeau reste.
  assert.deepEqual(vis('deux', 'Lobby', 0), { bandeau: true, tableau: false });

  assert.deepEqual(vis('bandeau', 'Lobby'), { bandeau: true, tableau: false });
  assert.deepEqual(vis('bandeau', 'InProgress'), { bandeau: true, tableau: false });

  assert.deepEqual(vis('tableau', 'InProgress'), { bandeau: false, tableau: false });
  assert.deepEqual(vis('tableau', 'ChampSelect'), { bandeau: false, tableau: false });
  assert.deepEqual(vis('tableau', 'EndOfGame'), { bandeau: false, tableau: true });

  // Client ferme : rien, quel que soit le reglage.
  for (const mode of ['deux', 'bandeau', 'tableau']) {
    assert.deepEqual(vis(mode, 'None', 3, false), { bandeau: false, tableau: false });
  }
});

test('debut de session : lancement, minuit, ou remise a zero plus recente', () => {
  const lanceA = new Date(2026, 8, 17, 20, 0).getTime();
  const maintenant = new Date(2026, 8, 17, 22, 0).getTime();
  const minuit = new Date(2026, 8, 17, 0, 0).getTime();
  assert.equal(session.debutSession({ mode: 'launch', lanceA, maintenant }), lanceA);
  assert.equal(session.debutSession({ mode: 'day', lanceA, maintenant }), minuit);
  assert.equal(session.debutSession({ mode: 'day', lanceA, reinitA: lanceA + 5, maintenant }), lanceA + 5);
});

test('historique : fenetre de session, doublons refuses, plafond', () => {
  const parties = [];
  assert.equal(session.ajouter(parties, partie(20, true)), true);
  assert.equal(session.ajouter(parties, partie(10, false)), true);
  assert.equal(session.ajouter(parties, partie(20, true)), false, 'meme partie deux fois');
  assert.deepEqual(
    session.dansLaSession(parties, 15).map((p) => p.finA),
    [20]
  );
  for (let i = 0; i < session.MAX_PARTIES + 5; i++) session.ajouter(parties, partie(100 + i, true));
  assert.equal(parties.length, session.MAX_PARTIES);
});

// --- Mise en forme ------------------------------------------------------------

const CONFIG = { affichage: 'deux', file: 'solo', coinBandeau: 'top-left', coinTableau: 'center' };
const CHAMPIONS = { version: '16.18.1', parId: CHAMPIONS_DEMO, chargeA: 0 };

test('la session d exemple donne exactement les chiffres de la maquette', () => {
  const demo = sessionDemo(Date.now());
  const v = construireVue({
    config: CONFIG,
    suivi: demo.suivi,
    parties: demo.parties,
    depuis: 0,
    champions: CHAMPIONS,
  });

  assert.equal(v.rang.nom, 'Émeraude II');
  assert.equal(v.rang.palier, 'emerald');
  assert.equal(v.rang.lp, '2 LP');
  assert.equal(v.rang.evolution, 'promu');
  assert.deepEqual(v.bilan.lp, { texte: '+61 LP', signe: 1 });
  assert.equal(v.bilan.winrate, '67' + NNBSP + '%');
  assert.deepEqual(v.bilan.serie, { type: 'V', n: 3, texte: '3 victoires' });

  const derniere = v.tableau.parties[0];
  assert.equal(derniere.nom, 'Syndra');
  assert.equal(derniere.icone, 'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Syndra.png');
  assert.equal(derniere.kda, '9 / 2 / 12');
  assert.equal(derniere.duree, '27:20');
  assert.equal(derniere.lp, '+26');
  assert.equal(v.tableau.parties[3].lp, MOINS + '18');
  assert.equal(v.tableau.champions[0].nom, 'Ahri');
  assert.equal(v.tableau.meilleure.ratio, 'KDA 15');
  assert.equal(v.tableau.moyennes.kda, '4,74');
  assert.equal(v.tableau.moyennes.csMin, '7,4');
  assert.equal(v.tableau.courbe.points.length, 7);
  assert.equal(v.tableau.courbe.fin, '2 LP');
  assert.deepEqual(v.visible, { bandeau: false, tableau: true }, 'fin de partie : le tableau de bord');
});

test('rangs particuliers : placements, Maitre, non classe', () => {
  const vue = (rang) =>
    construireVue({
      config: CONFIG,
      suivi: { clientOuvert: true, moi: {}, phase: 'Lobby', rang },
      parties: [],
      depuis: 0,
      champions: champions.VIDE,
    }).rang;

  const placements = vue({
    palier: '',
    division: '',
    lp: 0,
    provisoire: true,
    placementsRestants: 3,
    placementsTotal: 5,
  });
  assert.equal(placements.nom, 'Placements');
  assert.equal(placements.lp, '2/5');
  assert.equal(placements.progression, 0.4);

  const maitre = vue({ palier: 'MASTER', division: '', lp: 212 });
  assert.equal(maitre.nom, 'Maître');
  assert.equal(maitre.progression, null, 'pas de barre sans division');

  assert.equal(vue({ palier: '', division: '', lp: 0, provisoire: false }).nom, 'Non classé');
  assert.equal(vue(null).nom, '');
});

test('LP en attente, LP inconnus, client ferme', () => {
  const base = { clientOuvert: true, moi: {}, phase: 'EndOfGame', rang: null };
  const vue = (parties, suivi = base) =>
    construireVue({ config: CONFIG, suivi, parties, depuis: 0, champions: champions.VIDE });

  const attente = vue([partie(1, true, { lp: null, lpEnAttente: true })]);
  assert.equal(attente.bilan.lp.texte, '… LP');
  assert.equal(attente.tableau.parties[0].lp, '…');
  assert.equal(attente.tableau.parties[0].nom, 'Champion', 'champion inconnu sans table');
  assert.equal(attente.tableau.parties[0].icone, '');

  assert.equal(vue([partie(1, true, { lp: null })]).bilan.lp.texte, '— LP');
  assert.equal(vue([]).bilan.lp.texte, '0 LP');

  assert.deepEqual(vue([partie(1, true)], { ...base, clientOuvert: false }).visible, {
    bandeau: false,
    tableau: false,
  });
});

test('formats : signe, durees', () => {
  assert.equal(signe(26), '+26');
  assert.equal(signe(-18), MOINS + '18');
  assert.equal(signe(0), '0');
  assert.equal(duree(1640), '27:20');
  assert.equal(duree(65), '1:05');
  assert.equal(dureeSession(127 * 60_000), '2 h 07');
  assert.equal(dureeSession(45 * 60_000), '45 min');
});

// --- Champions (Data Dragon) --------------------------------------------------

function faussesReponses(table, appels) {
  return async (url) => {
    appels.push(url);
    if (!(url in table)) throw new Error('hors ligne');
    return { ok: true, status: 200, json: async () => table[url] };
  };
}

const VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const TABLE = 'https://ddragon.leagueoflegends.com/cdn/16.18.1/data/fr_FR/champion.json';

test('la table des champions vient de Data Dragon, en francais', async () => {
  const appels = [];
  const recuperer = faussesReponses(
    {
      [VERSIONS]: ['16.18.1', '16.17.1'],
      [TABLE]: {
        data: {
          MonkeyKing: { id: 'MonkeyKing', key: '62', name: 'Wukong' },
          Nunu: { id: 'Nunu', key: '20', name: 'Nunu et Willump' },
        },
      },
    },
    appels
  );
  const r = await champions.charger({ cache: null, maintenant: 1000, recuperer });
  assert.equal(r.rafraichi, true);
  assert.equal(r.erreur, '');
  assert.deepEqual(champions.infoChampion(r.donnees, 62), {
    nom: 'Wukong',
    icone: 'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/MonkeyKing.png',
    initiales: 'WU',
  });
  assert.equal(champions.infoChampion(r.donnees, 20).initiales, 'NU');

  // Cache frais : aucun appel reseau.
  appels.length = 0;
  const encore = await champions.charger({ cache: r.donnees, maintenant: 2000, recuperer });
  assert.equal(encore.rafraichi, false);
  assert.deepEqual(appels, []);
});

test('Data Dragon injoignable : le cache sert, et l erreur est dite', async () => {
  const cache = { version: '16.10.1', parId: { 103: { cle: 'Ahri', nom: 'Ahri' } }, chargeA: 0 };
  const r = await champions.charger({
    cache,
    maintenant: champions.DUREE_CACHE_MS + 1,
    recuperer: faussesReponses({}, []),
  });
  assert.equal(r.rafraichi, false);
  assert.equal(r.donnees, cache);
  assert.match(r.erreur, /hors ligne/);
  assert.equal(champions.initiales("Kai'Sa"), 'KA');
  assert.equal(champions.initiales(''), '?');
});

// --- Trouver le client --------------------------------------------------------

test('lockfile et dossier du jeu', () => {
  assert.deepEqual(lireLockfile('LeagueClient:21456:61234:abc_DEF-123:https'), {
    port: 61234,
    motDePasse: 'abc_DEF-123',
    protocole: 'https',
  });
  assert.equal(lireLockfile('LeagueClient:1:2:x:http').protocole, 'http');
  assert.equal(lireLockfile(''), null);
  assert.equal(lireLockfile('LeagueClient:1:pasunport:x:https'), null);

  assert.equal(
    dossierDepuisMetadonnees('foo: 1\nproduct_install_full_path: "D:/Jeux/Riot Games/League of Legends"\n'),
    'D:\\Jeux\\Riot Games\\League of Legends'
  );
  assert.equal(dossierDepuisMetadonnees('rien'), '');

  assert.equal(trouverDossier('  E:\\LoL  '), 'E:\\LoL', 'le reglage saisi l emporte');

  const programData = join(DONNEES, 'ProgramData');
  const meta = join(programData, 'Riot Games', 'Metadata', 'league_of_legends.live');
  mkdirSync(meta, { recursive: true });
  writeFileSync(
    join(meta, 'league_of_legends.live.product_settings.yaml'),
    'product_install_full_path: "F:/Riot Games/League of Legends"\r\n'
  );
  assert.equal(trouverDossier('', programData), 'F:\\Riot Games\\League of Legends');
  assert.equal(trouverDossier('', join(DONNEES, 'absent')), 'C:\\Riot Games\\League of Legends');
});
