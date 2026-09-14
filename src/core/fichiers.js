// Ecriture atomique ET durable d'un fichier.
//
// Atomique : on ecrit a cote (.tmp) puis on renomme par-dessus. Un renommage ne
// s'arrete pas a moitie, donc le fichier est soit l'ancien, soit le nouveau --
// jamais tronque par un plantage pendant l'ecriture.
//
// Durable : c'est ce qui manquait (audit P4). writeFileSync rend la main quand
// Windows a les octets EN MEMOIRE, pas sur le disque ; il les y pose plus tard,
// a son rythme. Le renommage, lui, est consigne tout de suite dans le journal
// NTFS. Coupure de courant entre les deux : au redemarrage, le nom pointe bien
// vers le nouveau fichier... dont le contenu n'a jamais ete ecrit. Resultat, un
// tokens.json vide, et un streamer qui doit reconnecter Twitch et Spotify.
//
// fsyncSync force l'ecriture physique AVANT le renommage : quoi qu'il arrive
// ensuite, le nom ne peut plus designer un contenu absent.
//
// Ce qu'on ne fait pas : synchroniser le dossier apres le renommage, comme on le
// ferait sous Linux. Windows ne permet pas de fsync un dossier, et NTFS journalise
// deja ses metadonnees. StreamKit ne tourne que sous Windows.
//
// Le cout : quelques millisecondes par ecriture. Ces fichiers s'ecrivent au plus
// quelques fois par minute (reglages, jetons, etat de module, compteurs regroupes
// par tranches de 5 s).

import { openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';

export function ecrireAtomique(chemin, contenu) {
  const tmp = chemin + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, contenu, 'utf8');
    fsyncSync(fd);
  } finally {
    // Toujours fermer, meme en cas d'echec : sous Windows, un .tmp reste ouvert
    // bloquerait la prochaine tentative.
    closeSync(fd);
  }
  // Si l'ecriture ou le fsync a echoue, on n'arrive pas ici : l'ancien fichier
  // reste en place, intact. Le .tmp abandonne sera ecrase a la prochaine
  // sauvegarde.
  renameSync(tmp, chemin);
}
