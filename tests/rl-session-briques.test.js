// Compteur de session Rocket League : les briques, une par une.
//
// Ce qui se joue ici se joue en direct, devant le chat : une defaite comptee en
// victoire, un replay revu apres la partie qui ajoute un point, un match prive
// compte en classe. Chaque piege teste ci-dessous a ete observe sur le vrai jeu
// (par d'autres outils branches sur la meme API, ou sur les fichiers du PC).

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decouper, lireMessage, creerClient, abonner } from '../src/modules/rl-session/flux.js';
import { creerSuiviParties, trouverJoueur } from '../src/modules/rl-session/partie.js';
import { creerLecteur, creerSuiviFichier } from '../src/modules/rl-session/journal-jeu.js';
import { lireIni, activerIni, activerFichiers, etatApi } from '../src/modules/rl-session/installation.js';
import { accepter, ajouter, bilan, debutSession } from '../src/modules/rl-session/session.js';

// --- Flux : des objets JSON colles, sans separateur ------------------------------

test('decouper : plusieurs messages colles, et un message coupe en deux paquets', () => {
  const a = '{"Event":"MatchCreated","Data":{"MatchGuid":"G1"}}';
  const b = '{"Event":"MatchEnded","Data":{"WinnerTeamNum":0}}';
  const { messages, reste } = decouper(a + b + b.slice(0, 20));
  assert.deepEqual(messages, [a, b]);
  assert.equal(reste, b.slice(0, 20), 'le debut du 3e message attend la suite');
  assert.deepEqual(decouper(reste + b.slice(20)).messages, [b]);
});

test('decouper : accolades et guillemets echappes dans un pseudo ne coupent rien', () => {
  const m = '{"Event":"UpdateState","Data":{"Players":[{"Name":"}{ \\"le roi\\" {"}]}}';
  assert.deepEqual(decouper('\r\n  ' + m + '\n').messages, [m]);
  assert.equal(JSON.parse(m).Data.Players[0].Name, '}{ "le roi" {');
});

test('lireMessage : Data en chaine JSON (vrai jeu) ou en objet (doc), et rejet du bruit', () => {
  const enChaine = lireMessage(
    JSON.stringify({ Event: 'MatchEnded', Data: JSON.stringify({ WinnerTeamNum: 1 }) })
  );
  assert.deepEqual(enChaine, { evenement: 'MatchEnded', data: { WinnerTeamNum: 1 } });
  assert.deepEqual(lireMessage('{"Event":"MatchEnded","Data":{"WinnerTeamNum":0}}').data, {
    WinnerTeamNum: 0,
  });
  assert.equal(lireMessage('{"pas":"un evenement"}'), null);
  assert.equal(lireMessage('{casse'), null);
});

function serveurTcp() {
  return new Promise((resolve) => {
    const connexions = [];
    const serveur = net.createServer((s) => connexions.push(s));
    serveur.listen(0, '127.0.0.1', () => resolve({ serveur, connexions, port: serveur.address().port }));
  });
}

const attendre = async (condition, ms = 3000) => {
  const fin = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('delai depasse');
    await new Promise((r) => {
      setTimeout(r, 10);
    });
  }
};

test('client TCP : un accent coupe entre deux paquets arrive intact', async () => {
  const { serveur, connexions, port } = await serveurTcp();
  const recus = [];
  const client = creerClient({ port, surMessage: (m) => recus.push(m), planifier: () => {} });
  client.demarrer();
  await attendre(() => connexions.length === 1 && client.estConnecte());

  const octets = Buffer.from('{"Event":"GoalScored","Data":{"Scorer":{"Name":"Élodie"}}}', 'utf8');
  const coupure = octets.indexOf(0xc3) + 1; // au milieu du « É »
  connexions[0].write(octets.subarray(0, coupure));
  await new Promise((r) => {
    setTimeout(r, 30);
  });
  connexions[0].write(octets.subarray(coupure));

  await attendre(() => recus.length === 1);
  assert.equal(recus[0].data.Scorer.Name, 'Élodie');
  client.arreter();
  serveur.close();
});

test('client TCP : jeu ferme puis relance -> reconnexion automatique', async () => {
  const { serveur, connexions, port } = await serveurTcp();
  const etats = [];
  const client = creerClient({
    port,
    surMessage: () => {},
    surEtat: (c) => etats.push(c),
    planifier: (fn) => setTimeout(fn, 20),
  });
  client.demarrer();
  await attendre(() => client.estConnecte());

  connexions[0].destroy(); // le jeu quitte
  await attendre(() => etats.includes(false));
  await attendre(() => connexions.length === 2 && client.estConnecte());
  assert.deepEqual(etats, [true, false, true]);
  client.arreter();
  serveur.close();
});

