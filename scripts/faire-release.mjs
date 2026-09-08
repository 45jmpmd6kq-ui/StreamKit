// Fabrique le paquet a joindre a une release GitHub.
//
//   node scripts/faire-release.mjs
//
// Produit  livraison\StreamKit-v<version>.zip  contenant tout ce qu'il faut
// pour tourner, node_modules compris : les streamers ne lancent pas
// « npm install », et l'updater remplace le dossier tel quel.
//
// Ce script ne part JAMAIS chez le destinataire (dossier scripts\).

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVRAISON = join(RACINE, 'livraison');
const ETAPE = join(RACINE, '.paquet-tmp');

const version = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).version;
const nomZip = 'StreamKit-v' + version + '.zip';

// Ce qui ne part pas : les outils de build, les paquets precedents, l'historique
// git, et surtout tout ce qui pourrait contenir un secret.
const EXCLUS = [
  'livraison',
  'scripts',
  '.git',
  '.paquet-tmp',
  'config.json', // par securite : la vraie config vit dans %APPDATA%
  'tokens.json',
];

function powershell(commande) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', commande], {
    stdio: 'inherit',
  });
}

console.log('Preparation du paquet StreamKit v' + version + '...');

rmSync(ETAPE, { recursive: true, force: true });
mkdirSync(ETAPE, { recursive: true });
mkdirSync(LIVRAISON, { recursive: true });

// robocopy : /E sous-dossiers (vides compris), /XD dossiers exclus,
// /XF fichiers exclus. Ses codes de sortie < 8 sont des succes, d'ou le catch.
const dossiersExclus = EXCLUS.filter((e) => !e.includes('.json')).map((d) => join(RACINE, d));
const fichiersExclus = EXCLUS.filter((e) => e.includes('.json'));

try {
  execFileSync(
    'robocopy.exe',
    [
      RACINE,
      ETAPE,
      '/E',
      '/NFL', '/NDL', '/NJH', '/NJS',
      '/XD', ...dossiersExclus,
      '/XF', ...fichiersExclus,
    ],
    { stdio: 'inherit' }
  );
} catch (e) {
  // robocopy renvoie 1 (fichiers copies) : ce n'est pas une erreur.
  if ((e.status ?? 0) >= 8) throw e;
}

if (!existsSync(join(ETAPE, 'node_modules'))) {
  console.error(
    "\n  node_modules est absent : le paquet serait inutilisable chez le streamer.\n" +
      '  Lance « npm install » puis recommence.\n'
  );
  rmSync(ETAPE, { recursive: true, force: true });
  process.exit(1);
}

// Un seul zip courant dans livraison\ : les anciens partent aux archives.
for (const f of readdirSync(LIVRAISON)) {
  if (f.endsWith('.zip')) {
    console.log('  ancien paquet retire : ' + f);
    unlinkSync(join(LIVRAISON, f));
  }
}

const cible = join(LIVRAISON, nomZip);
powershell("Compress-Archive -Path '" + ETAPE + "\\*' -DestinationPath '" + cible + "' -Force");
rmSync(ETAPE, { recursive: true, force: true });

const taille = Math.round(statSync(cible).size / 1024 / 1024);
console.log('\n  ' + nomZip + '  (' + taille + ' Mo)');
console.log('  ' + cible + '\n');
console.log('  A joindre a la release GitHub taguee v' + version + '.');
console.log("  L'updater des streamers ira chercher ce .zip tout seul.\n");
