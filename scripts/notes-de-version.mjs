// Extrait de NOUVEAUTES.md la section de la version en cours et l'ecrit dans
// notes-version.md :
//
//   node scripts/notes-de-version.mjs            (npm run dist)
//   node scripts/notes-de-version.mjs --exiger   (npm run publier)
//
// electron-builder recopie ce fichier dans latest.yml
// (build.releaseInfo.releaseNotesFile), et c'est de la que le streamer les lit
// dans sa fenetre de mise a jour : electron-updater ne va chercher le corps de
// la release GitHub que si latest.yml n'en porte pas (GitHubProvider, « if
// result.releaseNotes == null »). Le meme texte sert de corps a la release.
//
// Sans section pour la version publiee, --exiger arrete tout : une version qui
// s'annonce sans dire ce qu'elle change n'apprend rien au streamer, et c'est
// exactement le moment ou il lit.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sectionDe } from '../src/core/notes.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(RACINE, 'NOUVEAUTES.md');
const SORTIE = join(RACINE, 'notes-version.md');
const exiger = process.argv.includes('--exiger');

const version = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).version;
const section = sectionDe(readFileSync(SOURCE, 'utf8'), version);

if (!section) {
  const message =
    'NOUVEAUTES.md n’a pas de section « ## ' + version + ' » : cette version ne dirait rien au streamer.';
  if (exiger) {
    console.error('✖ ' + message + '\n  Publication arrêtée — écris la section, puis relance.');
    process.exit(1);
  }
  console.warn('⚠ ' + message);
}

// Toujours un fichier NON VIDE : des notes vides dans latest.yml empecheraient
// electron-updater de retomber sur le corps de la release.
writeFileSync(SORTIE, (section || 'Corrections et améliorations internes.') + '\n', 'utf8');

const points = section.split('\n').filter((l) => /^\s*[-*]/.test(l)).length;
console.log('✔ Notes de la ' + version + ' : ' + points + ' point(s) — notes-version.md');