// Le compteur et les moments forts ecoutent le meme jeu : une connexion pour
// deux, et le bug de l'un ne prive pas l'autre de ses messages.
test('connexion partagee : un seul client pour deux modules, qui recoivent tout', async () => {
  const { serveur, connexions, port } = await serveurTcp();
  const envoyer = (Event, Data) => connexions[0].write(JSON.stringify({ Event, Data: JSON.stringify(Data) }));
  const recus = { a: [], b: [] };
  const etats = { a: [], b: [] };
  const a = abonner({ port, surMessage: (m) => recus.a.push(m.evenement), surEtat: (c) => etats.a.push(c) });
  await attendre(() => etats.a.includes(true));

  const erreurs = [];
  const b = abonner({
    port,
    surMessage: (m) => {
      recus.b.push(m.evenement);
      throw new Error('bug du second module');
    },
    surEtat: (c) => etats.b.push(c),
    surErreur: (e) => erreurs.push(e.message),
  });
  await attendre(() => etats.b.includes(true)); // la connexion etait deja ouverte
  assert.equal(connexions.length, 1, 'une seule connexion au jeu');

  envoyer('GoalScored', { Scorer: { Name: 'Élodie' } });
  await attendre(() => recus.a.length === 1 && recus.b.length === 1);
  assert.deepEqual(erreurs, ['bug du second module'], 'l’exception revient a son module');

  b.arreter();
  envoyer('MatchEnded', { WinnerTeamNum: 1 });
  await attendre(() => recus.a.length === 2);
  assert.equal(recus.b.length, 1, 'le second ne recoit plus rien');
  assert.equal(a.estConnecte(), true);

  const fermee = new Promise((ok) => {
    connexions[0].once('close', ok);
  });
  a.arreter();
  await fermee; // le dernier desabonnement ferme la connexion
  serveur.close();
});

// --- Parties : du flux d'evenements au resultat -----------------------------------

const MOI = 'Epic|84d786aaaaaaaaaaaaaaaaaaaaaaaaaa|0';

function monter({ playlists = [13], primaryId = MOI, pseudo = '' } = {}) {
  const resultats = [];
  const ignorees = [];
  let courante = playlists[0];
  const suivi = creerSuiviParties({
    identite: () => ({ primaryId, pseudo }),
    playlist: () => courante,
    surResultat: (r) => resultats.push(r),
    surIgnoree: (r) => ignorees.push(r),
  });
  const envoyer = (evenement, data = {}) => suivi.recevoir({ evenement, data });
  return { suivi, envoyer, resultats, ignorees, changerPlaylist: (p) => (courante = p) };
}

// Image de jeu : moi dans l'equipe `equipe`, score [bleu, orange].
const image = ({
  guid = 'G1',
  equipe = 0,
  score = [0, 0],
  gagnant = false,
  pseudo = 'AceOfSpade26',
} = {}) => ({
  MatchGuid: guid,
  Players: [
    { Name: pseudo, PrimaryId: MOI, TeamNum: equipe },
    { Name: 'Coequipier', PrimaryId: 'Steam|1|0', TeamNum: equipe },
    { Name: 'Adversaire', PrimaryId: 'Steam|2|0', TeamNum: 1 - equipe },
    { Name: 'Adversaire 2', PrimaryId: 'Steam|3|0', TeamNum: 1 - equipe },
  ],
  Game: {
    Teams: [
      { TeamNum: 0, Score: score[0] },
      { TeamNum: 1, Score: score[1] },
    ],
    bHasWinner: gagnant,
  },
});

test('victoire et defaite se lisent a l equipe du joueur, pas a la couleur', () => {
  const { envoyer, resultats } = monter();
  envoyer('MatchCreated', { MatchGuid: 'G1' });
  envoyer('UpdateState', image({ equipe: 1, score: [1, 3] }));
  envoyer('MatchEnded', { MatchGuid: 'G1', WinnerTeamNum: 1 });
  assert.equal(resultats[0].victoire, true, 'orange gagne, et je suis orange');
  assert.equal(resultats[0].taille, 2);
  assert.equal(resultats[0].playlist, 13);

  envoyer('MatchDestroyed');
  envoyer('MatchCreated', { MatchGuid: 'G2' });
  envoyer('UpdateState', image({ guid: 'G2', equipe: 1 }));
  envoyer('MatchEnded', { MatchGuid: 'G2', WinnerTeamNum: 0 });
  assert.equal(resultats[1].victoire, false);
});

