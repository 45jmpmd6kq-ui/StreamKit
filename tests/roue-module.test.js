// Random Car branche de bout en bout, avec un faux Twitch.
//
// Retours du 19/09/2026 : « ça n'a pas mis le nombre de points indiqué dans
// StreamKit et l'overlay n'apparaît pas ». On verifie ce que le module envoie a
// Twitch, ce que la vue d'ensemble en dit, et que le journal signale un tirage
// que personne ne voit.

import test from 'node:test';
import assert from 'node:assert/strict';

import manifeste from '../src/modules/roue-rl/module.js';
import { valeursParDefaut } from '../src/core/schema.js';

function contexte({ reglages = {}, possedees = [], sources = 1 } = {}) {
  const lignes = [];
  const diffusions = [];
  const recompenses = new Map();
  const demandes = [];
  const ctx = {
    config: { ...valeursParDefaut(manifeste.config.champs), ...reglages },
    log: Object.fromEntries(
      ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => lignes.push([n, m])])
    ),
    etat: { lire: () => ({ possedees }), sauver() {} },
    twitch: {
      // Comme le socle : la recompense porte ce que le module a demande.
      assurerRecompense: async (voulue) => {
        demandes.push(voulue);
        return { id: 'roue', titre: voulue.titre, cout: voulue.cout, creee: false, changements: [] };
      },
      surRecompense: (id, fn) => recompenses.set(id, fn),
      statutRedemption: async () => {},
      dire: () => {},
    },
    overlay: {
      etat() {},
      diffuser: (vue, type, data) => diffusions.push({ vue, type, data }),
      nbSources: () => sources,
      url: (vue) => 'http://127.0.0.1:47455/overlay/roue-rl/' + vue,
    },
    compteur: { incr() {} },
    minuteur: { delai() {}, intervalle() {} },
  };
  return {
    ctx,
    demandes,
    diffusions,
    avertissements: () => lignes.filter(([n]) => n === 'warn').map(([, m]) => m),
    utiliser: (qui) => recompenses.get('roue')({ userDisplayName: qui }),
  };
}

test('la recompense demandee a Twitch porte les reglages du module', async () => {
  const b = contexte({ reglages: { rewardCost: 1500, rewardCooldownSec: 120 }, possedees: ['Octane'] });
  await manifeste.demarrer(b.ctx);

  const [voulue] = b.demandes;
  assert.equal(voulue.titre, '🚗 Random Car');
  assert.equal(voulue.cout, 1500);
  assert.equal(voulue.cooldownSec, 120);
  assert.equal(voulue.saisieRequise, false);
});

test('vue d ensemble : le cout reel et le nombre de voitures', async () => {
  const b = contexte({ reglages: { rewardCost: 1500 }, possedees: ['Octane', 'Fennec', 'Dominus'] });
  await manifeste.demarrer(b.ctx);

  const [ligne] = await manifeste.sante(b.ctx);
  assert.equal(ligne.etat, 'ok');
  assert.match(ligne.detail, /« 🚗 Random Car » à 1\s500 points · 3 voiture\(s\)/);
});

test('vue d ensemble : aucune voiture cochee se voit avant le live', async () => {
  // Sans voiture, chaque utilisation est remboursee et rien ne s'affiche :
  // exactement « l'overlay n'apparait pas ».
  const b = contexte({ possedees: [] });
  await manifeste.demarrer(b.ctx);

  const [ligne] = await manifeste.sante(b.ctx);
  assert.equal(ligne.etat, 'attention');
  assert.match(ligne.aide, /Mes voitures/);
});

test('module au repos : rien a signaler', async () => {
  const [ligne] = await manifeste.sante({});
  assert.equal(ligne.etat, 'inactif');
});

test('un tirage sans source OBS est signale au journal', async () => {
  const b = contexte({ possedees: ['Octane'], sources: 0 });
  await manifeste.demarrer(b.ctx);
  await b.utiliser('Viewer');

  assert.equal(b.diffusions.filter((d) => d.type === 'spin').length, 1, 'le tirage part quand meme');
  assert.match(
    b.avertissements().join('\n'),
    /Aucune source OBS n’affiche la machine à sous : ajoute http:\/\/127\.0\.0\.1:47455\/overlay\/roue-rl\/roue/
  );
});

test('avec une source OBS branchee, pas d avertissement', async () => {
  const b = contexte({ possedees: ['Octane'], sources: 1 });
  await manifeste.demarrer(b.ctx);
  await b.utiliser('Viewer');
  assert.deepEqual(b.avertissements(), []);
});

test('le tirage de test dit aussi qu aucune source n affiche la machine', async () => {
  const b = contexte({ possedees: ['Octane'], sources: 0 });
  await manifeste.demarrer(b.ctx);
  const r = await manifeste.actions.tirageDeTest(b.ctx);
  assert.match(r.message, /^Tirage lancé : Octane — mais aucune source OBS n’affiche la machine à sous\.$/);
});
