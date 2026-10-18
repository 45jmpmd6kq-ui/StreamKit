import test from 'node:test';
import assert from 'node:assert/strict';
import { ajouter, corriger, depuisEvenement, vue } from '../src/modules/subgoal/subgoal.js';
import manifeste from '../src/modules/subgoal/module.js';

// --- Logique ------------------------------------------------------------------

test('un lot de subs offerts compte son nombre, quel que soit le palier', () => {
  for (const tier of ['1000', '2000', '3000']) {
    const lot = depuisEvenement({ amount: 5, tier, gifterDisplayName: 'Kaykay_RL', isAnonymous: false });
    assert.deepEqual(lot, { nombre: 5, gifteur: 'Kaykay_RL' });
  }
});

test('un gift anonyme n a pas de gifteur', () => {
  assert.equal(
    depuisEvenement({ amount: 1, isAnonymous: true, gifterDisplayName: 'AnAnonymousGifter' }).gifteur,
    null
  );
});

test('le compteur continue au-dela de l objectif', () => {
  let m = { compte: 48, dernier: null };
  m = ajouter(m, { nombre: 4, gifteur: 'A' }, 1);
  const v = vue({ objectif: ' Arc Qiyana ', cible: 50, afficherDernier: true }, m);
  assert.equal(v.compte, 52);
  assert.equal(v.pourcent, 100);
  assert.equal(v.atteint, true);
  assert.equal(v.reste, 0);
  assert.equal(v.objectif, 'Arc Qiyana');
  assert.deepEqual(v.dernier, { gifteur: 'A', nombre: 4, a: 1 });
});

test('correction a la main : jamais sous zero', () => {
  assert.equal(corriger({ compte: 0 }, -1).compte, 0);
  assert.equal(corriger({ compte: 3 }, +1).compte, 4);
});

test('dernier gifteur masque quand le reglage est coupe', () => {
  const v = vue(
    { objectif: 'X', cible: 10, afficherDernier: false },
    { compte: 3, dernier: { gifteur: 'A', nombre: 3 } }
  );
  assert.equal(v.dernier, null);
  assert.equal(v.reste, 7);
});

// --- Module -------------------------------------------------------------------

function contexte({ droits = ['channel:read:subscriptions'], memoire } = {}) {
  let stocke = memoire ?? null;
  const etats = [];
  const compteurs = {};
  const handlers = {};
  const ctx = {
    config: {
      objectif: 'Arc Qiyana',
      cible: 10,
      afficherDernier: true,
      accent1: '#9146ff',
      accent2: '#ffb400',
      opaciteFond: 92,
      coin: 'bottom-right',
    },
    log: { debug() {}, info() {}, ok() {}, warn() {}, err() {} },
    overlay: { etat: (vue, d) => etats.push(d), url: () => 'http://127.0.0.1/overlay/subgoal/carte' },
    etat: { lire: (d) => stocke ?? d, sauver: (v) => (stocke = v) },
    compteur: { incr: (k, n = 1) => (compteurs[k] = (compteurs[k] ?? 0) + n) },
    activite() {},
    minuteur: { delai: (fn, ms) => setTimeout(fn, ms) },
    twitch: {
      aLeDroit: (d) => droits.includes(d),
      surSubgifts: (fn) => (handlers.gift = fn),
    },
  };
  return { ctx, etats, compteurs, handlers, dernier: () => etats.at(-1)?.goal, stocke: () => stocke };
}

test('module : seuls les subgifts avancent la barre, et le compte est garde', async () => {
  const t = contexte({ memoire: { compte: 2, dernier: null } });
  const arret = await manifeste.demarrer(t.ctx);
  assert.equal(t.dernier().compte, 2);
  assert.equal(t.etats[0].theme.accent1, '#9146ff');
  // Le module n'ecoute que channel.subscription.gift : pas de surAbonnement.
  t.handlers.gift({ amount: 5, tier: '2000', gifterDisplayName: 'Kaykay_RL', isAnonymous: false });
  assert.equal(t.dernier().compte, 7);
  assert.equal(t.stocke().compte, 7);
  assert.deepEqual(t.compteurs, { subgifts: 5 });
  await arret.arreter();
  assert.equal(t.dernier(), null, 'carte retiree a l arret');
});

test('boutons : ➕ ➖ et remise a zero, module arrete aussi', async () => {
  const t = contexte({ memoire: { compte: 1, dernier: null } });
  await manifeste.actions.ajouter(t.ctx);
  assert.equal(t.stocke().compte, 2);
  await manifeste.actions.retirer(t.ctx);
  await manifeste.actions.retirer(t.ctx);
  await manifeste.actions.retirer(t.ctx);
  assert.equal(t.stocke().compte, 0);
  await manifeste.actions.ajouter(t.ctx);
  await manifeste.actions.remettreAZero(t.ctx);
  assert.deepEqual(t.stocke(), { compte: 0, dernier: null });
});

test('simulation : la carte montre +5, le vrai compteur ne bouge pas', async () => {
  const t = contexte({ memoire: { compte: 3, dernier: null } });
  const arret = await manifeste.demarrer(t.ctx);
  await manifeste.actions.simuler(t.ctx);
  assert.equal(t.dernier().compte, 8);
  assert.equal(t.stocke().compte, 3);
  await arret.arreter();
});

test('sans le droit des subs : le module previent, rien n est branche', async () => {
  const t = contexte({ droits: [] });
  await manifeste.demarrer(t.ctx);
  assert.equal(t.handlers.gift, undefined);
  const [s] = await manifeste.sante(t.ctx);
  assert.equal(s.etat, 'ko');
});

test('reglages : objectif requis, couleurs reglables', () => {
  const champs = Object.fromEntries(manifeste.config.champs.map((c) => [c.cle, c]));
  assert.equal(champs.objectif.requis, true);
  assert.equal(champs.accent1.type, 'couleur');
  assert.equal(champs.accent2.type, 'couleur');
  assert.deepEqual(manifeste.scopes, ['channel:read:subscriptions']);
});

test('style : carte par defaut, barre en option, transmis a l overlay', async () => {
  const style = manifeste.config.champs.find((c) => c.cle === 'style');
  assert.equal(style.defaut, 'carte');
  assert.equal(style.aVenir, undefined, 'le choix est ouvert');
  assert.deepEqual(
    style.options.map((o) => o.valeur),
    ['carte', 'barre']
  );
  const t = contexte();
  t.ctx.config.style = 'barre';
  const arret = await manifeste.demarrer(t.ctx);
  assert.equal(t.etats[0].theme.style, 'barre');
  await arret.arreter();
});
