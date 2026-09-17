// Une session d'exemple, pour le bouton « Afficher un exemple » : de quoi placer
// le bandeau et le tableau de bord dans OBS sans lancer une partie.
//
// Six parties classees, d'Émeraude III 41 LP a Émeraude II 2 LP (+61 LP), avec
// une promotion a la derniere. Les rangs passent par l'echelle de rang.js : la
// courbe et les LP de l'exemple sont calcules exactement comme les vrais.

import { depuisEchelle } from './rang.js';

const MINUTE = 60_000;

// [championId, victoire, k, d, a, cs, duree (s), vision, participation, echelle apres]
const PARTIES = [
  [134, false, 3, 6, 4, 187, 1750, 26, 41, 2122], // Syndra
  [103, true, 8, 2, 11, 214, 1862, 31, 63, 2146], // Ahri
  [61, false, 2, 5, 8, 176, 1605, 22, 56, 2128], // Orianna
  [103, true, 6, 1, 9, 238, 1713, 34, 65, 2153], // Ahri
  [103, true, 11, 3, 7, 265, 2028, 38, 72, 2176], // Ahri
  [134, true, 9, 2, 12, 231, 1640, 29, 68, 2202], // Syndra
];
const DEPART = 2141; // Émeraude III 41 LP

// Les champions de l'exemple, pour qu'ils aient un nom meme quand Data Dragon
// n'a encore jamais repondu (premier lancement hors ligne).
export const CHAMPIONS_DEMO = {
  103: { cle: 'Ahri', nom: 'Ahri' },
  134: { cle: 'Syndra', nom: 'Syndra' },
  61: { cle: 'Orianna', nom: 'Orianna' },
};

export function sessionDemo(maintenant = Date.now()) {
  const parties = [];
  let avant = DEPART;
  // Les parties se terminent toutes les 35 minutes, la derniere il y a 5 minutes.
  PARTIES.forEach(([championId, victoire, k, d, a, cs, dureeS, vision, kp, apres], i) => {
    parties.push({
      id: -(i + 1),
      finA: maintenant - (PARTIES.length - 1 - i) * 35 * MINUTE - 5 * MINUTE,
      victoire,
      championId,
      k,
      d,
      a,
      cs,
      dureeS,
      vision,
      kp,
      lp: apres - avant,
      lpEnAttente: false,
      rangAvant: depuisEchelle(avant),
      rangApres: depuisEchelle(apres),
    });
    avant = apres;
  });

  return {
    parties,
    suivi: {
      clientOuvert: true,
      moi: { nom: 'Exemple', tag: 'DEMO' },
      phase: 'EndOfGame',
      rang: { ...depuisEchelle(avant), provisoire: false, placementsRestants: 0, placementsTotal: 0 },
    },
  };
}
