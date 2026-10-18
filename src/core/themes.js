// Themes d'overlay : l'habillage des overlays TWITCH du streamer.
//
// Seuls les overlays des modules Twitch (categorie « twitch » : Bot Musique,
// Sondages, Predictions, Pub, Clips) se personnalisent -- choix du user le
// 18/10/2026. Les overlays des jeux (LoL, Rocket League, Valorant, EA FC)
// gardent leur style d'origine : le serveur ne leur pose aucun theme.
//
// Un theme ne change QUE l'habillage -- fond, couleurs d'accent, polices,
// arrondis, ombres et lueurs. La disposition des overlays reste la leur, et
// les couleurs qui portent un sens restent celles du module (equipes bleu et
// rose des predictions, couleurs des choix d'un sondage). Le Neon a en plus sa
// palette, choisie par le streamer.
//
// Mecanique (detail dans src/commun/themes/LISEZ-MOI.md) :
//   - le serveur pose sur chaque overlay Twitch la feuille du theme
//     (/commun/themes/<id>.css), data-sk-theme sur <html>, et les couleurs du
//     Neon en variables (--sk-neon-*) ;
//   - cette feuille definit des jetons --sk-* ; chaque overlay les lit avec SES
//     valeurs d'origine en repli : var(--sk-encre, 242, 244, 247) ;
//   - « Standard esport » ne definit aucun jeton : chaque overlay garde
//     exactement le rendu qu'il avait avant les themes ;
//   - un changement part sur le canal « themes » : les overlays ouverts dans
//     OBS changent de feuille sur-le-champ (src/commun/theme.js).

import { getConfig, sauverConfig } from './store.js';
import { resoudre } from './categories.js';
import * as diffusion from './diffusion.js';
import * as journal from './journal.js';

const log = journal.pour('themes');

export const CANAL = 'themes';

// En suspens (choix du user le 18/10/2026) : la page Personnalisation est
// floutee avec la mention « à venir », et aucun overlay ne recoit de theme --
// exactement le rendu d'avant les themes, quel que soit le reglage enregistre.
// STREAMKIT_THEMES=1 la rouvre (developpement, tests). Pour la rouvrir a tous,
// renvoyer true ici.
export function disponible() {
  return process.env.STREAMKIT_THEMES === '1';
}
export const THEME_PAR_DEFAUT = 'standard';

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
      'Synthwave : verre sombre, contours lumineux, titres en italique qui grésillent. Les deux couleurs se choisissent.',
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

// Couples de couleurs proposes pour le Neon : la principale (contours,
// lueurs), la secondaire (pseudos, chiffres forts, fin du degrade).
export const PALETTES_NEON = [
  { nom: 'Synthwave', principale: '#ff3df2', secondaire: '#3df5ff' },
  { nom: 'Cyber', principale: '#3df5ff', secondaire: '#ff3df2' },
  { nom: 'Toxique', principale: '#7dff3d', secondaire: '#f5ff3d' },
  { nom: 'Braise', principale: '#ff6a3d', secondaire: '#ffd23d' },
  { nom: 'Électrique', principale: '#3d6bff', secondaire: '#b93dff' },
  { nom: 'Sakura', principale: '#ff4f9a', secondaire: '#ffb3d9' },
  { nom: 'Glace', principale: '#a8f0ff', secondaire: '#ffffff' },
  { nom: 'Sang', principale: '#ff2d3d', secondaire: '#ff9a3d' },
];
const NEON_PAR_DEFAUT = { principale: PALETTES_NEON[0].principale, secondaire: PALETTES_NEON[0].secondaire };

const IDS = new Set(THEMES.map((t) => t.id));
const COULEUR = /^#[0-9a-f]{6}$/i;

export function existe(id) {
  return IDS.has(id);
}

function apparence() {
  return getConfig().apparence ?? {};
}

// Le theme des overlays Twitch. Un identifiant inconnu (config.json retouche a
// la main, theme retire dans une version future) retombe sur Standard plutot
// que de laisser les overlays sans feuille.
export function actuel() {
  const id = apparence().theme;
  return existe(id) ? id : THEME_PAR_DEFAUT;
}

