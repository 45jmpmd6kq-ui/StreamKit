// Compteurs d'usage : combien de fois une commande a servi, combien de musiques
// ont été demandées, combien de clips créés.
//
// Deux échelles, parce qu'elles ne répondent pas à la même question :
//   session — depuis le lancement de StreamKit, donc en pratique « ce live » ;
//   total   — depuis toujours, ce qui donne son sens à un chiffre de session.
//
// Un module se contente d'appeler ctx.compteur.incr('demandes') : c'est le socle
// qui persiste, agrège et sait quand écrire sur le disque.
//
// Depuis 0.33.0, un HISTORIQUE en plus, pour la page « Métriques » (maquette B
// choisie par le user le 10/10/2026 : évolution par période, graphique par
// live, top des viewers) :
//   jours — les compteurs de chaque jour (local), et qui a fait quoi (`par`) ;
//   lives — chaque live : début, fin, et ses propres compteurs.
// Rien n'existe avant cette version : les totaux, eux, sont repris tels quels.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DONNEES } from './paths.js';
import { ecrireAtomique } from './fichiers.js';

const FICHIER = join(DONNEES, 'compteurs.json');

// Sauvegarde différée : une commande de chat très sollicitée écrirait sinon des
// centaines de fois par minute, pour une donnée qui n'a rien d'urgent.
const DELAI_ECRITURE_MS = 5000;

let totaux = {}; // { moduleId: { cle: nombre } }  — depuis toujours
const session = {}; // idem, remis à zéro au démarrage
// { 'AAAA-MM-JJ': { m: { moduleId: { cle: n } }, par: { moduleId: { cle: { nom: n } } } } }
let jours = {};
// [{ debut, fin, vu, m, par }] (horodatages en ms) ; fin = null tant qu'il dure.
let lives = [];
let liveCourant = null;

// Un an de jours et 300 lives : de quoi comparer des mois, sans laisser grossir
// un fichier que le socle relit à chaque démarrage.
const JOURS_GARDES = 400;
const LIVES_GARDES = 300;
// Un « nouveau » live qui commence à moins de 5 min d'un live resté ouvert est
// le même : StreamKit relancé pendant le stream.
const MEME_LIVE_MS = 5 * 60 * 1000;
let depuis = new Date().toISOString();
let minuteur = null;
let sale = false;

// Ce que « session » veut dire : le live en cours si Twitch en signale un,
// sinon le lancement de StreamKit. C'est la seule échelle qui ait du sens pour
// un streamer — et avec le démarrage automatique avec Windows, « depuis le
// lancement » pourrait couvrir plusieurs jours et plusieurs lives.
let origine = 'lancement'; // 'lancement' | 'live'

export function nouvelleSession(cause = 'lancement') {
  session_vider();
  depuis = new Date().toISOString();
  origine = cause;
}

export function causeSession() {
  return origine;
}

export function charger() {
  nouvelleSession('lancement');
  totaux = {};
  jours = {};
  lives = [];
  liveCourant = null;
  if (!existsSync(FICHIER)) return;
  try {
    const brut = JSON.parse(readFileSync(FICHIER, 'utf8').replace(/^\uFEFF/, ''));
    totaux = brut.modules ?? {};
    jours = brut.jours ?? {};
    lives = Array.isArray(brut.lives) ? brut.lives : [];
  } catch {
    // Fichier illisible : des compteurs perdus ne valent pas un démarrage raté.
  }
}

const pad = (n) => String(n).padStart(2, '0');
export const jourDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function ajouter(cible, moduleId, cle, combien, par) {
  cible.m ??= {};
  cible.m[moduleId] ??= {};
  cible.m[moduleId][cle] = (cible.m[moduleId][cle] || 0) + combien;
  if (par) {
    cible.par ??= {};
    cible.par[moduleId] ??= {};
    cible.par[moduleId][cle] ??= {};
    cible.par[moduleId][cle][par] = (cible.par[moduleId][cle][par] || 0) + combien;
  }
}

