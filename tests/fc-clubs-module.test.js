// Soiree Clubs FC 27, branchee de bout en bout.
//
// Un faux EA : globalThis.fetch remplace par un routeur qui repond comme
// proclubs.ea.com (recherche, matchs par type, statistiques). Hors d'Electron,
// le module passe par le fetch de Node : c'est lui qu'on intercepte. Le module
// est demarre avec un contexte de test ; son premier tour part tout seul, les
// suivants se jouent a la main.
//
// Le detail des calculs (soiree, serie, trophees, carte) est dans
// fc-clubs.test.js ; ici, on verifie que tout est RACCORDE : club introuvable
// puis cree, matchs retrouves sans carte au demarrage, nouveau match avec sa
// carte et son skill rating, actions, vue d'ensemble, panne d'EA.

import test from 'node:test';
import assert from 'node:assert/strict';

import manifeste from '../src/modules/fc-clubs/module.js';

const CLUB = '4242';

const joueur = (nom, pos, rating, stats = {}) => ({
  assists: '0',
  goals: '0',
  mom: '0',
  passattempts: '20',
  passesmade: '16',
  pos,
  rating: rating.toFixed(2),
  realtimegame: '960',
  redcards: '0',
  saves: '0',
  shots: '1',
  tackleattempts: '4',
  tacklesmade: '2',
  playername: nom,
  ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)])),
});

function matchBrut(id, finMs, buts, encaisses, type = 'leagueMatch') {
  const t = Math.floor(finMs / 1000);
  const code = buts > encaisses ? '1' : buts < encaisses ? '2' : '4';
  const amical = type === 'friendlyMatch';
  return {
    matchId: id,
    timestamp: t,
    clubs: {
      [CLUB]: {
        goals: String(buts),
        goalsAgainst: String(encaisses),
        result: amical ? '0' : code,
        details: { name: 'Les Testeurs' },
      },
      9001: {
        goals: String(encaisses),
        goalsAgainst: String(buts),
        result: '0',
        details: { name: 'Rivaux FC' },
      },
    },
    players: {
      [CLUB]: {
        1: joueur('Alpha', 'forward', 8.2, { goals: buts, mom: buts > encaisses ? 1 : 0 }),
        2: joueur('Bravo', 'goalkeeper', 6.9, { saves: 4 }),
      },
      9001: { 9: joueur('Rival', 'forward', 7.0, { goals: encaisses }) },
    },
    aggregate: {},
  };
}

// Le faux EA. `club` null = pas encore cree ; `panne` = EA ne repond plus.
function fauxEA() {
  const ea = {
    club: null,
    matchs: { leagueMatch: [], playoffMatch: [], friendlyMatch: [] },
    sr: 1000,
    panne: false,
    requetes: [],
  };
  const repondre = (code, corps) => ({
    ok: code >= 200 && code < 300,
    status: code,
    text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)),
  });
  const fetch = async (url) => {
    const u = new URL(url);
    ea.requetes.push(u.pathname.replace('/api/fc/', '') + '?' + u.searchParams.toString());
    if (ea.panne) throw new Error('connexion refusée');
    assert.equal(u.searchParams.get('platform'), 'common-gen5');
    if (u.pathname.endsWith('/allTimeLeaderboard/search')) {
      const nom = u.searchParams.get('clubName').toLowerCase();
      const liste =
        ea.club && ea.club.toLowerCase().startsWith(nom)
          ? [
              {
                clubId: CLUB,
                currentDivision: '6',
                gamesPlayed: '3',
                clubInfo: { name: ea.club, customKit: { kitColor1: '15921906', kitColor2: '5775459' } },
              },
            ]
          : [];
      return repondre(200, liste);
    }
    if (u.pathname.endsWith('/clubs/matches')) {
      assert.equal(u.searchParams.get('clubIds'), CLUB);
      // Comme EA : les plus recents d'abord, 10 au plus.
      const liste = [...ea.matchs[u.searchParams.get('matchType')]].sort((x, y) => y.timestamp - x.timestamp);
      return repondre(200, liste.slice(0, 10));
    }
    if (u.pathname.endsWith('/clubs/overallStats')) {
      return repondre(200, [{ clubId: CLUB, skillRating: String(ea.sr) }]);
    }
    return repondre(404, 'inconnu');
  };
  return { ea, fetch };
}

