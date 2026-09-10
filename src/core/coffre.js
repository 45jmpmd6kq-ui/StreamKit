// Chiffrement des secrets au repos.
//
// tokens.json contient les secrets client Twitch et Spotify et les jetons de
// rafraichissement, en JSON parfaitement lisible. Le dossier %APPDATA% est
// protege par les ACL de la session Windows, mais cela ne protege que des
// AUTRES comptes : tout programme lance par le streamer lui-meme y a acces --
// un plugin OBS, un launcher de jeu, un « optimiseur FPS » telecharge un soir.
// Un jeton Twitch vole, c'est la chaine.
//
// safeStorage d'Electron chiffre via DPAPI sous Windows : la cle appartient au
// COMPTE WINDOWS, elle ne quitte pas la machine, et nous ne la stockons nulle
// part. C'est la meme mecanique que celle qui protege les mots de passe
// enregistres dans Chrome.
//
// Deux consequences assumees :
//
//   - tokens.json n'est plus portable. Recopier %APPDATA%\StreamKit sur un
//     autre PC, ou vers un autre compte Windows, demandera de se reconnecter.
//     C'est exactement l'effet recherche, mais il faut le savoir avant de
//     l'attribuer a un bug.
//
//   - en ligne de commande (npm run dev), il n'y a pas d'Electron donc pas de
//     safeStorage : on ecrit en clair, comme avant. Le lanceur de
//     developpement, lui, passe par « npm start » (Electron) et beneficie donc
//     du chiffrement comme l'application livree.
//
// Ou vit la cle : Electron la range dans « Local State », a l'interieur de son
// userData (soit %APPDATA%\StreamKit\electron chez nous), elle-meme protegee
// par DPAPI. Deux consequences a garder en tete :
//
//   - vider ce dossier rend les secrets illisibles. Ce n'est pas un drame -- on
//     le detecte et on demande de se reconnecter -- mais il ne faut pas le
//     conseiller a la legere en support ;
//   - Chromium ecrit « Local State » a l'arret. Si l'application est tuee en
//     force (Gestionnaire des taches, coupure de courant) dans les secondes qui
//     suivent la TOUTE PREMIERE ecriture chiffree, la cle de cette session-la
//     n'est jamais persistee et ce qui vient d'etre chiffre est perdu.
//     Constate en recette, precisement de cette facon. La fenetre est etroite,
//     le degat se repare en se reconnectant, et l'alternative -- garder une
//     copie en clair a cote -- annulerait tout l'interet.
//
// Format : « enc:<base64> ». Tout ce qui ne porte pas ce prefixe est rendu tel
// quel -- c'est ce qui rend la migration invisible : un fichier existant en
// clair se lit sans rien changer, et se chiffre a la premiere ecriture.

import * as journal from './journal.js';

const log = journal.pour('coffre');

export const PREFIXE = 'enc:';

// L'implementation systeme (safeStorage), quand Electron nous la fournit.
let systeme = null;

// Un seul avertissement par sujet : ces fonctions sont appelees a chaque
// lecture de jeton, on ne va pas noyer le journal du live.
const dejaDit = new Set();

function unefois(cle, message) {
  if (dejaDit.has(cle)) return;
  dejaDit.add(cle);
  log.warn(message);
}

// Branche le coffre du systeme. Appele une fois au demarrage du noyau, avec
// safeStorage sous Electron et rien du tout en ligne de commande.
export function brancher(safeStorage) {
  dejaDit.clear();
  try {
    systeme = safeStorage?.isEncryptionAvailable?.() ? safeStorage : null;
  } catch {
    // Une implementation qui jette a l'interrogation ne merite pas qu'on lui
    // confie des jetons.
    systeme = null;
  }
  if (!systeme && safeStorage) {
    log.warn('Chiffrement des secrets indisponible sur ce systeme : tokens.json reste en clair.');
  }
  return !!systeme;
}

export function disponible() {
  return !!systeme;
}

export function estChiffre(valeur) {
  return typeof valeur === 'string' && valeur.startsWith(PREFIXE);
}

export function chiffrer(valeur) {
  if (typeof valeur !== 'string' || !valeur) return valeur;
  if (estChiffre(valeur)) return valeur; // deja fait
  if (!systeme) return valeur; // ligne de commande : repli en clair

  try {
    return PREFIXE + systeme.encryptString(valeur).toString('base64');
  } catch (e) {
    // Ne JAMAIS perdre un jeton pour un probleme de chiffrement : on ecrit en
    // clair et on le dit, plutot que de rendre la chaine inaccessible.
    unefois('chiffrement', 'Chiffrement impossible (' + (e?.message || e) + ') : secret ecrit en clair.');
    return valeur;
  }
}

export function dechiffrer(valeur) {
  if (!estChiffre(valeur)) return valeur;

  if (!systeme) {
    unefois(
      'sans-coffre',
      'Des secrets chiffres ont ete trouves, mais le coffre du systeme est indisponible ' +
        "(c'est le cas en ligne de commande). Lance StreamKit normalement, ou reconnecte tes comptes."
    );
    return '';
  }

  try {
    return systeme.decryptString(Buffer.from(valeur.slice(PREFIXE.length), 'base64'));
  } catch {
    // Cas concret : le dossier de donnees vient d'un autre PC ou d'un autre
    // compte Windows. La cle DPAPI n'est pas la, rien ne peut le sauver.
    unefois(
      'dechiffrement',
      'Secrets illisibles : la cle de chiffrement de ce PC ne correspond pas. ' +
        'Dossier de donnees venu d un autre poste ou d un autre compte Windows, ou cle perdue. ' +
        'Reconnecte tes comptes depuis le dashboard.'
    );
    return '';
  }
}
