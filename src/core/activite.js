// Activite : ce qui s'est passe sur le live, pour la page « Activite recente »
// du dashboard (demande du user le 09/10/2026, maquette A : fil chronologique
// avec choix de la date).
//
// Le journal dit TOUT (demarrages, URL d'overlays, reconnexions…) : c'est un
// outil de diagnostic. L'activite ne garde que ce qu'un streamer veut relire
// apres son live -- un clip cree, un match termine, un sondage gagne. C'est le
// module qui le decide, en passant par ctx.activite plutot que ctx.log.
//
// Un fichier JSON Lines par jour dans %APPDATA%\StreamKit\activite\, garde
// RETENTION_JOURS : assez pour relire les lives des semaines passees, sans
// laisser grossir un dossier que personne ne nettoie.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DONNEES, JOURNAUX_DIR } from './paths.js';
import * as journal from './journal.js';

export const RETENTION_JOURS = 60;
const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;

let dossier = join(DONNEES, 'activite');

// Les tests ecrivent ailleurs.
export function utiliserDossier(d) {
  dossier = d;
}

const pad = (n) => String(n).padStart(2, '0');
// Le jour LOCAL : un live qui finit a 1 h du matin reste sur la date du soir…
// sauf ses dernieres minutes. C'est ce que le streamer attend d'un calendrier.
export const jourDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const heure = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const fichier = (jour) => join(dossier, jour + '.jsonl');

// Note un evenement. `niveau` reprend ceux du journal (succes, info, avert,
// erreur) : la page en tire la couleur de la pastille.
export function noter(source, message, niveau = 'succes') {
  const d = new Date();
  const entree = {
    t: d.toISOString(),
    h: heure(d),
    source,
    niveau,
    // Meme hygiene que le journal : une ligne, aucun secret.
    message: journal.masquer(String(message)).replace(/[\r\n]+/g, ' '),
  };
  try {
    mkdirSync(dossier, { recursive: true });
    appendFileSync(fichier(jourDe(d)), JSON.stringify(entree) + '\n', 'utf8');
  } catch {
    // Disque plein ou dossier verrouille : l'activite n'est pas une raison de
    // faire tomber le live.
  }
  return entree;
}

// Les evenements d'un jour, du plus ancien au plus recent. Une ligne abimee
// (ecriture coupee net) est ignoree, pas le fichier entier.
export function lire(jour) {
  if (!MOTIF_JOUR.test(jour) || !existsSync(fichier(jour))) return [];
  const res = [];
  for (const l of readFileSync(fichier(jour), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      res.push(JSON.parse(l));
    } catch {
      /* ligne tronquee */
    }
  }
  return res;
}

// Les jours qui ont de l'activite, du plus recent au plus ancien : la page s'en
// sert pour ses fleches « jour precedent / suivant ».
export function jours() {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.slice(0, -'.jsonl'.length))
    .filter((j) => MOTIF_JOUR.test(j))
    .sort()
    .reverse();
}

// Le journal technique du meme jour (option « + technique » de la page), sans
// le debug. Lu dans le fichier du jour : il couvre aussi les jours passes, dans
// la limite de la retention du journal (14 jours).
const MOTIF_LIGNE = /^(\S+) \[(\w+)\] \[([^\]]+)\] (.*)$/;
export function technique(jour) {
  if (!MOTIF_JOUR.test(jour)) return [];
  const f = join(JOURNAUX_DIR, jour + '.log');
  if (!existsSync(f)) return [];
  const res = [];
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(MOTIF_LIGNE);
    if (!m || m[2] === 'debug') continue;
    const d = new Date(m[1]);
    if (Number.isNaN(d.getTime())) continue;
    res.push({ t: m[1], h: heure(d), niveau: m[2], source: m[3], message: m[4], technique: true });
  }
  return res;
}

export function purger(maintenant = Date.now()) {
  const limite = jourDe(new Date(maintenant - RETENTION_JOURS * 86400000));
  for (const j of jours()) {
    if (j < limite) {
      try {
        unlinkSync(fichier(j));
      } catch {
        /* rien de critique */
      }
    }
  }
}
