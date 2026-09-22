// Glisse l'adresse du salon Discord des rapports de bug dans l'application,
// juste avant electron-builder :
//
//   node scripts/cible-signalement.mjs            (npm run dist)
//   node scripts/cible-signalement.mjs --exiger   (npm run publier)
//
// L'adresse vit dans la variable d'environnement STREAMKIT_WEBHOOK_BUGS du PC
// de developpement, JAMAIS dans le depot : il est public, et des robots
// parcourent GitHub a la recherche de webhooks Discord pour les inonder ou les
// supprimer. Le fichier produit, src/core/signalement-cible.json, est ignore
// par git et embarque par electron-builder (files: src/**), brouille (voir
// src/core/brouillage.js).
//
// Sans adresse, un installeur de TEST se construit quand meme : le bouton
// « Signaler un bug » enregistre alors le rapport sur le PC du streamer, sans
// l'envoyer. Une PUBLICATION s'arrete (--exiger) : les streamers recevraient
// une version incapable de faire partir le moindre rapport.
//
// La variable est aussi relue dans le registre (HKCU\Environment) : posee apres
// l'ouverture du terminal, elle n'est pas encore dans son environnement --
// piege deja vecu avec GH_TOKEN.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { brouiller, debrouiller, estWebhookDiscord } from '../src/core/brouillage.js';

const NOM = 'STREAMKIT_WEBHOOK_BUGS';
const FICHIER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'signalement-cible.json');
const exiger = process.argv.includes('--exiger');

function depuisRegistre() {
  if (process.platform !== 'win32') return '';
  try {
    const sortie = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', NOM], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return sortie.match(new RegExp(NOM + '\\s+REG_(?:EXPAND_)?SZ\\s+(\\S+)'))?.[1] ?? '';
  } catch {
    return ''; // variable absente : reg.exe sort en erreur
  }
}

// Seconde voie, pour un poste ou l'ecriture dans le registre est refusee
// (strategie de securite, antivirus) : un fichier texte a cote des donnees de
// StreamKit, qui ne contient QUE l'adresse. Hors du depot, comme tokens.json.
const FICHIER_APPDATA = join(
  process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'StreamKit',
  'webhook-bugs.txt'
);

function depuisAppData() {
  try {
    return readFileSync(FICHIER_APPDATA, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)[0];
  } catch {
    return ''; // pas de fichier : on continue avec les autres sources
  }
}

function depuisFichier() {
  try {
    const { cible } = JSON.parse(readFileSync(FICHIER, 'utf8'));
    return cible ? debrouiller(cible) : '';
  } catch {
    return '';
  }
}

const sources = [
  ['variable d’environnement', (process.env[NOM] ?? '').trim()],
  ['registre Windows', depuisRegistre().trim()],
  ['fichier ' + FICHIER_APPDATA, depuisAppData().trim()],
  ['construction précédente', depuisFichier().trim()],
];

const trouvee = sources.find(([, url]) => url);

if (trouvee && !estWebhookDiscord(trouvee[1])) {
  console.error(
    '✖ ' +
      NOM +
      ' (' +
      trouvee[0] +
      ') ne ressemble pas à une adresse de webhook Discord ' +
      '(https://discord.com/api/webhooks/<id>/<jeton>).'
  );
  process.exit(1);
}

if (!trouvee) {
  const message =
    'Aucune adresse de webhook Discord (' +
    NOM +
    ') : « Signaler un bug » enregistrera les rapports sur le PC, sans les envoyer.';
  if (exiger) {
    console.error('✖ ' + message + '\n  Publication arrêtée — voir README, « Rapports de bug ».');
    process.exit(1);
  }
  console.warn('⚠ ' + message);
  process.exit(0);
}

const [provenance, url] = trouvee;
writeFileSync(FICHIER, JSON.stringify({ cible: brouiller(url) }, null, 2) + '\n', 'utf8');

// Jamais l'adresse complete dans une console : le jeton du webhook suffit a
// poster dans le salon, ou a le supprimer.
const id = url.match(/webhooks\/(\d+)\//)?.[1] ?? '';
console.log('✔ Rapports de bug : webhook Discord …' + id.slice(-4) + ' embarqué (' + provenance + ')');
