// Tirage au sort d'une voiture (récompense « Random Car »).
//
// Le tirage est aleatoire : on ne teste donc pas une sortie precise, mais les
// INVARIANTS que le streamer remarquerait a l'antenne. Sur quatre voitures, le
// hasard pur donne vite l'impression d'un bug -- c'est exactement ce que ces
// deux reglages corrigent.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Roue } from '../src/modules/roue-rl/roue.js';

const voitures = (...slugs) => slugs.map((slug) => ({ slug, name: slug.toUpperCase() }));
const QUATRE = voitures('octane', 'fennec', 'dominus', 'merc');

test('sans voiture, il n y a rien a tirer', () => {
  assert.equal(new Roue().spin([]), null);
});

test('une seule voiture sort a chaque fois, malgre avoidRepeat', () => {
  // Cas limite reel : un streamer qui n'a coche qu'une voiture. Interdire la
  // repetition ne doit pas bloquer le tirage.
  const roue = new Roue({ avoidRepeat: true });
  const seule = voitures('octane');
  for (let i = 0; i < 5; i++) assert.equal(roue.spin(seule).slug, 'octane');
});

test('avoidRepeat interdit deux fois la meme voiture de suite', () => {
  const roue = new Roue({ avoidRepeat: true });
  let precedent = null;
  for (let i = 0; i < 200; i++) {
    const tire = roue.spin(QUATRE).slug;
    assert.notEqual(tire, precedent, 'la voiture du tirage precedent est ressortie');
    precedent = tire;
  }
});

test('sans avoidRepeat, la repetition finit par arriver', () => {
  // L'inverse doit rester possible : c'est un reglage, pas une regle.
  const roue = new Roue({ avoidRepeat: false });
  let repetition = false;
  let precedent = null;
  for (let i = 0; i < 400 && !repetition; i++) {
    const tire = roue.spin(QUATRE).slug;
    if (tire === precedent) repetition = true;
    precedent = tire;
  }
  assert.ok(repetition, 'sur 400 tirages parmi 4, une repetition doit survenir');
});

test('le sac fait passer toutes les voitures avant d en rejouer une', () => {
  const roue = new Roue({ noRepeatUntilExhausted: true });
  for (let passe = 0; passe < 20; passe++) {
    const tirage = QUATRE.map(() => roue.spin(QUATRE).slug);
    assert.equal(new Set(tirage).size, QUATRE.length, 'passe ' + passe + ' : ' + tirage.join(' '));
  }
});

test('le sac ne laisse pas la meme voiture a cheval sur deux passes', () => {
  // Sans precaution, la derniere voiture d'un sac peut ouvrir le suivant : deux
  // fois de suite a l'ecran, ce que le streamer lit comme un bug.
  const roue = new Roue({ avoidRepeat: true, noRepeatUntilExhausted: true });
  let precedent = null;
  for (let i = 0; i < 200; i++) {
    const tire = roue.spin(QUATRE).slug;
    assert.notEqual(tire, precedent, 'repetition a la jonction de deux sacs');
    precedent = tire;
  }
});

test('une voiture decochee en direct disparait du sac', () => {
  // Le streamer edite sa selection pendant le live : le sac est rempli, il
  // contient encore les voitures retirees.
  const roue = new Roue({ noRepeatUntilExhausted: true });
  roue.spin(QUATRE);

  const restantes = voitures('octane', 'fennec');
  for (let i = 0; i < 30; i++) {
    const tire = roue.spin(restantes).slug;
    assert.ok(
      restantes.some((c) => c.slug === tire),
      'une voiture retiree du catalogue est ressortie : ' + tire
    );
  }
});

test('une voiture ajoutee en direct entre dans le tirage', () => {
  const roue = new Roue({ noRepeatUntilExhausted: true });
  roue.spin(voitures('octane', 'fennec'));

  const elargi = QUATRE;
  const vues = new Set();
  for (let i = 0; i < 60; i++) vues.add(roue.spin(elargi).slug);
  assert.equal(vues.size, elargi.length, 'toutes les voitures doivent finir par sortir');
});

test('reset repart d une page blanche', () => {
  const roue = new Roue({ avoidRepeat: true, noRepeatUntilExhausted: true });
  roue.spin(QUATRE);
  roue.reset();

  assert.equal(roue.last, null);
  assert.deepEqual(roue.bag, []);
});
