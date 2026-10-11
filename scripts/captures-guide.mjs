// Regenere les captures du guide d'utilisation : src/dashboard/guide/*.jpg.
//
//   npm run guide
//
// A relancer quand un ecran du dashboard change. Une installation VIERGE,
// lancee pour l'occasion : dossier de donnees temporaire, aucun compte, donc
// jamais l'entree « Moderateur » (elle n'existe que la ou se trouve
// moderateur.json, c'est-a-dire sur le PC du developpeur) et aucune
// statistique envoyee (StreamKit hors installation n'en envoie pas).
//
// Deroulement : StreamKit demarre sur le port habituel (47455, celui qu'on lit
// dans les adresses d'overlay des captures), quelques modules sont actives pour
// que la Vue d'ensemble ait de quoi montrer, puis Electron ouvre chaque ecran
// et le photographie (scripts/captures-guide-electron.cjs).
//
// Apres coup : les reperes numerotes du guide sont places en % de chaque
// capture (src/dashboard/guide/guide.html). Verifie qu'ils tombent toujours
// au bon endroit.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 47455;
const BASE = 'http://127.0.0.1:' + PORT;
const SORTIE = join(RACINE, 'src', 'dashboard', 'guide');
// Les modules montres actifs dans la Vue d'ensemble.
const MODULES = ['musique', 'sondages', 'rl-session', 'rl-moments', 'lol-session'];

const attendre = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

async function repond() {
  try {
    return (await fetch(BASE + '/api/etat')).ok;
  } catch {
    return false;
  }
}

if (await repond()) {
  console.error('Le port ' + PORT + ' est deja pris : ferme StreamKit avant de lancer les captures.');
  process.exit(1);
}

const donnees = mkdtempSync(join(tmpdir(), 'streamkit-guide-'));
const serveur = spawn(process.execPath, [join(RACINE, 'src', 'index.js')], {
  env: { ...process.env, STREAMKIT_DATA: donnees, STREAMKIT_TELEMETRIE: '0' },
  stdio: 'ignore',
});

try {
  for (let i = 0; i < 60 && !(await repond()); i++) await attendre(250);
  if (!(await repond())) throw new Error('StreamKit ne repond pas');

  for (const id of MODULES) {
    await fetch(BASE + '/api/modules/' + id + '/actif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: true }),
    });
  }

  const electron = createRequire(import.meta.url)('electron');
  const code = await new Promise((resolve) => {
    const p = spawn(electron, [join(RACINE, 'scripts', 'captures-guide-electron.cjs')], {
      env: { ...process.env, SORTIE, BASE },
      stdio: 'inherit',
    });
    p.on('exit', resolve);
  });
  if (code !== 0) throw new Error('captures interrompues (code ' + code + ')');
  console.log('Captures du guide a jour dans ' + SORTIE);
} finally {
  serveur.kill();
  await attendre(500);
  rmSync(donnees, { recursive: true, force: true });
}
