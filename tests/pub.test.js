// Annonce de pub : ce qui s'affiche, et ce qui part dans le chat.
//
// Les deux erreurs qui coutent en direct : un chat spamme (« pub dans 1 min »
// a chaque relecture du planning), et un bandeau qui reste bloque a l'ecran
// (pub annoncee qui ne vient pas, pub deja passee que le planning annonce
// encore). Tout est teste sur une horloge figee.

import test from 'node:test';
import assert from 'node:assert/strict';

import { calculerPhase, creerSuiviPub, formaterDuree, remplir } from '../src/modules/pub/pub.js';
import manifeste from '../src/modules/pub/module.js';

const T = 1_800_000_000_000; // un instant quelconque
const MIN = 60_000;

test('formaterDuree et remplir', () => {
  assert.equal(formaterDuree(45_000), '45 s');
  assert.equal(formaterDuree(90_000), '1 min 30');
  assert.equal(formaterDuree(120_000), '2 min');
  assert.equal(
    remplir('Pub dans {delai} ({duree}) {inconnu}', { delai: '1 min', duree: '30 s' }),
    'Pub dans 1 min (30 s) {inconnu}'
  );
});

// --- Phases -------------------------------------------------------------------------

const phase = (o) => calculerPhase({ avertirMs: MIN, maintenant: T, ...o }).phase;

test('avant : seulement dans la fenetre d avertissement', () => {
  assert.equal(phase({ planning: { prochaineA: T + 5 * MIN, duree: 90 } }), null);
  assert.equal(phase({ planning: { prochaineA: T + 45_000, duree: 90 } }), 'avant');
  assert.equal(phase({ planning: null }), null, 'chaine hors ligne : pas de planning');
});

test('une pub prevue qui ne vient pas ne bloque pas le bandeau sur 0:00', () => {
  assert.equal(
    phase({ planning: { prochaineA: T - 5_000, duree: 90 } }),
    'avant',
    'quelques secondes de retard'
  );
  assert.equal(phase({ planning: { prochaineA: T - 30_000, duree: 90 } }), null);
});

test('pendant puis fin, deduits de la duree (Twitch n envoie pas de fin)', () => {
  const pub = { debutA: T - 30_000, duree: 90 };
  const e = calculerPhase({ pub, maintenant: T, avertirMs: MIN });
  assert.deepEqual(e, { phase: 'pendant', depuis: T - 30_000, cible: T + 60_000, duree: 90 });
  assert.equal(phase({ pub, maintenant: T + 62_000 }), 'fin');
  assert.equal(phase({ pub, maintenant: T + 70_000 }), null);
});

test('juste apres la pub, le planning pas encore relu ne la reannonce pas', () => {
  // Le streamer lance la pub a la main a T, 40 s avant la pub automatique
  // prevue. Twitch annule la pub prevue, mais le planning n'est relu que toutes
  // les 15 s : a la fin de la coupure, il annonce encore T+40 s.
  const pub = { debutA: T, duree: 30 };
  assert.equal(phase({ pub, planning: { prochaineA: T + 40_000, duree: 30 }, maintenant: T + 36_000 }), null);
  // ...mais la pub SUIVANTE, elle, est bien annoncee.
  assert.equal(
    phase({ pub, planning: { prochaineA: T + 20 * MIN, duree: 30 }, maintenant: T + 19.5 * MIN }),
    'avant'
  );
});

// --- Suivi : chat et overlay ------------------------------------------------------

function monter(options = {}) {
  let t = T;
  const publies = [];
  const chat = [];
  const suivi = creerSuiviPub({
    publier: (e) => publies.push(e),
    dire: (m) => chat.push(m),
    avertirMs: MIN,
    messages: { avant: 'Pub dans {delai}', pendant: 'Pub en cours ({duree})' },
    maintenant: () => t,
    ...options,
  });
  return {
    suivi,
    publies,
    chat,
    avancer: (ms) => {
      t += ms;
      suivi.tic();
    },
    maintenant: () => t,
    dernier: () => publies.at(-1),
  };
}

test('une seule annonce dans le chat par pub, meme si le planning bouge de quelques secondes', () => {
  const s = monter();
  s.suivi.planning({ prochaineA: T + 3 * MIN, duree: 90 });
  s.avancer(1000);
  assert.deepEqual(s.chat, []);

  s.avancer(2 * MIN); // entree dans la fenetre
  assert.equal(s.dernier().phase, 'avant');
  assert.equal(s.chat.length, 1);
  assert.match(s.chat[0], /^Pub dans (59|1 min)/);

  for (let i = 0; i < 5; i++) {
    s.suivi.planning({ prochaineA: T + 3 * MIN + i * 2000, duree: 90 }); // relectures qui varient
    s.avancer(3000);
  }
  assert.equal(s.chat.length, 1, 'le chat ne doit pas etre spamme');
});