function contexte(reglages = {}) {
  const etats = [];
  const journal = [];
  const compteurs = {};
  const intervalles = [];
  const delais = [];
  let stocke = null;
  const ctx = {
    config: {
      club: 'Les Testeurs',
      matchs: 'tous',
      dureeCarte: 30,
      adversaire: true,
      couleurMaillot: true,
      couleur: '#3b7bff',
      pauseSoiree: 3,
      clubId: '',
      ...reglages,
    },
    log: Object.fromEntries(
      ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => journal.push([n, m])])
    ),
    overlay: {
      etat: (vue, data) => etats.push([vue, data]),
      url: (vue) => 'http://127.0.0.1:47455/overlay/fc-clubs/' + vue,
    },
    compteur: { incr: (cle, n = 1) => (compteurs[cle] = (compteurs[cle] ?? 0) + n) },
    etat: {
      lire: (defaut) => stocke ?? defaut,
      sauver: (v) => (stocke = JSON.parse(JSON.stringify(v))),
    },
    minuteur: {
      intervalle: (fn, ms) => intervalles.push({ fn, ms }),
      delai: (fn, ms) => delais.push({ fn, ms }),
    },
  };
  const derniere = (vue) => etats.filter((e) => e[0] === vue).at(-1)?.[1];
  // Le premier tour part au demarrage, sans attendre : on le laisse finir.
  const laisserFinir = () =>
    new Promise((r) => {
      setTimeout(r, 30);
    });
  const tour = async () => {
    for (const i of intervalles) await i.fn();
  };
  return { ctx, etats, journal, compteurs, delais, derniere, laisserFinir, tour };
}

