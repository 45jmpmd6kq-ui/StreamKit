// Journal central : UNE seule source de verite pour la console, le dashboard et
// les fichiers. Un module n'ecrit jamais dans console.log directement, il passe
// par le logger qu'on lui donne -- c'est ce qui permet de filtrer par module
// dans le dashboard et de savoir qui a dit quoi.
//
// Trois destinations pour la meme ligne :
//   1. la console        (quand StreamKit tourne dans une fenetre)
//   2. un tampon memoire (le dashboard affiche l'historique instantanement)
//   3. un fichier par jour dans %APPDATA%\StreamKit\journaux\
//      -> indispensable pour les soucis rapportes le lendemain
//         ("hier soir le bot repondait plus")
//
// Les abonnes (le flux SSE du dashboard) recoivent chaque ligne en direct.

import { appendFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { JOURNAUX_DIR } from './paths.js';

// La console Windows demarre en page de code 850/1252 et decode donc nos octets
// UTF-8 de travers : « — demarrage » s'affiche « ÔÇö demarrage ». Le fichier de
// journal et le dashboard, eux, sont corrects — c'est purement l'affichage du
// terminal. On bascule la console en UTF-8 une bonne fois.
//
// Uniquement quand on ecrit vraiment dans un terminal : sous l'application
// Electron il n'y a pas de console, et lancer un processus pour rien serait
// absurde.
if (process.platform === 'win32' && process.stdout.isTTY) {
  try {
    execFileSync('chcp.com', ['65001'], { stdio: 'ignore', windowsHide: true });
  } catch {
    // Pas de chcp accessible : on continue, l'affichage sera juste moins joli.
  }
}

const TAILLE_TAMPON = 3000; // lignes gardees en memoire
const RETENTION_JOURS = 14; // au-dela, les fichiers de journal sont effaces

export const NIVEAUX = ['debug', 'info', 'succes', 'avert', 'erreur'];
const RANG = Object.fromEntries(NIVEAUX.map((n, i) => [n, i]));

const ICONE = { debug: '·', info: 'i', succes: '✅', avert: '⚠️', erreur: '❌' };

const tampon = [];
const abonnes = new Set();
let compteur = 0;
const NIVEAU_CONSOLE = 'info'; // le debug ne pollue pas la console, mais reste dans le dashboard

const pad = (n) => String(n).padStart(2, '0');
const heure = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const jour = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Une ligne de journal tient sur UNE ligne.
//
// Sans ca, une saisie de viewer qui contient un retour a la ligne fabrique de
// FAUSSES entrees dans le fichier du jour : le spectateur y ecrit ce qu'il veut,
// horodatage et niveau compris, et le diagnostic du lendemain part sur une piste
// inventee. (JSON.stringify, lui, echappe deja les retours a la ligne.)
const uneLigne = (s) => s.replace(/[\r\n]+/g, ' ');

// Une erreur transmise telle quelle donne "[object Object]" dans le dashboard.
function texte(v) {
  if (v instanceof Error) return uneLigne(v.message || String(v));
  if (typeof v === 'string') return uneLigne(v);
  try {
    return JSON.stringify(v);
  } catch {
    return uneLigne(String(v));
  }
}

function ecrireFichier(entree) {
  try {
    const ligne = `${entree.t} [${entree.niveau}] [${entree.source}] ${entree.message}\n`;
    appendFileSync(join(JOURNAUX_DIR, `${jour(new Date(entree.t))}.log`), ligne, 'utf8');
  } catch {
    // Disque plein ou dossier verrouille : on ne fait surtout pas planter le
    // stream pour un probleme de journal.
  }
}

function ajouter(niveau, source, ...morceaux) {
  const d = new Date();
  const entree = {
    id: ++compteur,
    t: d.toISOString(),
    h: heure(d),
    niveau,
    source,
    message: morceaux.map(texte).join(' '),
  };

  tampon.push(entree);
  if (tampon.length > TAILLE_TAMPON) tampon.shift();

  if (RANG[niveau] >= RANG[NIVEAU_CONSOLE]) {
    console.log(`[${entree.h}] ${ICONE[niveau]} [${source}] ${entree.message}`);
  }

  ecrireFichier(entree);

  for (const fn of abonnes) {
    try {
      fn(entree);
    } catch {
      // Un dashboard ferme brutalement ne doit pas casser le journal.
    }
  }
  return entree;
}

// Chaque module recoit son logger etiquete : journal.pour('musique').ok('...')
export function pour(source) {
  return {
    debug: (...a) => ajouter('debug', source, ...a),
    info: (...a) => ajouter('info', source, ...a),
    ok: (...a) => ajouter('succes', source, ...a),
    warn: (...a) => ajouter('avert', source, ...a),
    err: (...a) => ajouter('erreur', source, ...a),
  };
}

// Historique pour le dashboard. `depuis` = dernier id deja recu, pour ne
// renvoyer que la suite quand la page se reconnecte.
export function historique({ source, niveau, recherche, depuis = 0, limite = 500 } = {}) {
  const seuil = niveau ? RANG[niveau] ?? 0 : 0;
  const q = recherche ? recherche.toLowerCase() : null;
  const res = tampon.filter(
    (e) =>
      e.id > depuis &&
      (!source || source === e.source) &&
      RANG[e.niveau] >= seuil &&
      (!q || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q))
  );
  return res.slice(-limite);
}

// Les sources presentes dans le tampon : sert a remplir le filtre du dashboard
// sans avoir a lui transmettre la liste des modules.
export function sources() {
  return [...new Set(tampon.map((e) => e.source))].sort();
}

export function abonner(fn) {
  abonnes.add(fn);
  return () => abonnes.delete(fn);
}

// Efface les journaux trop vieux. Appele une fois au demarrage : un streamer ne
// nettoie jamais ce dossier lui-meme.
export function purger() {
  const limite = Date.now() - RETENTION_JOURS * 86400000;
  try {
    for (const f of readdirSync(JOURNAUX_DIR)) {
      if (!f.endsWith('.log')) continue;
      const p = join(JOURNAUX_DIR, f);
      if (statSync(p).mtimeMs < limite) unlinkSync(p);
    }
  } catch {
    /* rien de critique */
  }
}

export const noyau = pour('noyau');