test('pub repoussee : l avertissement disparait, puis revient en temps voulu', () => {
  const s = monter();
  s.suivi.planning({ prochaineA: T + 40_000, duree: 90 });
  s.avancer(0);
  assert.equal(s.dernier().phase, 'avant');

  s.suivi.planning({ prochaineA: T + 5 * MIN, duree: 90 }); // snooze de 5 min
  s.avancer(1000);
  assert.equal(s.dernier(), null);

  s.avancer(4 * MIN + 10_000);
  assert.equal(s.dernier().phase, 'avant');
  assert.equal(s.chat.length, 2, 'nouvelle heure = nouvelle annonce');
});

test('debut de pub : phase pendant, message avec la duree, doublon EventSub ignore', () => {
  const s = monter();
  s.suivi.pub({ debutA: T, duree: 90 });
  assert.equal(s.dernier().phase, 'pendant');
  assert.deepEqual(s.chat, ['Pub en cours (1 min 30)']);

  s.suivi.pub({ debutA: T + 1000, duree: 90 }); // meme evenement relivre
  assert.equal(s.chat.length, 1);

  s.avancer(91_000);
  assert.equal(s.dernier().phase, 'fin');
  s.avancer(5_000);
  assert.equal(s.dernier(), null);
});

test('messages vides : rien dans le chat', () => {
  const s = monter({ messages: { avant: '', pendant: '' } });
  s.suivi.planning({ prochaineA: T + 30_000, duree: 60 });
  s.avancer(0);
  s.suivi.pub({ debutA: T + 30_000, duree: 60 });
  assert.deepEqual(s.chat, []);
});

test('simulation : deroule avant, pendant, fin, sans rien envoyer dans le chat', () => {
  const s = monter();
  const { pubA, duree } = s.suivi.simuler({ dansMs: 15_000, duree: 30 });
  s.avancer(0);
  assert.equal(s.dernier().phase, 'avant');
  assert.equal(s.dernier().simulation, true);

  s.suivi.planning({ prochaineA: null }); // relecture du vrai planning : ignoree
  s.avancer(10_000);
  assert.equal(s.dernier().phase, 'avant');

  s.avancer(5_000);
  s.suivi.demarrerSimulee({ debutA: pubA, duree });
  assert.equal(s.dernier().phase, 'pendant');
  s.avancer(31_000);
  assert.equal(s.dernier().phase, 'fin');
  s.avancer(5_000);
  assert.equal(s.dernier(), null);
  assert.deepEqual(s.chat, []);
  assert.equal(s.suivi.etat().simulation, false, 'le vrai planning reprend la main');
});

// --- Module ---------------------------------------------------------------------

function contexte({
  droits = ['channel:read:ads', 'chat:edit'],
  planning,
  erreurPlanning,
  config = {},
} = {}) {
  const etats = [];
  const chat = [];
  const compteurs = {};
  const minuteurs = [];
  let surPub = null;
  const ctx = {
    config: {
      avertirSec: 60,
      phraseAvant: 'Profitez-en pour boire un verre 🥤',
      phrasePendant: 'Les abonnés ne voient pas les pubs 💜',
      chatAvantActif: true,
      chatAvant: 'Pause pub dans {delai}',
      chatPendantActif: true,
      chatPendant: 'Pub en cours ({duree})',
      coin: 'bottom-left',
      ...config,
    },
    log: { debug() {}, info() {}, ok() {}, warn() {}, err() {} },
    overlay: { etat: (vue, d) => etats.push(d), url: () => 'http://127.0.0.1/overlay/pub/bandeau' },
    compteur: { incr: (k, n = 1) => (compteurs[k] = (compteurs[k] ?? 0) + n) },
    minuteur: {
      intervalle: (fn, ms) => minuteurs.push({ fn, ms }),
      delai: (fn, ms) => minuteurs.push({ fn, ms, unique: true }),
    },
    twitch: {
      broadcasterId: '42',
      aLeDroit: (d) => droits.includes(d),
      dire: (m) => chat.push(m),
      surPub: (fn) => (surPub = fn),
      api: {
        channels: {
          getAdSchedule: async () => {
            if (erreurPlanning) throw erreurPlanning;
            return planning;
          },
        },
      },
    },
  };
  return { ctx, etats, chat, compteurs, minuteurs, pub: (e) => surPub(e), dernier: () => etats.at(-1) };
}

