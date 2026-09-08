// Emplacements des fichiers.
//
// Regle d'or de StreamKit : le CODE et les DONNEES ne vivent jamais au meme
// endroit. Une mise a jour remplace le dossier du code ; si config.json etait
// dedans, chaque mise a jour effacerait les reglages du streamer -- exactement
// le probleme que StreamKit existe pour supprimer.
//
//   code     -> le dossier d'installation (celui qu'on remplace)
//   donnees  -> %APPDATA%\StreamKit  (Windows) ou ~/.streamkit (ailleurs)
//
// STREAMKIT_DATA permet de forcer un autre dossier (tests, plusieurs profils
// sur le meme PC).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MODULES_DIR = join(RACINE, 'src', 'modules');
export const DASHBOARD_DIR = join(RACINE, 'src', 'dashboard');

const defaut =
  process.platform === 'win32' && process.env.APPDATA
    ? join(process.env.APPDATA, 'StreamKit')
    : join(homedir(), '.streamkit');

export const DONNEES = process.env.STREAMKIT_DATA || defaut;
export const CONFIG_PATH = join(DONNEES, 'config.json');
export const TOKENS_PATH = join(DONNEES, 'tokens.json');
export const JOURNAUX_DIR = join(DONNEES, 'journaux');
export const ETAT_DIR = join(DONNEES, 'etat');
export const MAJ_DIR = join(DONNEES, 'maj');

export function preparerDossiers() {
  for (const d of [DONNEES, JOURNAUX_DIR, ETAT_DIR]) mkdirSync(d, { recursive: true });
}
