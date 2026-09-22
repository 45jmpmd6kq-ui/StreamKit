// Les notes de version, telles que le streamer les lit.
//
// Une seule source : NOUVEAUTES.md a la racine, une section par version,
// ecrite pour lui. Elle sert deux fois :
//
//   - a la publication, scripts/notes-de-version.mjs en extrait la section et
//     la met dans latest.yml (build.releaseInfo) et dans la release GitHub.
//     electron-updater la redonne au dashboard, qui ANNONCE la version
//     suivante avant de l'installer ;
//   - dans l'application elle-meme, pour dire au streamer ce qu'il vient
//     d'installer, sans reseau ni API -- c'est le « Quoi de neuf » au
//     redemarrage, le seul moment ou il lit vraiment.
//
// Le decoupage est fait ICI et pas dans le dashboard : les notes arrivent
// tantot en Markdown (latest.yml), tantot en HTML (le corps de la release, que
// GitHub rend en HTML). Une seule fonction pour les deux, et testee.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './paths.js';
import { versionActuelle } from './maj.js';

const FICHIER = join(RACINE, 'NOUVEAUTES.md');

// Les deux rubriques qu'on sait presenter ; le reste tombe dans « autres ».
const RUBRIQUES = [
  { cle: 'nouveautes', motif: /^#*\s*nouveau/i },
  { cle: 'corrections', motif: /^#*\s*(correction|corrig|r[ée]par)/i },
];

// GitHub rend le corps d'une release en HTML : « <ul><li>truc</li></ul> ».
// Affiche tel quel, le streamer verrait les balises ; injecte en innerHTML, ce
// serait du HTML venu d'une page web dans l'application. On en fait du texte.
export function enTexte(brut) {
  if (!brut) return '';
  return String(brut)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const nettoyerPoint = (ligne) =>
  ligne
    .replace(/^[-*•]\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Le texte d'une version -> { nouveautes, corrections, autres }, prêt à être
// affiché en listes. Un point peut tenir sur plusieurs lignes dans le fichier :
// elles sont recollees, sinon chaque retour a la ligne deviendrait une puce.
export function decouper(brut) {
  const blocs = { nouveautes: [], corrections: [], autres: [] };
  let courante = 'autres';

  for (const ligne of enTexte(brut).split('\n')) {
    const t = ligne.trim();
    if (!t) continue;

    const rubrique = t.length <= 40 && RUBRIQUES.find((r) => r.motif.test(t));
    if (rubrique) {
      courante = rubrique.cle;
      continue;
    }
    if (t.startsWith('#')) continue; // « ## 0.28.0 » et autres titres

    const liste = blocs[courante];
    // Une ligne qui ne commence pas par une puce est la suite de la precedente.
    if (/^[-*•]/.test(t) || !liste.length) liste.push(nettoyerPoint(t));
    else liste[liste.length - 1] += ' ' + nettoyerPoint(t);
  }
  return blocs;
}

export function vide(blocs) {
  return !blocs || !Object.values(blocs).some((l) => l.length);
}

// La section d'une version dans NOUVEAUTES.md, sans son titre.
export function sectionDe(texte, version) {
  const lignes = String(texte ?? '').split('\n');
  const titre = new RegExp('^##\\s+v?' + String(version).replace(/\./g, '\\.') + '\\s*$');
  const debut = lignes.findIndex((l) => titre.test(l.trim()));
  if (debut < 0) return '';

  const suite = lignes.slice(debut + 1);
  const fin = suite.findIndex((l) => /^##\s/.test(l));
  return (fin < 0 ? suite : suite.slice(0, fin)).join('\n').trim();
}

// Ce que cette version-ci apporte, lu dans le fichier embarque. Jamais une
// erreur : des notes manquantes ne doivent pas empecher le dashboard de
// s'afficher.
export function notesLocales(version = versionActuelle(), fichier = FICHIER) {
  try {
    return sectionDe(readFileSync(fichier, 'utf8'), version);
  } catch {
    return '';
  }
}
