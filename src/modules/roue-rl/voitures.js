// Catalogue des carrosseries Rocket League, et selection du streamer.
//
// Deux choses distinctes :
//   - le CATALOGUE : les 137 voitures connues (nom + icone), fige, livre avec
//     le module dans overlay/cars/manifest.json ;
//   - la SELECTION : ce que le streamer possede reellement, coche dans la page
//     « Mes voitures » et rangee dans l'etat persistant du module.
//
// Difference avec la version autonome : la selection ne vit plus dans un
// cars.json a la racine du projet, mais dans ctx.etat — donc dans les donnees
// du streamer, jamais touchees par une mise a jour.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ICI = dirname(fileURLToPath(import.meta.url));
const MANIFESTE = join(ICI, 'overlay', 'cars', 'manifest.json');

// Voitures offertes a tout le monde : elles n'apparaissent pas forcement dans
// un inventaire, alors qu'elles sont bien jouables. On les propose d'office.
export const VOITURES_DE_BASE = [
  'Backfire',
  'Breakout',
  'Gizmo',
  'Hotshot',
  'Merc',
  'Octane',
  'Paladin',
  'Road Hog',
  'Venom',
  'X-Devil',
];

// Le catalogue est relu si le fichier a change sur le disque : regenerer les
// icones pendant que StreamKit tourne ne doit pas laisser une liste perimee.
let cache = null;
let cacheMtime = 0;

export function catalogue() {
  if (!existsSync(MANIFESTE)) {
    throw new Error(
      "le catalogue des voitures est introuvable (overlay/cars/manifest.json). " +
        "Le dossier a du etre supprime : reinstalle StreamKit."
    );
  }
  const mtime = statSync(MANIFESTE).mtimeMs;
  if (!cache || mtime !== cacheMtime) {
    cache = JSON.parse(readFileSync(MANIFESTE, 'utf8'));
    cacheMtime = mtime;
  }
  return cache;
}

// Normalisation permissive : la casse, les accents, les apostrophes
// typographiques et la ponctuation varient selon la facon dont un nom est saisi
// ou recopie (« X Devil » / « X-Devil », « 007's » / « 007s »).
export function normaliser(nom) {
  return String(nom)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Retrouve une voiture a partir d'un nom libre. Renvoie null si rien ne
// correspond : mieux vaut signaler l'ecart que deviner de travers.
export function trouver(nom) {
  const cible = normaliser(nom);
  if (!cible) return null;
  return catalogue().find((c) => normaliser(c.name) === cible) || null;
}

// Resout les noms possedes en entrees du catalogue. Les noms inconnus sont
// ecartes et remontes a part, pour pouvoir les signaler au streamer.
export function resoudre(nomsPossedes = []) {
  const voitures = [];
  const inconnues = [];
  const vues = new Set();

  for (const nom of nomsPossedes) {
    const v = trouver(nom);
    if (!v) {
      inconnues.push(nom);
      continue;
    }
    if (vues.has(v.slug)) continue;
    vues.add(v.slug);
    voitures.push(v);
  }

  voitures.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { voitures, inconnues };
}

// Nettoie une selection avant de la ranger : noms resolus au libelle officiel,
// doublons retires, ordre stable.
export function nettoyer(noms = []) {
  const propre = [];
  const vues = new Set();
  for (const nom of noms) {
    const v = trouver(nom);
    const label = v ? v.name : String(nom).trim();
    if (!label || vues.has(label)) continue;
    vues.add(label);
    propre.push(label);
  }
  propre.sort((a, b) => a.localeCompare(b, 'fr'));
  return propre;
}
