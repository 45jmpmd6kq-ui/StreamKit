// Sondages : ce que le scoreboard affiche, et ce qu'il n'affiche plus.
//
// Memes pieges que les predictions (evenements dans le desordre ou rejoues,
// pourcentages a 100), plus un propre aux sondages : Twitch envoie une
// SECONDE fin, « archived », qui ne doit ni couper ni relancer l'affichage du
// resultat.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pourcentages,
  depuisEvenement,
  depuisHelix,
  creerSuivi,
  scenarioSimulation,
} from '../src/modules/sondages/sondages.js';
import manifeste from '../src/modules/sondages/module.js';

// Faux evenements, avec les noms de champs de Twurple.
const choixTwitch = (votes) =>
  votes.map((v, i) => ({ id: 'c' + i, title: ['Octane', 'Fennec', 'Dominus'][i], totalVotes: v }));
const evenement = (votes, extra = {}) => ({
  id: 'S1',
  title: 'Quelle voiture ?',
  choices: choixTwitch(votes),
  endDate: new Date(Date.now() + 60_000),
  ...extra,
});

test('pourcentages : toujours 100, zero vote = zeros', () => {
  assert.deepEqual(pourcentages([60, 43, 21]), [48, 35, 17]);
  assert.equal(
    pourcentages([1, 1, 1]).reduce((a, b) => a + b, 0),
    100
  );
  assert.deepEqual(pourcentages([0, 0]), [0, 0]);
});

test('traduction : actif, termine avec gagnant, clos a la main, archive', () => {
  const actif = depuisEvenement(evenement([60, 43, 21]), 'progression');
  assert.equal(actif.statut, 'actif');
  assert.equal(actif.totalVotes, 124);
  assert.deepEqual(actif.gagnants, [], 'pas de gagnant tant que ca vote');
  assert.ok(actif.finA > Date.now());

  const fini = depuisEvenement(evenement([60, 43, 21], { status: 'completed' }), 'fin');
  assert.deepEqual([fini.statut, fini.gagnants, fini.cloture, fini.finA], ['termine', ['c0'], false, null]);

  assert.equal(depuisEvenement(evenement([1, 2, 0], { status: 'terminated' }), 'fin').cloture, true);
  assert.equal(depuisEvenement(evenement([1, 2, 0], { status: 'archived' }), 'fin').statut, 'archive');
});

test('egalite en tete : les ex aequo gagnent tous ; aucun vote : personne', () => {
  assert.deepEqual(depuisEvenement(evenement([5, 5, 1], { status: 'completed' }), 'fin').gagnants, [
    'c0',
    'c1',
  ]);
  assert.deepEqual(depuisEvenement(evenement([0, 0, 0], { status: 'completed' }), 'fin').gagnants, []);
});

test('API Helix : actif repris, archive ou modere ignores', () => {
  const s = { id: 'S', title: 'T', status: 'ACTIVE', endDate: new Date(), choices: choixTwitch([1, 2, 3]) };
  assert.equal(depuisHelix(s).statut, 'actif');
  assert.equal(depuisHelix({ ...s, status: 'ARCHIVED' }), null);
  assert.equal(depuisHelix({ ...s, status: 'MODERATED' }), null);
});

// --- Ce qui reste a l'ecran -----------------------------------------------------------

function horloge() {
  const minuteurs = [];
  return {
    planifier(fn, ms) {
      const m = { fn, ms, annule: false };
      minuteurs.push(m);
      return () => (m.annule = true);
    },
    actifs: () => minuteurs.filter((m) => !m.annule && !m.fait),
    tout() {
      for (const m of minuteurs) if (!m.annule && !m.fait) ((m.fait = true), m.fn());
    },
  };
}

function monter() {
  const h = horloge();
  const publies = [];
  const nouveaux = [];
  const termines = [];
  const suivi = creerSuivi({
    publier: (s) => publies.push(s),
    planifier: h.planifier,
    dureeResultatMs: 15000,
    surNouveau: (s) => nouveaux.push(s.id),
    surTermine: (s) => termines.push(s.id),
  });
  const sondage = (phase, votes = [3, 2, 1], extra = {}) => depuisEvenement(evenement(votes, extra), phase);
  return { suivi, h, publies, nouveaux, termines, sondage, dernier: () => publies.at(-1) };
}

test('cycle normal : votes, resultat 15 s, puis plus rien', () => {
  const t = monter();
  t.suivi.recevoir(t.sondage('debut', [0, 0, 0]));
  t.suivi.recevoir(t.sondage('progression', [5, 3, 1]));
  t.suivi.recevoir(t.sondage('fin', [9, 3, 1], { status: 'completed' }));
  assert.equal(t.dernier().statut, 'termine');
  assert.equal(t.h.actifs()[0].ms, 15000);
  assert.deepEqual([t.nouveaux, t.termines], [['S1'], ['S1']]);
  t.h.tout();
  assert.equal(t.dernier(), null);
});

test('« archived » apres la fin ne coupe pas le resultat affiche', () => {
  const t = monter();
  t.suivi.recevoir(t.sondage('fin', [9, 3, 1], { status: 'completed' }));
  const minuteur = t.h.actifs()[0];
  assert.equal(t.suivi.recevoir(t.sondage('fin', [9, 3, 1], { status: 'archived' })), false);
  assert.equal(t.dernier().statut, 'termine', 'le resultat reste a l ecran');
  assert.equal(t.h.actifs()[0], minuteur, 'et part a l heure prevue');
});

