// Launch.log de Rocket League : ce que l'API de stats ne dit pas.
//
// L'API officielle ne donne ni la playlist (classe ou non), ni qui est le
// streamer. Le journal du jeu, lui, ecrit les deux :
//
//   [0169.11] Online: TryToPlayOnlineWithAntiCheat ... PlaylistId=(13)
//   [0173.85] RankedReconnect: ... Reservation=(ServerName="EU9-...",Playlist=13,...)
//   [0572.42] ScriptLog: Match Ended - [Reservation: , MatchID: ]
//   [0024.61] SettingsExport: CreateSnapshot Metadata {"userId":"Epic|84d7...|0",...}
//
// Verifie sur les fichiers reels (compteur 1v1, septembre 2026) : la ligne de
// file d'attente precede toujours la partie, et « Match Ended » la termine.
// Le fichier est toujours ecrit, meme sans sauvegarde des replays.
//
// Il est remplace a chaque lancement du jeu (l'ancien part en
// Launch-backup-*.log) : le suivi repart du debut quand il change.

import { execFile } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Numeros de playlist (releves par le compteur 1v1 ; 13 confirme en reel).
export const PLAYLISTS = {
  1: { nom: '1v1', taille: 1 },
  2: { nom: '2v2', taille: 2 },
  3: { nom: '3v3', taille: 3 },
  4: { nom: 'Chaos 4v4', taille: 4 },
  6: { nom: 'Match privé', prive: true },
  7: { nom: 'LAN', prive: true },
  8: { nom: 'Entraînement', prive: true },
  10: { nom: 'Classé 1v1', taille: 1, classe: true },
  11: { nom: 'Classé 2v2', taille: 2, classe: true },
  12: { nom: 'Classé 3v3 solo', taille: 3, classe: true },
  13: { nom: 'Classé 3v3', taille: 3, classe: true },
  15: { nom: 'Snow Day' },
  16: { nom: 'Rocket Labs' },
  17: { nom: 'Hoops' },
  18: { nom: 'Rumble' },
  19: { nom: 'Dropshot' },
  27: { nom: 'Classé Hoops', taille: 2, classe: true },
  28: { nom: 'Classé Rumble', taille: 3, classe: true },
  29: { nom: 'Classé Dropshot', taille: 3, classe: true },
  30: { nom: 'Classé Snow Day', taille: 3, classe: true },
  34: { nom: 'Tournoi', taille: 3 },
};

export const nomPlaylist = (id) =>
  PLAYLISTS[id]?.nom ?? (id == null ? 'playlist inconnue' : 'playlist ' + id);

const RE_FILE = /TryToPlayOnlineWithAntiCheat.*PlaylistId=\((\d+)\)/;
const RE_RESERVATION = /Reservation=\(.*?\bPlaylist=(\d+)/;
const RE_FIN = /Match Ended/;
const RE_IDENTITE = /"userId":"((?:Epic|Steam|PS4|PS5|XboxOne|Switch)\|[^"|]+\|\d+)"/;

// Etat deduit des lignes, sans rien savoir du fichier.
export function creerLecteur() {
  const etat = { playlist: null, primaryId: null };
  return {
    etat,
    ligne(texte) {
      let m;
      if ((m = RE_FILE.exec(texte)) || (m = RE_RESERVATION.exec(texte))) {
        etat.playlist = Number(m[1]);
      } else if (RE_FIN.test(texte)) {
        // Partie terminee : la prochaine devra dire sa propre playlist. Sans
        // ca, un match prive lance juste apres heriterait du « classe ».
        etat.playlist = null;
      }
      if ((m = RE_IDENTITE.exec(texte))) etat.primaryId = m[1];
    },
    oublierPlaylist() {
      etat.playlist = null;
    },
  };
}

// Suit un fichier qui grandit, et qui peut etre remplace par un neuf.
//
// Un nouveau lancement du jeu se reconnait a l'EN-TETE du fichier (la premiere
// ligne porte l'heure d'ouverture du journal), pas a sa date de creation :
// Windows recopie la date de creation d'un fichier supprime puis recree sous le
// meme nom dans les secondes qui suivent (« file tunneling ») -- exactement ce
// que fait le jeu en archivant l'ancien journal.
const TAILLE_SIGNATURE = 96;

export function creerSuiviFichier(chemin, surLigne) {
  let position = 0;
  let signature = '';
  let decodeur = new StringDecoder('utf8');
  let reste = '';

  function repartir() {
    position = 0;
    reste = '';
    decodeur = new StringDecoder('utf8');
  }

  return {
    chemin,
    // Lit ce qui a ete ajoute depuis la derniere fois. Renvoie false si le
    // fichier n'existe pas (jeu jamais lance, mauvais dossier).
    lire() {
      let taille;
      try {
        taille = statSync(chemin).size;
      } catch {
        return false;
      }
      let fd;
      try {
        fd = openSync(chemin, 'r');
      } catch {
        return false; // verrouille un instant par le jeu : on reessaiera
      }
      try {
        const tete = Buffer.alloc(Math.min(TAILLE_SIGNATURE, taille));
        readSync(fd, tete, 0, tete.length, 0);
        const actuelle = tete.toString('latin1');
        // On compare sur la partie commune : un fichier tout neuf peut ne pas
        // avoir encore ses 96 premiers octets.
        const commun = Math.min(actuelle.length, signature.length);
        if (actuelle.slice(0, commun) !== signature.slice(0, commun) || taille < position) repartir();
        if (actuelle.length >= signature.length || position === 0) signature = actuelle;
        if (taille === position) return true;

        const tampon = Buffer.alloc(taille - position);
        const lus = readSync(fd, tampon, 0, tampon.length, position);
        position += lus;
        const texte = reste + decodeur.write(tampon.subarray(0, lus));
        const lignes = texte.split(/\r?\n/);
        reste = lignes.pop(); // ligne encore en cours d'ecriture
        for (const l of lignes) surLigne(l);
        return true;
      } finally {
        closeSync(fd);
      }
    },
  };
}

// --- Ou est Launch.log ? ---------------------------------------------------

function requeteRegistre(cle, valeur) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', cle, '/v', valeur], { windowsHide: true, timeout: 5000 }, (err, sortie) => {
      if (err) return resolve(null);
      const m = new RegExp(valeur + '\\s+REG_\\w+\\s+(.+)$', 'm').exec(String(sortie));
      resolve(m ? m[1].trim() : null);
    });
  });
}

const developper = (chemin) => chemin.replace(/%([^%]+)%/g, (tout, nom) => process.env[nom] ?? tout);

// Le dossier Documents est souvent redirige vers OneDrive (c'est le cas sur le
// PC de Sylvain) : le chemin « evident » n'est pas le bon. On lit le vrai dans
// le registre, puis les emplacements habituels.
export async function cheminsLaunchLog() {
  const candidats = [];
  const documents = await requeteRegistre(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'Personal'
  );
  if (documents) candidats.push(developper(documents));
  const profil = process.env.USERPROFILE || '';
  if (profil) candidats.push(join(profil, 'Documents'), join(profil, 'OneDrive', 'Documents'));
  return [...new Set(candidats)].map((d) =>
    join(d, 'My Games', 'Rocket League', 'TAGame', 'Logs', 'Launch.log')
  );
}

export async function trouverLaunchLog(cheminForce) {
  if (cheminForce) return existsSync(cheminForce) ? cheminForce : null;
  for (const c of await cheminsLaunchLog()) if (existsSync(c)) return c;
  return null;
}

export { requeteRegistre, developper };