// Seuls les modules Twitch se personnalisent.
export function personnalisable(manifeste) {
  return disponible() && resoudre(manifeste?.categorie).id === 'twitch';
}

export function neon() {
  const n = apparence().neon ?? {};
  return {
    principale: COULEUR.test(n.principale) ? n.principale.toLowerCase() : NEON_PAR_DEFAUT.principale,
    secondaire: COULEUR.test(n.secondaire) ? n.secondaire.toLowerCase() : NEON_PAR_DEFAUT.secondaire,
  };
}

// --- Couleurs du Neon en variables CSS ---------------------------------------
//
// neon.css lit --sk-neon-* (avec ses couleurs d'origine en repli). On les
// calcule ici plutot qu'en CSS : color-mix() n'existe pas dans le navigateur
// des OBS d'avant la 31, et une lueur a besoin du triplet « r, g, b ».
// Les autres themes ne lisent pas ces variables : on peut les poser partout.

const rvb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const melange = (a, b, part) => a.map((v, i) => Math.round(v * (1 - part) + b[i] * part));

export function variablesNeon(n = neon()) {
  const p = rvb(n.principale);
  const s = rvb(n.secondaire);
  return {
    '--sk-neon-1': n.principale,
    '--sk-neon-1-rvb': p.join(', '),
    '--sk-neon-2': n.secondaire,
    '--sk-neon-2-rvb': s.join(', '),
    // Le verre : la principale tres assombrie, pour que le fond en garde la teinte.
    '--sk-neon-fond-rvb': melange([6, 4, 12], p, 0.08).join(', '),
    // Le texte : un blanc a peine teinte ; le texte secondaire, plus teinte.
    '--sk-neon-encre': melange([255, 255, 255], p, 0.08).join(', '),
    '--sk-neon-attenue': 'rgb(' + melange([200, 196, 210], p, 0.25).join(', ') + ')',
  };
}

export function styleNeon() {
  return Object.entries(variablesNeon())
    .map(([k, v]) => k + ': ' + v)
    .join('; ');
}

// --- Lecture et reglage --------------------------------------------------------

export function liste() {
  return {
    disponible: disponible(),
    actuel: actuel(),
    neon: neon(),
    themes: THEMES,
    palettesNeon: PALETTES_NEON,
  };
}

export function choisir(theme) {
  if (!disponible()) return { ok: false, erreur: 'personnalisation à venir' };
  if (!existe(theme)) return { ok: false, erreur: 'thème inconnu' };
  const c = getConfig();
  if (c.apparence?.theme !== theme) {
    c.apparence = { ...c.apparence, theme };
    sauverConfig(c);
    log.info('Thème des overlays Twitch : ' + theme);
  }
  annoncer();
  return { ok: true, ...liste() };
}

export function choisirNeon({ principale, secondaire }) {
  if (!disponible()) return { ok: false, erreur: 'personnalisation à venir' };
  if (!COULEUR.test(principale) || !COULEUR.test(secondaire))
    return { ok: false, erreur: 'couleur invalide' };
  const c = getConfig();
  c.apparence = {
    ...c.apparence,
    neon: { principale: principale.toLowerCase(), secondaire: secondaire.toLowerCase() },
  };
  sauverConfig(c);
  annoncer();
  return { ok: true, ...liste() };
}

// Pousse les reglages aux overlays ouverts. Envoye en « etat » : c'est ce que
// le canal memorise, et ce qu'une source OBS qui se reconnecte recoit d'emblee
// -- y compris apres un changement fait pendant qu'elle etait coupee.
export function annoncer() {
  diffusion.diffuser(CANAL, 'etat', { theme: actuel(), neon: variablesNeon() });
}

// Le canal ne connait les themes qu'apres une premiere annonce : sans elle, le
// premier overlay connecte n'aurait recu aucun etat. Appele a chaque ouverture
// du flux des themes, n'annonce qu'une fois par demarrage.
let amorce = false;
export function amorcer() {
  if (amorce) return;
  amorce = true;
  annoncer();
}