test('un replay revu depuis l historique ne compte jamais', () => {
  const { envoyer, resultats } = monter();
  envoyer('ReplayCreated');
  envoyer('MatchCreated', { MatchGuid: 'G1' });
  envoyer('UpdateState', image({ score: [3, 0] }));
  envoyer('MatchEnded', { WinnerTeamNum: 0 });
  assert.equal(resultats.length, 0);

  envoyer('MatchDestroyed'); // sortie du replay : la suite compte de nouveau
  envoyer('MatchCreated', { MatchGuid: 'G9' });
  envoyer('UpdateState', image({ guid: 'G9' }));
  envoyer('MatchEnded', { WinnerTeamNum: 0 });
  assert.equal(resultats.length, 1);
});

test('lobby annule : MatchEnded sans aucune image ne compte pas', () => {
  const { envoyer, resultats, ignorees } = monter();
  envoyer('MatchCreated', { MatchGuid: 'G1' });
  envoyer('MatchEnded', { WinnerTeamNum: 1 });
  assert.equal(resultats.length, 0);
  assert.match(ignorees[0], /equipe/);
});

test('MatchEnded sans vainqueur : tranche au score, mais jamais sur une egalite', () => {
  const a = monter();
  a.envoyer('MatchCreated', { MatchGuid: 'G1' });
  a.envoyer('UpdateState', image({ score: [2, 1] }));
  a.envoyer('MatchEnded', {});
  assert.equal(a.resultats[0].victoire, true);
  assert.equal(a.resultats[0].source, 'score');

  const b = monter();
  b.envoyer('MatchCreated', { MatchGuid: 'G1' });
  b.envoyer('UpdateState', image({ score: [1, 1] }));
  b.envoyer('MatchEnded', { WinnerTeamNum: -1 });
  assert.equal(b.resultats.length, 0);
});

test('les images du podium n ouvrent pas une nouvelle partie', () => {
  const { envoyer, resultats } = monter();
  envoyer('MatchCreated', { MatchGuid: 'G1' });
  envoyer('UpdateState', image());
  envoyer('MatchEnded', { WinnerTeamNum: 0 });
  for (let i = 0; i < 5; i++) envoyer('UpdateState', image({ gagnant: true }));
  envoyer('MatchEnded', { WinnerTeamNum: 0 }); // rejoue
  assert.equal(resultats.length, 1);
});

test('quitter avant la fin ne donne aucun resultat, meme en menant', () => {
  const { envoyer, resultats, ignorees } = monter();
  envoyer('MatchCreated', { MatchGuid: 'G1' });
  envoyer('UpdateState', image({ score: [4, 0] }));
  envoyer('MatchDestroyed');
  assert.equal(resultats.length, 0);
  assert.match(ignorees[0], /quittee/);
});

test('StreamKit lance en pleine partie : la premiere image ouvre la partie', () => {
  const { envoyer, resultats } = monter();
  envoyer('UpdateState', image({ score: [0, 1] }));
  envoyer('MatchEnded', { WinnerTeamNum: 1 });
  assert.equal(resultats[0].victoire, false);
});

test('la playlist est celle du DEBUT de partie', () => {
  const { envoyer, resultats, changerPlaylist } = monter({ playlists: [13] });
  envoyer('MatchCreated', { MatchGuid: 'G1' });
  changerPlaylist(null); // « Match Ended » lu dans Launch.log avant l'evenement de l'API
  envoyer('UpdateState', image());
  envoyer('MatchEnded', { WinnerTeamNum: 0 });
  assert.equal(resultats[0].playlist, 13);
});

test('MatchInitialized apres MatchCreated garde ce qu on sait deja', () => {
  const { envoyer, resultats } = monter();
  envoyer('MatchCreated', { MatchGuid: 'G1' });
  envoyer('UpdateState', image({ equipe: 1 }));
  envoyer('MatchInitialized', { MatchGuid: 'G1' });
  envoyer('MatchEnded', { WinnerTeamNum: 1 });
  assert.equal(resultats[0].victoire, true);
});