test('module : pub reelle -> overlay pendant, chat, compteurs', async () => {
  const t = contexte({ planning: { nextAdDate: null, duration: 0 } });
  await manifeste.demarrer(t.ctx);
  assert.equal(t.dernier().annonce, null);
  assert.equal(t.dernier().theme.phrasePendant, 'Les abonnés ne voient pas les pubs 💜');

  t.pub({ durationSeconds: 90, startDate: new Date(), isAutomatic: true });
  assert.equal(t.dernier().annonce.phase, 'pendant');
  assert.deepEqual(t.chat, ['Pub en cours (1 min 30)']);
  assert.deepEqual(t.compteurs, { pubs: 1, minutes: 2 });
});

test('module : le planning Twitch alimente l avertissement', async () => {
  const t = contexte({ planning: { nextAdDate: new Date(Date.now() + 30_000), duration: 60 } });
  await manifeste.demarrer(t.ctx);
  t.ctx._suivi.tic();
  assert.equal(t.dernier().annonce.phase, 'avant');
  assert.match(t.chat[0], /^Pause pub dans (29|30) s$/);
  assert.ok(
    t.minuteurs.some((m) => m.ms === 15_000),
    'le planning est relu toutes les 15 s'
  );
});

test('module : interrupteurs du chat eteints -> bandeau seul, chat muet', async () => {
  const t = contexte({
    planning: { nextAdDate: new Date(Date.now() + 30_000), duration: 60 },
    config: { chatAvantActif: false, chatPendantActif: false },
  });
  await manifeste.demarrer(t.ctx);
  t.ctx._suivi.tic();
  assert.equal(t.dernier().annonce.phase, 'avant', 'le bandeau, lui, prévient toujours');
  t.pub({ durationSeconds: 60, startDate: new Date(), isAutomatic: true });
  assert.equal(t.dernier().annonce.phase, 'pendant');
  assert.deepEqual(t.chat, []);
});

test('module : un seul interrupteur eteint ne coupe que son message', async () => {
  const t = contexte({
    planning: { nextAdDate: new Date(Date.now() + 30_000), duration: 60 },
    config: { chatAvantActif: false },
  });
  await manifeste.demarrer(t.ctx);
  t.ctx._suivi.tic();
  t.pub({ durationSeconds: 60, startDate: new Date(), isAutomatic: true });
  assert.deepEqual(t.chat, ['Pub en cours (1 min)']);
});

test('migration v2 : un message vide devient un interrupteur eteint', async () => {
  const { valeursParDefaut, migrer } = await import('../src/core/schema.js');
  const champs = manifeste.config.champs;
  const defauts = valeursParDefaut(champs);

  // Réglages d'un streamer en 0.18/0.19 qui avait vidé le message d'avant.
  const r = migrer({ ...defauts, chatAvant: '', chatPendant: 'Pub ! {duree}' }, 1, 2, manifeste.migrations);
  assert.equal(r.chatAvantActif, false);
  assert.equal(r.chatAvant, defauts.chatAvant, 'le texte revient, prêt à être rallumé');
  assert.equal(r.chatPendantActif, true);
  assert.equal(r.chatPendant, 'Pub ! {duree}', 'un message personnalisé est gardé');

  // Installation neuve : rien ne bouge.
  assert.deepEqual(migrer({ ...defauts }, 0, 2, manifeste.migrations), defauts);
});

test('module : chaine non affiliee (403) -> demarre, et la sante l explique', async () => {
  const t = contexte({ erreurPlanning: Object.assign(new Error('Forbidden'), { statusCode: 403 }) });
  await manifeste.demarrer(t.ctx);
  const [carte] = await manifeste.sante(t.ctx);
  assert.equal(carte.etat, 'attention');
  assert.match(carte.aide, /Affili/);
});

test('module : sans le droit, pas d abonnement mais la simulation marche', async () => {
  const t = contexte({ droits: [] });
  await manifeste.demarrer(t.ctx);
  assert.equal((await manifeste.sante(t.ctx))[0].etat, 'ko');
  const r = await manifeste.actions.simuler(t.ctx);
  assert.match(r.message, /Simulation/);
  assert.equal(t.dernier().annonce.phase, 'avant');
  assert.deepEqual(t.chat, []);
});

test('module arrete : Simuler le dit au lieu d echouer en silence', async () => {
  assert.equal((await manifeste.actions.simuler({})).ok, false);
});
