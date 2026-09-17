// Rangs League of Legends et echelle de LP.
//
// L'echelle decide des LP affiches apres chaque partie : une erreur ici, et le
// bandeau annonce « -74 LP » a la premiere promotion.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  depuisEchelle,
  echelle,
  evolution,
  extraireRang,
  nomRang,
  seuilsEntre,
} from '../src/modules/lol-session/rang.js';

const rang = (palier, division, lp) => ({ palier, division, lp });

test('une promotion donne les LP reellement gagnes', () => {
  // Émeraude III 76 LP -> victoire +26 -> Émeraude II 2 LP.
  assert.equal(echelle(rang('EMERALD', 'III', 76)), 2176);
  assert.equal(echelle(rang('EMERALD', 'II', 2)), 2202);
  assert.equal(echelle(rang('EMERALD', 'II', 2)) - echelle(rang('EMERALD', 'III', 76)), 26);
});

test('changer de palier est continu : Diamant I 75 LP, puis Maitre 0 LP', () => {
  assert.equal(echelle(rang('DIAMOND', 'I', 75)), 2775);
  assert.equal(echelle(rang('MASTER', '', 0)), 2800);
  // Grand Maitre et Challenger ne sont que des seuils sur l'echelle de Maitre.
  assert.equal(echelle(rang('GRANDMASTER', '', 350)), 3150);
  assert.equal(echelle(rang('CHALLENGER', 'I', 1200)), 4000);
});

test('sans palier, pas de position sur l echelle', () => {
  assert.equal(echelle(null), null);
  assert.equal(echelle(rang('', '', 0)), null);
  assert.equal(echelle(rang('GOLD', '', 50)), null, 'division manquante sous Maitre');
});

test('le rang est lu dans queueMap, ou a defaut dans queues', () => {
  const entree = {
    queueType: 'RANKED_SOLO_5x5',
    tier: 'EMERALD',
    division: 'II',
    leaguePoints: 2,
    isProvisional: false,
  };
  const attendu = {
    palier: 'EMERALD',
    division: 'II',
    lp: 2,
    provisoire: false,
    placementsRestants: 0,
    placementsTotal: 0,
  };
  assert.deepEqual(extraireRang({ queueMap: { RANKED_SOLO_5x5: entree } }, 'RANKED_SOLO_5x5'), attendu);
  assert.deepEqual(extraireRang({ queues: [entree] }, 'RANKED_SOLO_5x5'), attendu);
  assert.equal(extraireRang({ queueMap: { RANKED_SOLO_5x5: entree } }, 'RANKED_FLEX_SR'), null);
});

test('un palier inconnu ne plante pas : non classe', () => {
  const stats = (tier, division = 'I') => ({ queueMap: { RANKED_SOLO_5x5: { tier, division } } });
  assert.equal(extraireRang(stats('NONE', 'NA'), 'RANKED_SOLO_5x5').palier, '');
  assert.equal(extraireRang(stats('OBSIDIAN'), 'RANKED_SOLO_5x5').palier, '');
  // Le client donne « I » a Maitre et au-dela : il n'y a pas de division.
  assert.equal(extraireRang(stats('MASTER', 'I'), 'RANKED_SOLO_5x5').division, '');
});

test('noms francais des rangs', () => {
  assert.equal(nomRang(rang('EMERALD', 'II', 2)), 'Émeraude II');
  assert.equal(nomRang(rang('SILVER', 'IV', 0)), 'Argent IV');
  assert.equal(nomRang(rang('MASTER', '', 10)), 'Maître');
  assert.equal(nomRang(rang('GRANDMASTER', '', 400)), 'Grand Maître');
  assert.equal(nomRang({ palier: '', provisoire: false }), 'Non classé');
  assert.equal(nomRang({ palier: '', provisoire: true }), 'Placements');
});

test('promotion et relegation se jugent a la division, pas aux LP', () => {
  assert.equal(evolution(rang('EMERALD', 'III', 76), rang('EMERALD', 'II', 2)), 'promu');
  assert.equal(evolution(rang('DIAMOND', 'I', 90), rang('MASTER', '', 5)), 'promu');
  assert.equal(evolution(rang('GOLD', 'IV', 5), rang('SILVER', 'I', 75)), 'retrograde');
  assert.equal(evolution(rang('GOLD', 'II', 10), rang('GOLD', 'II', 60)), null);
  assert.equal(evolution(null, rang('GOLD', 'II', 60)), null);
});

test('echelle et rang se retrouvent', () => {
  for (const r of [rang('IRON', 'IV', 0), rang('EMERALD', 'III', 41), rang('DIAMOND', 'I', 99)]) {
    assert.deepEqual(depuisEchelle(echelle(r)), r);
  }
  assert.deepEqual(depuisEchelle(3150), { palier: 'MASTER', division: '', lp: 350 });
});

test('seuils de division franchis sur une courbe', () => {
  assert.deepEqual(seuilsEntre(2141, 2202), [{ valeur: 2200, nom: 'Émeraude II' }]);
  assert.deepEqual(seuilsEntre(2380, 2420), [{ valeur: 2400, nom: 'Diamant IV' }]);
  assert.deepEqual(seuilsEntre(2210, 2290), []);
  // Au-dela de Maitre, plus de division : un seul seuil, celui de Maitre.
  assert.deepEqual(
    seuilsEntre(2760, 3100).map((s) => s.nom),
    ['Maître']
  );
});