test('progression tardive ou fin rejouee : rien ne ressuscite ni ne recompte', () => {
  const t = monter();
  t.suivi.recevoir(t.sondage('fin', [9, 3, 1], { status: 'completed' }));
  t.h.tout();
  assert.equal(t.suivi.recevoir(t.sondage('progression', [8, 3, 1])), false);
  assert.equal(t.suivi.recevoir(t.sondage('fin', [9, 3, 1], { status: 'completed' })), false);
  assert.equal(t.dernier(), null);
  assert.deepEqual(t.termines, ['S1']);
});

test('un nouveau sondage remplace le resultat du precedent', () => {
  const t = monter();
  t.suivi.recevoir(t.sondage('fin', [9, 3, 1], { status: 'completed' }));
  t.suivi.recevoir(depuisEvenement(evenement([0, 0, 0], { id: 'S2' }), 'debut'));
  assert.equal(t.dernier().id, 'S2');
  assert.equal(t.h.actifs().length, 0, 'l ancien minuteur effacerait le nouveau sondage');
});

test('simulation : votes croissants, puis resultat avec un gagnant', () => {
  const etapes = scenarioSimulation({ maintenant: 1_000_000 });
  assert.equal(etapes.at(-1).sondage.statut, 'termine');
  assert.equal(etapes.at(-1).sondage.gagnants.length, 1);
  assert.ok(etapes.every((e) => e.sondage.simulation));
  for (let i = 1; i < etapes.length; i++) {
    etapes[i].sondage.choix.forEach((c, j) => assert.ok(c.votes >= etapes[i - 1].sondage.choix[j].votes));
  }
});

// --- Module ------------------------------------------------------------------------

function contexte({ droits = ['channel:read:polls'], lecture } = {}) {
  const etats = [];
  const compteurs = {};
  const minuteurs = [];
  const handlers = {};
  const ctx = {
    config: { dureeResultatSec: 15, coin: 'top-right' },
    log: { debug() {}, info() {}, ok() {}, warn() {}, err() {} },
    overlay: { etat: (vue, d) => etats.push(d), url: () => 'http://127.0.0.1/overlay/sondages/carte' },
    compteur: { incr: (k, n = 1) => (compteurs[k] = (compteurs[k] ?? 0) + n) },
    minuteur: {
      delai(fn, ms) {
        const t = setTimeout(() => {}, 0);
        clearTimeout(t);
        minuteurs.push({ fn, ms });
        return t;
      },
    },
    twitch: {
      broadcasterId: '42',
      aLeDroit: (d) => droits.includes(d),
      surSondages: (h) => Object.assign(handlers, h),
      api: { polls: { getPolls: lecture ?? (async () => ({ data: [] })) } },
    },
  };
  return { ctx, etats, compteurs, minuteurs, handlers, dernier: () => etats.at(-1)?.sondage };
}

test('module : un vrai sondage s affiche et compte ses votes une fois', async () => {
  const t = contexte();
  await manifeste.demarrer(t.ctx);
  assert.equal(t.etats[0].theme.coin, 'top-right');
  await t.handlers.debut(evenement([0, 0, 0]));
  await t.handlers.progression(evenement([4, 2, 1]));
  await t.handlers.fin(evenement([6, 2, 1], { status: 'completed' }));
  await t.handlers.fin(evenement([6, 2, 1], { status: 'archived' }));
  assert.equal(t.dernier().statut, 'termine');
  assert.deepEqual(t.compteurs, { sondages: 1, votes: 9 });
});

test('module : sondage deja ouvert repris, chaine non affiliee expliquee', async () => {
  const a = contexte({
    lecture: async () => ({
      data: [
        {
          id: 'S9',
          title: 'Déjà là',
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 9000),
          choices: choixTwitch([1, 1]),
        },
      ],
    }),
  });
  await manifeste.demarrer(a.ctx);
  assert.equal(a.dernier().id, 'S9');

  const b = contexte({
    lecture: async () => {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    },
  });
  await manifeste.demarrer(b.ctx);
  const [carte] = await manifeste.sante(b.ctx);
  assert.equal(carte.etat, 'attention');
  assert.match(carte.aide, /Affili/);
});

test('module : sans le droit, pas d abonnement, mais la simulation marche et ne compte pas', async () => {
  const t = contexte({ droits: [] });
  await manifeste.demarrer(t.ctx);
  assert.deepEqual(Object.keys(t.handlers), []);
  assert.equal((await manifeste.sante(t.ctx))[0].etat, 'ko');
  assert.match((await manifeste.actions.simuler(t.ctx)).message, /Simulation/);
  for (const m of [...t.minuteurs]) m.fn();
  assert.equal(t.dernier().statut, 'termine');
  assert.deepEqual(t.compteurs, {});
});

test('module : pas de simulation par-dessus un vrai sondage ; arret = carte effacee', async () => {
  const t = contexte();
  const instance = await manifeste.demarrer(t.ctx);
  await t.handlers.debut(evenement([0, 0, 0]));
  assert.equal((await manifeste.actions.simuler(t.ctx)).ok, false);
  await instance.arreter();
  assert.equal(t.dernier(), null);
  assert.equal((await manifeste.actions.simuler({})).ok, false);
});
