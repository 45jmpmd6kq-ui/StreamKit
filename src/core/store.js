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

import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_PATH, TOKENS_PATH, ETAT_DIR } from './paths.js';
import * as coffre from './coffre.js';

const CONFIG_DEFAUT = {
  // 1 -> 2 : les modules de developpement laisses actifs sont eteints une fois
  // (voir la migration au demarrage, dans noyau.js).
  version: 2,
  twitch: { channel: '', broadcasterId: '', utilisateurId: '' },
  reseau: { port: 4455 },
  // Depot GitHub des mises a jour, au format "utilisateur/projet".
  //
  // LIGNE DE COMMANDE UNIQUEMENT (maj.js, npm run dev). Chez le streamer,
  // StreamKit tourne sous Electron : le depot y vient de build.publish, fige a
  // la compilation, et ce champ n'a aucun effet. Il n'est donc plus expose dans
  // l'etat general ni modifiable par /api/reglages -- le dashboard avait deja
  // cesse de l'envoyer, il ne restait qu'un reglage qui faisait semblant.
  maj: { auto: true, depot: '45jmpmd6kq-ui/StreamKit' },
  modules: {}, // { <id>: { actif, schemaVersion, reglages } }
};

function lire(chemin, defaut) {
  if (!existsSync(chemin)) return structuredClone(defaut);
  try {
    // On retire un eventuel BOM avant d'analyser. Ce n'est pas theorique : un
    // streamer qui ouvre config.json dans le Bloc-notes pour jeter un oeil et
    // l'enregistre y ajoute un BOM. JSON.parse echouerait, et il perdrait TOUS
    // ses reglages sans le moindre message.
    return JSON.parse(readFileSync(chemin, 'utf8').replace(/^\uFEFF/, ''));
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

// Fusion PROFONDE des defauts et du fichier existant.
//
// Une fusion superficielle ({ ...defaut, ...stocke }) suffirait aujourd'hui,
// mais casserait a la premiere mise a jour qui ajoute une cle dans un objet
// existant : `maj: { auto, depot }` stocke ecraserait en bloc un
// `maj: { auto, depot, canal }` tout neuf, et la nouvelle option n'existerait
// jamais chez ceux qui ont deja un config.json. C'est exactement le genre de
// regression que StreamKit doit rendre impossible.
//
// Regle : la valeur du streamer gagne toujours ; le defaut ne fait que combler
// ce qui manque.
function fusionner(defaut, stocke) {
  if (!estObjet(defaut) || !estObjet(stocke)) return stocke === undefined ? defaut : stocke;
  const out = { ...defaut };
  for (const [cle, valeur] of Object.entries(stocke)) {
    out[cle] = cle in defaut ? fusionner(defaut[cle], valeur) : valeur;
  }
  return out;
}

function estObjet(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

let config = null;

export function chargerConfig() {
  config = fusionner(structuredClone(CONFIG_DEFAUT), lire(CONFIG_PATH, {}));
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

// Ce qui est chiffre dans tokens.json, et ce qui ne l'est pas.
//
//   clientSecret, accessToken, refreshToken   chiffres : ce sont LES secrets.
//   tout ce qu'un module range via ctx.secrets chiffre aussi -- c'est le sens
//                                             meme de ce rangement (cle d'API
//                                             Riot, jeton Spotify d'un module).
//   clientId                                  en clair : il circule deja dans
//                                             l'URL d'autorisation, et le lire
//                                             aide enormement au support.
//   compte, scope, expiresIn, connecteA       en clair : ce ne sont pas des
//                                             secrets, et un tokens.json
//                                             totalement opaque serait
//                                             indiagnostiquable.
const CLES_SECRETES = new Set(['clientSecret', 'accessToken', 'refreshToken']);

// Applique `fn` a chaque valeur sensible et renvoie une COPIE.
//
// La copie n'est pas du zele : le cache memoire garde la version en clair (le
// reste du code lit des jetons utilisables), et seul ce qui part sur le disque
// est chiffre. Transformer sur place chiffrerait le cache au premier
// enregistrement, et tout casserait au deuxieme.
function transformerSecrets(t, fn) {
  const bloc = (o) => {
    if (!estObjet(o)) return o;
    const copie = { ...o };
    for (const [cle, valeur] of Object.entries(copie)) {
      if (CLES_SECRETES.has(cle) && typeof valeur === 'string') copie[cle] = fn(valeur);
    }
    return copie;
  };

  const parId = (o, traiter) =>
    estObjet(o) ? Object.fromEntries(Object.entries(o).map(([id, v]) => [id, traiter(v)])) : o;

  const sortie = { ...t };
  if (sortie.twitchApp) sortie.twitchApp = bloc(sortie.twitchApp);
  if (sortie.twitch) sortie.twitch = bloc(sortie.twitch);
  if (sortie.connecteurs) sortie.connecteurs = parId(sortie.connecteurs, bloc);
  if (sortie.modules) {
    sortie.modules = parId(sortie.modules, (m) =>
      estObjet(m)
        ? Object.fromEntries(Object.entries(m).map(([cle, v]) => [cle, typeof v === 'string' ? fn(v) : v]))
        : m
    );
  }
  return sortie;
}

// Reste-t-il un secret en clair sur le disque ?
function contientDuClair(t) {
  let clair = false;
  transformerSecrets(t, (v) => {
    if (v && !coffre.estChiffre(v)) clair = true;
    return v;
  });
  return clair;
}

// Migration : chiffre une bonne fois ce qui trainait en clair.
//
// L'audit proposait d'attendre la premiere ecriture naturelle. Mais elle peut
// ne jamais venir : un streamer qui ne retouche ni Twitch ni Spotify garderait
// ses jetons en clair pour toujours. On reecrit donc le fichier au demarrage,
// une seule fois, et seulement s'il y a vraiment quelque chose a chiffrer.
export function chiffrerSecretsAuRepos() {
  if (!coffre.disponible()) return false;

  // On interroge le fichier BRUT, pas lireTokens() : celui-ci rend des valeurs
  // deja dechiffrees, qui paraissent donc en clair a tous les coups -- on
  // reecrirait le fichier a chaque demarrage sans jamais rien migrer.
  if (!contientDuClair(lire(TOKENS_PATH, {}))) return false;

  sauverTokens(lireTokens());
  return true;
}

// tokens.json etait relu et reanalyse a CHAQUE appel -- et il y en a beaucoup :
// l'etat general du dashboard en fait deux, l'icone pres de l'horloge le
// redemande toutes les 5 secondes, et chaque ctx.secrets.lire() d'un module en
// declenche un. Soit 0,25 ms de disque bloquant a chaque fois, sur la boucle
// d'evenements qui sert aussi le chat.
//
// On garde donc le contenu en memoire, en relisant seulement si le fichier a
// change (meme methode que le catalogue de voitures) : une edition a la main
// reste prise en compte, mais l'appel courant ne coute plus qu'un statSync.
let tokensCache = null;
let tokensMtime = -1;

function dateTokens() {
  try {
    return statSync(TOKENS_PATH).mtimeMs;
  } catch {
    return 0; // fichier absent : premier lancement
  }
}

// ATTENTION : l'objet renvoye est PARTAGE, il est en lecture seule.
// Pour modifier quoi que ce soit, passer par majTokens().
export function lireTokens() {
  const mtime = dateTokens();
  if (tokensCache && mtime === tokensMtime) return tokensCache;
  tokensCache = transformerSecrets(lire(TOKENS_PATH, {}), coffre.dechiffrer);
  tokensMtime = mtime;
  return tokensCache;
}

export function sauverTokens(t) {
  ecrireAtomique(TOKENS_PATH, JSON.stringify(transformerSecrets(t, coffre.chiffrer), null, 2));
  // Le cache reste en CLAIR : c'est ce que tout le reste du code attend.
  tokensCache = t;
  tokensMtime = dateTokens();
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
