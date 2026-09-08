// Compteurs d'usage : combien de fois une commande a servi, combien de musiques
// ont été demandées, combien de clips créés.
//
// Deux échelles, parce qu'elles ne répondent pas à la même question :
//   session — depuis le lancement de StreamKit, donc en pratique « ce live » ;
//   total   — depuis toujours, ce qui donne son sens à un chiffre de session.
//
// Un module se contente d'appeler ctx.compteur.incr('demandes') : c'est le socle
// qui persiste, agrège et sait quand écrire sur le disque.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DONNEES } from './paths.js';

const FICHIER = join(DONNEES, 'compteurs.json');

// Sauvegarde différée : une commande de chat très sollicitée écrirait sinon des
// centaines de fois par minute, pour une donnée qui n'a rien d'urgent.
const DELAI_ECRITURE_MS = 5000;

let totaux = {}; // { moduleId: { cle: nombre } }  — depuis toujours
const session = {}; // idem, remis à zéro au démarrage
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
  if (!existsSync(FICHIER)) {
    totaux = {};
    return;
  }
  try {
    const brut = JSON.parse(readFileSync(FICHIER, 'utf8').replace(/^﻿/, ''));
    totaux = brut.modules ?? {};
  } catch {
    // Fichier illisible : des compteurs perdus ne valent pas un démarrage raté.
    totaux = {};
  }
}

function session_vider() {
  for (const k of Object.keys(session)) delete session[k];
}

function ecrire() {
  minuteur = null;
  if (!sale) return;
  sale = false;
  try {
    const tmp = FICHIER + '.tmp';
    writeFileSync(tmp, JSON.stringify({ modules: totaux }, null, 2), 'utf8');
    renameSync(tmp, FICHIER);
  } catch {
    /* disque plein ou verrouillé : on réessaiera au prochain incrément */
  }
}

export function incr(moduleId, cle, combien = 1) {
  if (!cle) return;
  totaux[moduleId] ??= {};
  totaux[moduleId][cle] = (totaux[moduleId][cle] || 0) + combien;
  session[moduleId] ??= {};
  session[moduleId][cle] = (session[moduleId][cle] || 0) + combien;

  sale = true;
  if (!minuteur) minuteur = setTimeout(ecrire, DELAI_ECRITURE_MS);
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
