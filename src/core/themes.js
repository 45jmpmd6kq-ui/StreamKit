// Themes d'overlay : un habillage commun a tous les overlays du streamer.
//
// Un theme ne change QUE l'habillage -- fond, couleurs d'accent, polices,
// arrondis, ombres et lueurs. La disposition des overlays reste la leur.
// Les couleurs qui portent un sens restent celles du module : victoire et
// defaite, couleurs de rang, couleur du club FC, equipes bleu et rose des
// predictions, temperatures de Rocket League.
//
// Mecanique (detail dans src/commun/themes/LISEZ-MOI.md) :
//   - le serveur pose sur chaque overlay la feuille du theme choisi
//     (/commun/themes/<id>.css) et la classe sk-theme-<id> sur <html> ;
//   - cette feuille definit des jetons --sk-* ; chaque overlay les lit avec SES
//     valeurs d'origine en repli : var(--sk-encre, 242, 244, 247) ;
//   - « Standard esport » ne definit aucun jeton : chaque overlay garde
//     exactement le rendu qu'il avait avant les themes ;
//   - un changement part sur le canal « themes » : les overlays ouverts dans
//     OBS changent de feuille sur-le-champ (src/commun/theme.js).

import { getConfig, sauverConfig } from './store.js';
import * as diffusion from './diffusion.js';
import * as journal from './journal.js';

const log = journal.pour('themes');

export const CANAL = 'themes';
export const THEME_PAR_DEFAUT = 'standard';

// L'ordre est celui de la page Personnalisation.
export const THEMES = [
  {
    id: 'standard',
    nom: 'Standard esport',
    description:
      'Le style d’origine de chaque overlay StreamKit : panneaux sombres, police Bahnschrift, couleurs propres à chaque module.',
  },
  {
    id: 'esport',
    nom: 'Esport',
    description:
      'Rendu de tournoi : panneaux nuit à coins coupés, liseré cyan, police technique en capitales.',
  },
  {
    id: 'neon',
    nom: 'Néon',
    description:
      'Synthwave : verre sombre, contours lumineux magenta, titres en italique qui grésillent, dégradé magenta → cyan.',
  },
  {
    id: 'minimal',
    nom: 'Minimal clair',
    description:
      'Cartes blanches givrées, ombre douce, un seul accent bleu. Discret, laisse toute la place au jeu.',
  },
  {
    id: 'arcade',
    nom: 'Rétro arcade',
    description:
      'Borne 8 bits : cadres pixel blanc sur noir, police pixel, barres en segments, curseur qui clignote.',
  },
];

const IDS = new Set(THEMES.map((t) => t.id));

export function existe(id) {
  return IDS.has(id);
}

// Le theme en vigueur. Un identifiant inconnu (config.json retouche a la main,
// theme retire dans une version future) retombe sur Standard plutot que de
// laisser les overlays sans feuille.
export function actuel() {
  const id = getConfig().apparence?.theme;
  return existe(id) ? id : THEME_PAR_DEFAUT;
}

export function liste() {
  return { actuel: actuel(), themes: THEMES };
}

export function choisir(id) {
  if (!existe(id)) return { ok: false, erreur: 'thème inconnu' };
  const c = getConfig();
  if (c.apparence?.theme !== id) {
    c.apparence = { ...c.apparence, theme: id };
    sauverConfig(c);
    log.info('Thème des overlays : ' + id);
  }
  annoncer();
  return { ok: true, actuel: id };
}

// Pousse le theme courant aux overlays ouverts. Envoye en « etat » : c'est ce
// que le canal memorise, et ce qu'une source OBS qui se reconnecte recoit
// d'emblee -- y compris apres un changement fait pendant qu'elle etait coupee.
export function annoncer() {
  diffusion.diffuser(CANAL, 'etat', { theme: actuel() });
}

// Le canal ne connait le theme qu'apres une premiere annonce : sans elle, le
// premier overlay connecte n'aurait recu aucun etat. Appele a chaque ouverture
// du flux des themes, n'annonce qu'une fois par demarrage.
let amorce = false;
export function amorcer() {
  if (amorce) return;
  amorce = true;
  annoncer();
}
