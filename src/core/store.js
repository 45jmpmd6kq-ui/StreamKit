// Lecture / ecriture de la configuration, des jetons et de l'etat des modules.
//
// Trois fichiers, separes volontairement :
//   config.json     reglages lisibles (ce que le streamer voit dans le dashboard)
//   tokens.json     secrets : jetons OAuth, client secrets  -- JAMAIS dans un zip
//   etat/<id>.json  memoire de travail d'un module (file d'attente, compteurs)
//
// Ecriture atomique partout : si le PC est coupe pile pendant une sauvegarde,
// l'ancien fichier reste intact au lieu d'etre tronque. Un tokens.json corrompu
// = tout reinstaller, on ne prend pas ce risque.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_PATH, TOKENS_PATH, ETAT_DIR } from './paths.js';

const CONFIG_DEFAUT = {
  version: 1,
  twitch: { channel: '', broadcasterId: '', utilisateurId: '' },
  reseau: { port: 4455 },
  maj: { auto: true, depot: '' }, // depot GitHub, au format "utilisateur/projet"
  modules: {}, // { <id>: { actif, schemaVersion, reglages } }
};

function lire(chemin, defaut) {
  if (!existsSync(chemin)) return structuredClone(defaut);
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    // Fichier illisible : on repart du defaut plutot que de refuser de demarrer
    // en plein live. Le fichier fautif est conserve a cote, au cas ou.
    try {
      renameSync(chemin, chemin + '.corrompu');
    } catch {
      /* tant pis */
    }
    return structuredClone(defaut);
  }
}

function ecrireAtomique(chemin, contenu) {
  const tmp = chemin + '.tmp';
  writeFileSync(tmp, contenu, 'utf8');
  renameSync(tmp, chemin);
}

let config = null;

export function chargerConfig() {
  config = { ...structuredClone(CONFIG_DEFAUT), ...lire(CONFIG_PATH, CONFIG_DEFAUT) };
  return config;
}

export function getConfig() {
  return config ?? chargerConfig();
}

export function sauverConfig(c = config) {
  config = c;
  ecrireAtomique(CONFIG_PATH, JSON.stringify(c, null, 2));
  return c;
}

// --- Entree d'un module dans la config -------------------------------------

export function entreeModule(id) {
  const c = getConfig();
  c.modules[id] ??= { actif: false, schemaVersion: 0, reglages: {} };
  return c.modules[id];
}

export function sauverModule(id, patch) {
  const c = getConfig();
  c.modules[id] = { ...entreeModule(id), ...patch };
  sauverConfig(c);
  return c.modules[id];
}

// --- Secrets ----------------------------------------------------------------

export function lireTokens() {
  return lire(TOKENS_PATH, {});
}

export function sauverTokens(t) {
  ecrireAtomique(TOKENS_PATH, JSON.stringify(t, null, 2));
  return t;
}

// Modification ciblee : on relit AVANT d'ecrire, car plusieurs modules peuvent
// rafraichir leur jeton en meme temps et le dernier ne doit pas ecraser l'autre.
export function majTokens(fn) {
  const t = lireTokens();
  fn(t);
  return sauverTokens(t);
}

// --- Etat persistant d'un module -------------------------------------------

export function lireEtat(id, defaut = {}) {
  return lire(join(ETAT_DIR, id + '.json'), defaut);
}

export function sauverEtat(id, valeur) {
  ecrireAtomique(join(ETAT_DIR, id + '.json'), JSON.stringify(valeur, null, 2));
  return valeur;
}
