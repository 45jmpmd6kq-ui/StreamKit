// Tirage au sort d'une voiture.
//
// Deux reglages qui changent le ressenti a l'antenne :
//  - avoidRepeat : ne jamais retomber sur la voiture du tirage precedent
//    (sur 3-4 voitures possedees, le hasard pur donne vite l'impression d'un bug) ;
//  - noRepeatUntilExhausted : parcourir toutes les voitures avant qu'une
//    puisse ressortir (mode "sac de tirage", plus equitable sur une longue session).

import { randomInt } from 'node:crypto';

export class Roue {
  constructor({ avoidRepeat = true, noRepeatUntilExhausted = false } = {}) {
    this.avoidRepeat = avoidRepeat;
    this.noRepeatUntilExhausted = noRepeatUntilExhausted;
    this.last = null;
    this.bag = [];
  }

  // `cars` est relu a chaque tirage : le streamer peut editer cars.json en live.
  spin(cars) {
    if (!cars.length) return null;
    if (cars.length === 1) {
      this.last = cars[0].slug;
      return cars[0];
    }

    const pick = this.noRepeatUntilExhausted ? this.#fromBag(cars) : this.#uniform(cars);
    this.last = pick.slug;
    return pick;
  }

  #uniform(cars) {
    const pool = this.avoidRepeat ? cars.filter((c) => c.slug !== this.last) : cars;
    const usable = pool.length ? pool : cars;
    return usable[randomInt(usable.length)];
  }

  #fromBag(cars) {
    const valid = new Set(cars.map((c) => c.slug));
    // Le sac est purge des voitures retirees depuis le dernier remplissage.
    this.bag = this.bag.filter((slug) => valid.has(slug));
    if (!this.bag.length) {
      this.bag = cars.map((c) => c.slug);
      // Evite que la derniere voiture du sac precedent ouvre le suivant.
      if (this.avoidRepeat && this.bag.length > 1) {
        this.bag = this.bag.filter((slug) => slug !== this.last);
        this.bag.push(this.last);
      }
    }
    const idx =
      this.avoidRepeat && this.bag.length > 1 ? randomInt(this.bag.length - 1) : randomInt(this.bag.length);
    const [slug] = this.bag.splice(idx, 1);
    return cars.find((c) => c.slug === slug);
  }

  reset() {
    this.last = null;
    this.bag = [];
  }
}
