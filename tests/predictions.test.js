// Predictions : ce que l'overlay affiche, et surtout ce qu'il N'affiche PAS.
//
// Les pieges d'un overlay de prediction se jouent en direct, devant les
// viewers, sur un ecran que le streamer ne regarde pas :
//   - EventSub livre parfois dans le desordre : une progression tardive ne doit
//     pas rouvrir les votes a l'ecran, ni ressusciter une carte deja masquee ;
//   - un evenement de fin rejoue (reconnexion) ne doit ni recompter les points,
//     ni relancer le minuteur qui efface la carte ;
//   - les pourcentages doivent faire 100, pas 99.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pourcentages,
  depuisEvenement,
  depuisHelix,
  creerSuivi,
  scenarioSimulation,
} from '../src/modules/predictions/predictions.js';
import manifeste from '../src/modules/predictions/module.js';

// --- Pourcentages ------------------------------------------------------------

test('les pourcentages font toujours 100', () => {
  assert.deepEqual(pourcentages([13421, 4444]), [75, 25]);
  const tiers = pourcentages([1, 1, 1]);
  assert.equal(
    tiers.reduce((s, v) => s + v, 0),
    100,
    '33 + 33 + 33 = 99 : le reste doit etre distribue'
  );
  for (const valeurs of [
    [1, 2, 3, 4, 5, 6, 7],
    [999, 1],
    [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  ]) {
    assert.equal(
      pourcentages(valeurs).reduce((s, v) => s + v, 0),
      100,
      String(valeurs)
    );
  }
});

test('sans aucun point mise, tout est a zero (pas de division par zero)', () => {
  assert.deepEqual(pourcentages([0, 0]), [0, 0]);
});

// --- Traduction des evenements Twitch -----------------------------------------

// Faux evenements, avec les memes noms de champs que Twurple.
const issuesTwitch = (bleu = {}, rose = {}) => [
  { id: 'o1', title: 'Victoire', color: 'blue', ...bleu },
  { id: 'o2', title: 'Défaite', color: 'pink', ...rose },
];

test('debut : pas encore de votes, heure de fermeture connue', () => {
  const verrou = new Date('2026-09-14T20:01:35Z');
  const p = depuisEvenement(
    { id: 'P1', title: 'Top 1 ?', outcomes: issuesTwitch(), lockDate: verrou },
    'debut'
  );

  assert.equal(p.statut, 'active');
  assert.equal(p.verrouA, verrou.getTime());
  assert.deepEqual(
    p.issues.map((o) => [o.couleur, o.points, o.votants, o.pourcent]),
    [
      ['bleu', 0, 0, 0],
      ['rose', 0, 0, 0],
    ]
  );
});

test('progression : totaux et pourcentages calcules sur les points', () => {
  const p = depuisEvenement(
    {
      id: 'P1',
      title: 'Top 1 ?',
      lockDate: new Date(),
      outcomes: issuesTwitch({ users: 14, channelPoints: 13421 }, { users: 3, channelPoints: 4444 }),
    },
    'progression'
  );
  assert.equal(p.totalPoints, 17865);
  assert.equal(p.totalVotants, 17);
  assert.deepEqual(
    p.issues.map((o) => o.pourcent),
    [75, 25]
  );
});

test('fin : resolue avec son gagnant, ou annulee sans gagnant', () => {
  const base = { id: 'P1', title: 'Top 1 ?', outcomes: issuesTwitch(), winningOutcomeId: 'o2' };

  const resolue = depuisEvenement({ ...base, status: 'resolved' }, 'fin');
  assert.equal(resolue.statut, 'resolue');
  assert.equal(resolue.gagnant, 'o2');
  assert.equal(resolue.verrouA, null, 'plus de compte a rebours une fois terminee');

  const annulee = depuisEvenement({ ...base, status: 'canceled' }, 'fin');
  assert.equal(annulee.statut, 'annulee');
  assert.equal(annulee.gagnant, null);
});

test('API Helix : statut traduit et heure de fermeture deduite', () => {
  const creee = new Date('2026-09-14T20:00:00Z');
  const p = depuisHelix({
    id: 'P1',
    title: 'Top 1 ?',
    status: 'ACTIVE',
    creationDate: creee,
    autoLockAfter: 120,
    outcomes: [
      { id: 'o1', title: 'Oui', color: 'BLUE', users: 2, totalChannelPoints: 300 },
      { id: 'o2', title: 'Non', color: 'PINK', users: 1, totalChannelPoints: 100 },
    ],
  });
  assert.equal(p.statut, 'active');
  assert.equal(p.verrouA, creee.getTime() + 120000);
  assert.deepEqual(
    p.issues.map((o) => o.couleur),
    ['bleu', 'rose']
  );
  assert.equal(depuisHelix({ status: 'INCONNU', outcomes: [] }), null);
});

// --- Ce qui reste a l'ecran ---------------------------------------------------

// Faux minuteurs, declenches a la main.
function horloge() {
  const enAttente = [];
  return {
    planifier(fn, ms) {
      const t = { fn, ms, annule: false };
      enAttente.push(t);
      return () => (t.annule = true);
    },
    actifs: () => enAttente.filter((t) => !t.annule && !t.fait),
    toutDeclencher() {
      for (const t of enAttente) {
        if (t.annule || t.fait) continue;
        t.fait = true;
        t.fn();
      }
    },
  };
}

function monterSuivi(options = {}) {
  const h = horloge();
  const publies = [];
  const nouvelles = [];
  const terminees = [];
  const suivi = creerSuivi({
    publier: (p) => publies.push(p),
    planifier: h.planifier,
    dureeResultatMs: 15000,
    surNouvelle: (p) => nouvelles.push(p.id),
    surTerminee: (p) => terminees.push(p.id),
    ...options,
  });
  return { suivi, h, publies, nouvelles, terminees, dernier: () => publies[publies.length - 1] };
}

const prediction = (statut, extra = {}) => ({
  id: 'P1',
  titre: 'Top 1 ?',
  statut,
  issues: [],
  totalPoints: 100,
  totalVotants: 2,
  ...extra,
});

test('une progression livree apres le verrou ne rouvre pas les votes', () => {
  const { suivi, dernier } = monterSuivi();
  suivi.recevoir(prediction('active'));
  suivi.recevoir(prediction('verrouillee'));

  assert.equal(suivi.recevoir(prediction('active')), false);
  assert.equal(dernier().statut, 'verrouillee');
});

test('le resultat reste affiche, puis la carte disparait', () => {
  const { suivi, h, dernier, terminees } = monterSuivi();
  suivi.recevoir(prediction('active'));
  suivi.recevoir(prediction('resolue'));

  assert.equal(dernier().statut, 'resolue');
  assert.equal(h.actifs().length, 1);
  assert.equal(h.actifs()[0].ms, 15000);
  assert.deepEqual(terminees, ['P1']);

  h.toutDeclencher();
  assert.equal(dernier(), null, 'au repos, l overlay ne montre rien');
  assert.equal(suivi.visible(), false);
});

test('une fin rejouee ne recompte pas et ne relance pas le minuteur', () => {
  const { suivi, h, terminees } = monterSuivi();
  suivi.recevoir(prediction('resolue'));
  const minuteur = h.actifs()[0];

  assert.equal(suivi.recevoir(prediction('resolue')), false);
  assert.deepEqual(terminees, ['P1'], 'les points ne doivent etre comptes qu une fois');
  assert.equal(h.actifs().length, 1);
  assert.equal(h.actifs()[0], minuteur, 'la carte doit partir a l heure prevue, pas 15 s plus tard');
});

test('un evenement tardif ne ressuscite pas une prediction deja masquee', () => {
  const { suivi, h, dernier } = monterSuivi();
  suivi.recevoir(prediction('resolue'));
  h.toutDeclencher();

  assert.equal(suivi.recevoir(prediction('active')), false);
  assert.equal(dernier(), null);
});

test('duree de resultat a 0 : la carte disparait aussitot', () => {
  const { suivi, dernier, h } = monterSuivi({ dureeResultatMs: 0 });
  suivi.recevoir(prediction('active'));
  suivi.recevoir(prediction('annulee'));
  assert.equal(dernier(), null);
  assert.equal(h.actifs().length, 0);
});

// --- Votes fermes : visible 15 s, masque, puis retour au denouement ------------

// Horloge figee : les votes ont ferme a T, on regarde ce qui se passe a `apres`.
const T = 1_000_000;
const verrou = (fermeeA = T) => prediction('verrouillee', { fermeeA });

test('votes fermes : visible 15 s, puis le scoreboard disparait et revient au resultat', () => {
  const { suivi, h, dernier } = monterSuivi({ masquerVerrouApresMs: 15000, maintenant: () => T });
  suivi.recevoir(prediction('active'));
  suivi.recevoir(verrou());
  assert.equal(dernier().statut, 'verrouillee', '« Votes fermés » doit rester visible');
  assert.equal(h.actifs()[0].ms, 15000);

  h.toutDeclencher();
  assert.equal(dernier(), null, 'masque au bout de 15 s');

  suivi.recevoir(prediction('resolue'));
  assert.equal(dernier().statut, 'resolue', 'le resultat doit revenir a l ecran');
});

test('votes fermes puis annulation : c est l annulation qui revient a l ecran', () => {
  const { suivi, h, dernier } = monterSuivi({ masquerVerrouApresMs: 15000, maintenant: () => T });
  suivi.recevoir(verrou());
  h.toutDeclencher();

  suivi.recevoir(prediction('annulee'));
  assert.equal(dernier().statut, 'annulee');
});

test('resultat pendant les 15 s : il remplace « Votes fermés » sans attendre', () => {
  const { suivi, h, dernier } = monterSuivi({ masquerVerrouApresMs: 15000, maintenant: () => T });
  suivi.recevoir(verrou());
  suivi.recevoir(prediction('resolue'));

  assert.equal(dernier().statut, 'resolue');
  assert.equal(h.actifs().length, 1, 'seul le minuteur du resultat doit rester');
  assert.equal(h.actifs()[0].ms, 15000);
  h.toutDeclencher();
  assert.equal(dernier(), null);
});

test('le delai part de la VRAIE fermeture, pas de l instant ou StreamKit l apprend', () => {
  // Module relance 10 s apres la fermeture (reglage enregistre en pleine
  // partie) : il ne reste que 5 s d'affichage, pas 15 de plus.
  const { suivi, h } = monterSuivi({ masquerVerrouApresMs: 15000, maintenant: () => T + 10000 });
  suivi.recevoir(verrou());
  assert.equal(h.actifs()[0].ms, 5000);
});

test('votes fermes depuis longtemps : le scoreboard ne ressort pas en pleine partie', () => {
  const { suivi, h, publies } = monterSuivi({ masquerVerrouApresMs: 15000, maintenant: () => T + 600000 });
  suivi.recevoir(verrou());
  assert.deepEqual(publies, [null], 'jamais montre, pas meme une image');
  assert.equal(h.actifs().length, 0);
});

test('un verrou recu en double ne fait pas ressortir le scoreboard masque', () => {
  const { suivi, h, dernier } = monterSuivi({ masquerVerrouApresMs: 15000, maintenant: () => T });
  suivi.recevoir(verrou());
  h.toutDeclencher();

  assert.equal(suivi.recevoir(verrou()), false);
  assert.equal(dernier(), null);
});

test('sans delai de masquage, les votes fermes restent affiches jusqu au resultat', () => {
  const { suivi, h, dernier } = monterSuivi({ masquerVerrouApresMs: null, maintenant: () => T + 600000 });
  suivi.recevoir(verrou());
  assert.equal(dernier().statut, 'verrouillee');
  assert.equal(h.actifs().length, 0);
});

test('une nouvelle prediction remplace la precedente et annule son minuteur', () => {
  const { suivi, h, dernier, nouvelles } = monterSuivi();
  suivi.recevoir(prediction('resolue'));
  suivi.recevoir(prediction('active', { id: 'P2' }));

  assert.equal(dernier().id, 'P2');
  assert.equal(h.actifs().length, 0, 'l ancien minuteur effacerait la nouvelle carte');
  assert.deepEqual(nouvelles, ['P1', 'P2']);
});

test('chaque prediction n est comptee qu une fois, quel que soit le nombre de votes', () => {
  const { suivi, nouvelles } = monterSuivi();
  for (let i = 0; i < 20; i++) suivi.recevoir(prediction('active', { totalPoints: i }));
  assert.deepEqual(nouvelles, ['P1']);
});

// --- Simulation ----------------------------------------------------------------

test('la simulation laisse au scoreboard le temps de disparaitre avant le resultat', () => {
  const etapes = scenarioSimulation({ maintenant: T, pauseAvantResultatMs: 20000 });
  const verrouillee = etapes.find((e) => e.prediction.statut === 'verrouillee');
  const resultat = etapes.at(-1);
  assert.equal(resultat.apresMs - verrouillee.apresMs, 20000);
  assert.equal(verrouillee.prediction.fermeeA, verrouillee.apresMs + T, 'fermee a l heure de l etape');
});

test('la simulation deroule une prediction complete et coherente', () => {
  const etapes = scenarioSimulation({ maintenant: 1_000_000 });
  const statuts = etapes.map((e) => e.prediction.statut);

  assert.equal(statuts[0], 'active');
  assert.equal(statuts.at(-2), 'verrouillee');
  assert.equal(statuts.at(-1), 'resolue');
  assert.ok(
    etapes.every((e) => e.prediction.simulation),
    'jamais comptee comme une vraie'
  );
  assert.equal(new Set(etapes.map((e) => e.prediction.id)).size, 1);

  for (let i = 1; i < etapes.length; i++) {
    assert.ok(etapes[i].apresMs > etapes[i - 1].apresMs, 'etapes dans l ordre');
    // Un votant ne se retire pas : les compteurs ne redescendent jamais.
    for (const [j, o] of etapes[i].prediction.issues.entries()) {
      const avant = etapes[i - 1].prediction.issues[j];
      assert.ok(o.points >= avant.points && o.votants >= avant.votants, 'votes decroissants a l etape ' + i);
    }
  }

  const fin = etapes.at(-1).prediction;
  assert.ok(fin.issues.some((o) => o.id === fin.gagnant));
});

// --- Le module branche sur un faux contexte ---------------------------------------

function faireContexte({ droits = ['channel:read:predictions'], lecture } = {}) {
  const etats = [];
  const compteurs = {};
  const logs = [];
  const minuteurs = [];
  const handlers = {};

  const ctx = {
    config: {
      dureeResultatSec: 15,
      dureeVerrouSec: 15,
      couleurBleu: '#2f7cff',
      couleurRose: '#e8409a',
      coin: 'top-right',
    },
    log: Object.fromEntries(['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => logs.push([n, m])])),
    overlay: {
      etat: (vue, data) => etats.push([vue, data]),
      url: (vue) => 'http://127.0.0.1:47455/overlay/predictions/' + vue,
    },
    compteur: { incr: (cle, n = 1) => (compteurs[cle] = (compteurs[cle] ?? 0) + n) },
    minuteur: {
      delai(fn, ms) {
        const t = setTimeout(() => {}, 0); // un vrai Timeout, pour clearTimeout
        clearTimeout(t);
        minuteurs.push({ fn, ms, t });
        return t;
      },
    },
    twitch: {
      broadcasterId: '123',
      aLeDroit: (d) => droits.includes(d),
      surPredictions: (h) => Object.assign(handlers, h),
      api: {
        predictions: {
          getPredictions: lecture ?? (async () => ({ data: [] })),
        },
      },
    },
  };
  const derniere = () => etats.at(-1)?.[1].prediction;
  return { ctx, etats, compteurs, logs, minuteurs, handlers, derniere };
}

const evenement = (extra = {}) => ({
  id: 'P1',
  title: 'Top 1 ?',
  lockDate: new Date(Date.now() + 60000),
  outcomes: issuesTwitch({ users: 4, channelPoints: 3000 }, { users: 1, channelPoints: 1000 }),
  ...extra,
});

test('module : un cycle reel pousse les bons etats et compte les points une fois', async () => {
  const { ctx, handlers, derniere, compteurs, etats } = faireContexte();
  await manifeste.demarrer(ctx);

  assert.equal(etats[0][1].prediction, null, 'le theme part avant toute prediction');
  assert.equal(etats[0][1].theme.coin, 'top-right');

  await handlers.debut(evenement());
  await handlers.progression(evenement());
  assert.equal(derniere().statut, 'active');
  assert.equal(derniere().totalPoints, 4000);

  await handlers.fin(evenement({ status: 'resolved', winningOutcomeId: 'o1' }));
  await handlers.fin(evenement({ status: 'resolved', winningOutcomeId: 'o1' })); // rejouee
  assert.equal(derniere().statut, 'resolue');
  assert.deepEqual(compteurs, { lancees: 1, points: 4000 });
});

test('module, reglages par defaut : votes fermes 15 s, masque, puis le resultat revient', async () => {
  const { ctx, handlers, derniere, minuteurs } = faireContexte();
  await manifeste.demarrer(ctx);

  await handlers.debut(evenement());
  await handlers.verrou(evenement({ lockDate: new Date() }));
  assert.equal(derniere().statut, 'verrouillee');

  const masquage = minuteurs.at(-1);
  assert.ok(masquage.ms > 14000 && masquage.ms <= 15000, 'environ 15 s, recu : ' + masquage.ms);
  masquage.fn();
  assert.equal(derniere(), null);

  await handlers.fin(evenement({ status: 'resolved', winningOutcomeId: 'o2' }));
  assert.equal(derniere().statut, 'resolue');
  assert.equal(derniere().gagnant, 'o2');
});

test('module : la simulation montre aussi la disparition avant le resultat', async () => {
  const { ctx, minuteurs } = faireContexte();
  await manifeste.demarrer(ctx);
  await manifeste.actions.simuler(ctx);

  const [verrouillee, resultat] = minuteurs.slice(-2);
  assert.ok(resultat.ms - verrouillee.ms > 15000, 'le resultat doit arriver apres les 15 s d affichage');
});

test('module : une prediction deja ouverte au demarrage est reprise', async () => {
  const { ctx, derniere, compteurs } = faireContexte({
    lecture: async () => ({
      data: [
        {
          id: 'P9',
          title: 'Déjà là',
          status: 'LOCKED',
          creationDate: new Date(),
          autoLockAfter: 60,
          outcomes: [],
        },
      ],
    }),
  });
  await manifeste.demarrer(ctx);
  assert.equal(derniere().id, 'P9');
  assert.equal(derniere().statut, 'verrouillee');
  assert.equal(compteurs.lancees, 1);
});

test('module : chaine non affiliee (403) -> demarre quand meme, et la sante l explique', async () => {
  const { ctx } = faireContexte({
    lecture: async () => {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    },
  });
  await manifeste.demarrer(ctx);
  const [carte] = await manifeste.sante(ctx);
  assert.equal(carte.etat, 'attention');
  assert.match(carte.aide, /Affili/);
});

test('module : sans le droit, aucun abonnement, mais la simulation marche', async () => {
  const { ctx, handlers, minuteurs, derniere, compteurs } = faireContexte({ droits: [] });
  await manifeste.demarrer(ctx);

  assert.deepEqual(Object.keys(handlers), [], 'l abonnement echouerait chez Twitch');
  assert.equal((await manifeste.sante(ctx))[0].etat, 'ko');

  const r = await manifeste.actions.simuler(ctx);
  assert.ok(r.message);
  for (const m of [...minuteurs]) m.fn();
  assert.equal(derniere().statut, 'resolue');
  assert.deepEqual(compteurs, {}, 'une simulation ne compte jamais');
});

test('module : pas de simulation par-dessus une vraie prediction', async () => {
  const { ctx, handlers } = faireContexte();
  await manifeste.demarrer(ctx);
  await handlers.debut(evenement());

  const r = await manifeste.actions.simuler(ctx);
  assert.equal(r.ok, false);
  assert.match(r.erreur, /vraie prédiction/);
});

test('module : une vraie prediction interrompt la simulation', async () => {
  const { ctx, handlers, minuteurs, derniere } = faireContexte();
  await manifeste.demarrer(ctx);
  await manifeste.actions.simuler(ctx);
  minuteurs[0].fn(); // la simulation a commence

  await handlers.debut(evenement());
  assert.equal(derniere().id, 'P1');
  assert.equal(derniere().simulation, false);
});

test('module arrete : l action le dit au lieu de lancer une simulation mort-nee', async () => {
  const r = await manifeste.actions.simuler({});
  assert.equal(r.ok, false);
});

test('module : l arret efface la carte memorisee', async () => {
  const { ctx, handlers, derniere } = faireContexte();
  const instance = await manifeste.demarrer(ctx);
  await handlers.debut(evenement());
  await instance.arreter();
  assert.equal(derniere(), null, 'une source OBS connectee plus tard verrait une prediction perimee');
});