test('une soiree : club cree en live, matchs retrouves, nouveau match avec sa carte', async (t) => {
  const origine = globalThis.fetch;
  const { ea, fetch } = fauxEA();
  globalThis.fetch = fetch;
  t.after(() => {
    globalThis.fetch = origine;
  });

  const { ctx, journal, compteurs, delais, derniere, laisserFinir, tour } = contexte();
  const module = await manifeste.demarrer(ctx);
  await laisserFinir();

  // Le club n'existe pas encore : les overlays sont la, au nom des reglages, a zero.
  let e = ctx._etatFC();
  assert.equal(e.statut, 'introuvable');
  assert.equal((await manifeste.sante(ctx))[0].etat, 'attention');
  assert.equal(derniere('bandeau').club.nom, 'Les Testeurs');
  assert.equal(derniere('bandeau').serie.texte, 'En attente du premier match');
  assert.equal(derniere('tableau').vide, true);
  assert.ok(journal.some(([n, m]) => n === 'warn' && m.includes('introuvable')));

  // Pas de nouvelle recherche a chaque tour : toutes les 2 minutes.
  const avant = ea.requetes.length;
  await tour();
  assert.equal(ea.requetes.length, avant);

  // Le streamer cree le club, joue deux matchs, et clique « Chercher le club ».
  ea.club = 'Les Testeurs';
  const maintenant = Date.now();
  ea.matchs.leagueMatch.push(
    matchBrut('m1', maintenant - 50 * 60_000, 1, 1),
    matchBrut('m2', maintenant - 25 * 60_000, 2, 0)
  );
  const r = await manifeste.actions.chercherClub(ctx);
  assert.match(r.message, /Club trouvé : Les Testeurs \(identifiant 4242, Div\. 5, 3 matchs/);
  await laisserFinir();

  // Les deux matchs deja joues sont repris sans carte ni compteur.
  e = ctx._etatFC();
  assert.equal(e.statut, 'pret');
  assert.deepEqual([e.v, e.n, e.d], [1, 1, 0]);
  assert.deepEqual(compteurs, {});
  assert.equal(derniere('carte').visible, false);
  assert.equal(derniere('bandeau').club.division, 'Div. 5');
  assert.notEqual(derniere('bandeau').club.couleur, '#3b7bff'); // couleur du maillot
  assert.ok(journal.some(([, m]) => m.includes('2 match(s) de la soirée en cours retrouvé(s)')));
  assert.equal((await manifeste.sante(ctx))[0].etat, 'ok');

  // Un nouveau match publie par EA : compte, carte a l'ecran, skill rating.
  ea.sr = 1016;
  ea.matchs.leagueMatch.push(matchBrut('m3', Date.now() - 3 * 60_000, 3, 1));
  await tour();
  assert.deepEqual(compteurs, { victoires: 1 });
  const carte = derniere('carte');
  assert.equal(carte.visible, true);
  assert.equal(carte.match.libelle, 'Victoire');
  assert.equal(carte.match.buts, 3);
  assert.deepEqual(carte.match.sr, { texte: '+16', signe: 1 });
  assert.equal(carte.match.adversaire, 'Rivaux FC');
  assert.deepEqual(
    carte.match.joueurs.map((j) => j.nom),
    ['Alpha', 'Bravo']
  );
  assert.ok(
    journal.some(([n, m]) => n === 'ok' && m === 'Victoire 3–1 contre Rivaux FC (championnat) — compté.')
  );
  assert.equal(derniere('bandeau').serie.texte, '2 victoires d’affilée');
  assert.equal(derniere('tableau').trophees[1].nom, 'Alpha');
  // Le skill rating d'avant la soiree n'a pas ete lu a temps : pas d'ecart invente.
  assert.equal(derniere('tableau').sr.valeur, '1 016');
  assert.equal(derniere('tableau').sr.ecart, '');

  // La carte s'efface toute seule apres sa duree.
  assert.equal(delais.at(-1).ms, 30_100);
  const vraiNow = Date.now;
  Date.now = () => vraiNow() + 31_000;
  try {
    delais.at(-1).fn();
  } finally {
    Date.now = vraiNow;
  }
  assert.equal(derniere('carte').visible, false);

  // « Revoir la dernière carte », puis « Nouvelle soirée ».
  assert.match((await manifeste.actions.revoirCarte(ctx)).message, /de nouveau/);
  assert.equal(derniere('carte').visible, true);
  assert.equal(derniere('carte').match.sr.texte, '+16');
  assert.match((await manifeste.actions.nouvelleSoiree(ctx)).message, /repart de zéro/);
  assert.deepEqual([ctx._etatFC().v, ctx._etatFC().n, ctx._etatFC().d], [0, 0, 0]);
  assert.equal(derniere('carte').visible, false);

  // EA tombe : un seul avertissement, la vue d'ensemble passe en erreur.
  ea.panne = true;
  await tour();
  await tour();
  assert.equal(ctx._etatFC().statut, 'erreur');
  assert.equal((await manifeste.sante(ctx))[0].etat, 'ko');
  assert.equal(journal.filter(([n, m]) => n === 'warn' && m.startsWith('EA :')).length, 1);

  // Il revient : tout repart.
  ea.panne = false;
  await tour();
  assert.equal(ctx._etatFC().statut, 'pret');
  await module.arreter();
});

test('matchs comptes : les amicaux sont ignores en mode competition', async (t) => {
  const origine = globalThis.fetch;
  const { ea, fetch } = fauxEA();
  globalThis.fetch = fetch;
  t.after(() => {
    globalThis.fetch = origine;
  });
  ea.club = 'Les Testeurs';

  const { ctx, compteurs, laisserFinir, tour } = contexte({ matchs: 'competition' });
  await manifeste.demarrer(ctx);
  await laisserFinir();
  assert.ok(!ea.requetes.some((q) => q.includes('friendlyMatch')));

  ea.matchs.friendlyMatch.push(matchBrut('a1', Date.now() - 60_000, 5, 0, 'friendlyMatch'));
  await tour();
  assert.deepEqual(compteurs, {});
});

test('exemple et recherche : les boutons repondent meme sans club', async (t) => {
  const origine = globalThis.fetch;
  const { fetch } = fauxEA();
  globalThis.fetch = fetch;
  t.after(() => {
    globalThis.fetch = origine;
  });

  // Module arrete : la recherche marche quand meme, et dit ce qui ne va pas.
  const arrete = contexte({ club: 'Inconnus' });
  const r = await manifeste.actions.chercherClub(arrete.ctx);
  assert.equal(r.ok, false);
  assert.match(r.erreur, /Aucun club « Inconnus » chez EA/);
  assert.equal((await manifeste.actions.exemple(arrete.ctx)).ok, false);
  assert.equal((await manifeste.actions.chercherClub(contexte({ club: '  ' }).ctx)).ok, false);

  // Module demarre : l'exemple remplit les trois sources, carte comprise.
  const { ctx, derniere, laisserFinir } = contexte();
  await manifeste.demarrer(ctx);
  await laisserFinir();
  await manifeste.actions.exemple(ctx);
  assert.equal(derniere('bandeau').club.nom, 'FC Les Potes');
  assert.equal(derniere('carte').visible, true);
  assert.equal(derniere('carte').match.adversaire, 'Inter Pantoufle');
  assert.equal(derniere('tableau').trophees[0].nom, 'Yass');

  const d = await manifeste.diagnostic(ctx);
  assert.equal(d.club, 'Les Testeurs');
  assert.match(d.reseau, /Node/);
});