test('joueur reconnu par identifiant de plateforme, sinon par pseudo', () => {
  const joueurs = image().Players;
  assert.equal(trouverJoueur(joueurs, { primaryId: MOI }).Name, 'AceOfSpade26');
  assert.equal(
    trouverJoueur(joueurs, { primaryId: 'Epic|autre|0', pseudo: 'aceofspade26' }).Name,
    'AceOfSpade26'
  );
  assert.equal(trouverJoueur(joueurs, {}), null);
  // Un pseudo qui ressemble ne suffit pas.
  assert.equal(trouverJoueur(joueurs, { pseudo: 'AceOfSpade' }), null);
});

// --- Launch.log -----------------------------------------------------------------

// Lignes reelles (septembre 2026), jeton de reconnexion retire.
const LIGNES = {
  identite:
    '[0024.61] SettingsExport: CreateSnapshot Metadata {"userId":"' +
    MOI +
    '","platformKey":"Epic","schemaVersion":2,"clientVersion":1532151}',
  file: '[0169.11] Online: TryToPlayOnlineWithAntiCheat bIsRanked=(True) PlaylistId=(13)',
  reservation:
    '[0305.22] RankedReconnect: RankedReconnectSave_TA_0.SetRankedReconnect() Server=((Reservation=(ServerName="EU7-0e69fc9a-Hydyne",Playlist=11,Region="EU",ReservationID="D60F52538BC347479AFF1B9116513617"',
  fin: '[0572.42] ScriptLog: Match Ended - [Reservation: , MatchID: ]',
};

test('Launch.log : identite, playlist de la file et de la reservation, fin de partie', () => {
  const l = creerLecteur();
  l.ligne(LIGNES.identite);
  l.ligne(LIGNES.file);
  assert.equal(l.etat.primaryId, MOI);
  assert.equal(l.etat.playlist, 13);
  l.ligne(LIGNES.reservation);
  assert.equal(l.etat.playlist, 11);
  l.ligne(LIGNES.fin);
  assert.equal(l.etat.playlist, null, 'un match prive lance ensuite ne doit pas heriter du classe');
});