function marquer() {
  sale = true;
  if (!minuteur) minuteur = setTimeout(ecrire, DELAI_ECRITURE_MS);
}

// --- Lives ---------------------------------------------------------------------
// Le noyau dit quand un live commence et finit (EventSub, ou l'état demandé à
// Twitch au démarrage). Les compteurs qui tombent pendant ce temps vont aussi
// dans le live.

export function debutLive(debut = Date.now()) {
  const ouvert = lives.findLast((l) => l.fin == null);
  if (ouvert && Math.abs(ouvert.debut - debut) < MEME_LIVE_MS) {
    liveCourant = ouvert;
  } else {
    fermerOuverts();
    liveCourant = { debut, fin: null, vu: Date.now(), m: {} };
    lives.push(liveCourant);
    if (lives.length > LIVES_GARDES) lives = lives.slice(-LIVES_GARDES);
  }
  marquer();
}

export function finLive(fin = Date.now()) {
  if (liveCourant) {
    liveCourant.fin = fin;
    liveCourant = null;
  }
  fermerOuverts();
  marquer();
}

// Un live resté ouvert (StreamKit fermé avant la fin du stream) se termine à la
// dernière fois qu'on l'a vu tourner.
export function fermerOuverts() {
  for (const l of lives) {
    if (l.fin == null && l !== liveCourant) {
      l.fin = l.vu ?? l.debut;
      sale = true;
    }
  }
}

// Appelé chaque minute par le noyau : la durée d'un live dont on rate la fin
// reste ainsi juste à la minute près.
export function tic() {
  if (!liveCourant) return;
  liveCourant.vu = Date.now();
  marquer();
}

// La télémétrie a bien envoyé ce live : il ne repartira pas.
export function marquerEnvoye(live) {
  live.envoye = true;
  marquer();
}

function elaguerJours() {
  const cles = Object.keys(jours).sort();
  for (const j of cles.slice(0, Math.max(0, cles.length - JOURS_GARDES))) delete jours[j];
}

// Tout ce que la page Métriques agrège elle-même.
export function historique() {
  return {
    totaux,
    session,
    depuis,
    origine,
    jours,
    lives,
    liveEnCours: !!liveCourant,
    aujourdhui: jourDe(new Date()),
  };
}

function session_vider() {
  for (const k of Object.keys(session)) delete session[k];
}

function ecrire() {
  minuteur = null;
  if (!sale) return;
  sale = false;
  try {
    ecrireAtomique(FICHIER, JSON.stringify({ modules: totaux, jours, lives }));
  } catch {
    /* disque plein ou verrouillé : on réessaiera au prochain incrément */
  }
}

// `par` : qui (le pseudo d'un viewer), pour les tops de la page Métriques.
export function incr(moduleId, cle, combien = 1, { par } = {}) {
  if (!cle) return;
  totaux[moduleId] ??= {};
  totaux[moduleId][cle] = (totaux[moduleId][cle] || 0) + combien;
  session[moduleId] ??= {};
  session[moduleId][cle] = (session[moduleId][cle] || 0) + combien;

  const jour = jourDe(new Date());
  if (!jours[jour]) {
    jours[jour] = {};
    elaguerJours();
  }
  ajouter(jours[jour], moduleId, cle, combien, par);
  if (liveCourant) {
    ajouter(liveCourant, moduleId, cle, combien, par);
    liveCourant.vu = Date.now();
  }
  marquer();
}

export function pour(moduleId) {
  return { total: totaux[moduleId] ?? {}, session: session[moduleId] ?? {} };
}

export function debutSession() {
  return depuis;
}

// Appelé à l'arrêt : sans ça, jusqu'à 5 secondes de compteurs partiraient.
export function vider() {
  clearTimeout(minuteur);
  minuteur = null;
  ecrire();
}