test('suivi du fichier : lecture par morceaux et ligne en cours d ecriture', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'rl-log-'));
  const chemin = join(dossier, 'Launch.log');
  const lignes = [];
  const suivi = creerSuiviFichier(chemin, (l) => lignes.push(l));
  try {
    assert.equal(suivi.lire(), false, 'fichier absent');
    writeFileSync(chemin, 'Log: Log file open, 09/14/26 21:00:00\r\n' + LIGNES.file.slice(0, 30));
    suivi.lire();
    assert.equal(lignes.length, 1, 'la ligne incomplete attend');
    appendFileSync(chemin, LIGNES.file.slice(30) + '\r\n');
    suivi.lire();
    assert.deepEqual(lignes.slice(1), [LIGNES.file]);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('suivi du fichier : un nouveau lancement du jeu est relu depuis le debut, meme plus long', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'rl-log-'));
  const chemin = join(dossier, 'Launch.log');
  const lignes = [];
  const suivi = creerSuiviFichier(chemin, (l) => lignes.push(l));
  try {
    writeFileSync(chemin, 'Log: Log file open, 09/14/26 21:00:00\r\n' + LIGNES.file + '\r\n');
    suivi.lire();
    // Le jeu relance : journal remplace, DEJA plus long que l'ancien quand on
    // le relit (le cas que la taille seule ne verrait pas).
    const neuf = 'Log: Log file open, 09/14/26 23:30:00\r\n' + (LIGNES.identite + '\r\n').repeat(3);
    writeFileSync(chemin, neuf);
    lignes.length = 0;
    suivi.lire();
    assert.equal(lignes[0], 'Log: Log file open, 09/14/26 23:30:00');
    assert.equal(lignes.length, 4);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

// --- DefaultStatsAPI.ini ------------------------------------------------------------

// Le fichier tel que livre avec le jeu (installation Epic, septembre 2026).
const INI_LIVRE = [
  '[TAGame.MatchStatsExporter_TA]',
  '',
  '; Port the client will listen for tcp connections on (must be different than WebPort, set to 0 to disable)',
  'Port=49123',
  '',
  '; Port the client will listen for web connections on (must be different than Port, set to 0 to disable)',
  'WebPort=49124',
  '',
  '; How many times per second the game sends the update state (capped at 120, 0 disables this feature)',
  'PacketSendRate=0',
  '',
].join('\r\n');

test('ini livre : API eteinte, port 49123', () => {
  assert.deepEqual(lireIni(INI_LIVRE), { port: 49123, taux: 0 });
});

test('activer : seule la ligne PacketSendRate change, commentaires et fins de ligne intacts', () => {
  const { texte, change } = activerIni(INI_LIVRE);
  assert.equal(change, true);
  assert.equal(lireIni(texte).taux, 30);
  assert.equal(texte, INI_LIVRE.replace('PacketSendRate=0', 'PacketSendRate=30'));
});

test('activer : un reglage deja actif n est jamais baisse', () => {
  const autre = INI_LIVRE.replace('PacketSendRate=0', 'PacketSendRate=60');
  assert.deepEqual(activerIni(autre), { texte: autre, change: false });
});

test('activer : ligne ou section absentes', () => {
  assert.equal(lireIni(activerIni('[TAGame.MatchStatsExporter_TA]\nPort=50000\n').texte).taux, 30);
  assert.equal(lireIni(activerIni('[TAGame.MatchStatsExporter_TA]\nPort=50000\n').texte).port, 50000);
  const vide = activerIni('');
  assert.deepEqual(lireIni(vide.texte), { port: 49123, taux: 30 });
});

test('activerFichiers : sauvegarde .bak a la premiere modification seulement', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'rl-ini-'));
  const f = join(dossier, 'DefaultStatsAPI.ini');
  try {
    writeFileSync(f, INI_LIVRE);
    assert.equal(etatApi([f]).active, false);
    assert.deepEqual(activerFichiers([f, join(dossier, 'absent.ini')]), [
      { fichier: f, ok: true, change: true },
    ]);
    assert.equal(readFileSync(f + '.bak', 'utf8'), INI_LIVRE, 'la sauvegarde garde l original');
    assert.equal(etatApi([f]).active, true);

    assert.deepEqual(activerFichiers([f]), [{ fichier: f, ok: true, change: false }]);
    assert.equal(readFileSync(f + '.bak', 'utf8'), INI_LIVRE);
    assert.ok(existsSync(f));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

// --- Session ----------------------------------------------------------------------

test('filtre : classe seulement ecarte non classe, prive et playlist inconnue', () => {
  const r = (playlist, extra = {}) => ({ victoire: true, guid: 'G', playlist, taille: 3, ...extra });
  assert.equal(accepter(r(13)).ok, true);
  assert.equal(accepter(r(10)).ok, true);
  assert.match(accepter(r(3)).raison, /non classée/);
  assert.equal(accepter(r(6)).ok, false);
  assert.match(accepter(r(null)).raison, /inconnue/);

  assert.equal(accepter(r(3), { filtre: 'enligne' }).ok, true);
  assert.equal(accepter(r(6), { filtre: 'enligne' }).ok, false, 'match prive');
  assert.equal(accepter(r(null), { filtre: 'toutes' }).ok, true);
  assert.equal(accepter(r(null, { guid: null }), { filtre: 'toutes' }).ok, false, 'hors ligne');

  assert.equal(accepter(r(10), { format: '1' }).ok, true);
  assert.match(accepter(r(13), { format: '1' }).raison, /3v3/);
});

test('bilan : victoires, defaites et serie en cours', () => {
  const h = [];
  const t0 = 1_000_000;
  [true, false, true, true, true].forEach((v, i) => ajouter(h, { victoire: v, playlist: 13 }, t0 + i));
  const b = bilan(h, t0);
  assert.deepEqual([b.victoires, b.defaites, b.serie], [4, 1, { victoire: true, n: 3 }]);

  ajouter(h, { victoire: false, playlist: 11 }, t0 + 9);
  assert.deepEqual(bilan(h, t0).serie, { victoire: false, n: 1 });

  assert.deepEqual(bilan(h, t0 + 100), {
    victoires: 0,
    defaites: 0,
    parties: 0,
    serie: null,
    depuis: t0 + 100,
  });
});

test('debut de session : lancement, minuit, et remise a zero manuelle', () => {
  const maintenant = new Date('2026-09-14T22:30:00').getTime();
  const lanceA = new Date('2026-09-14T20:00:00').getTime();
  assert.equal(debutSession({ mode: 'launch', lanceA, maintenant }), lanceA);
  assert.equal(debutSession({ mode: 'day', lanceA, maintenant }), new Date('2026-09-14T00:00:00').getTime());
  const reinitA = new Date('2026-09-14T21:00:00').getTime();
  assert.equal(debutSession({ mode: 'launch', lanceA, reinitA, maintenant }), reinitA);
});
