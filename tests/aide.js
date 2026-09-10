// Outillage commun aux tests.
//
// Deux precautions valent pour TOUS les fichiers de test :
//
//   1. STREAMKIT_DATA est pose AVANT le premier import du code. paths.js lit
//      cette variable au chargement du module (const DONNEES = ...), pas a
//      l'appel : un import trop tot ferait ecrire les tests dans le vrai
//      %APPDATA%\StreamKit, donc sur la configuration et les jetons du
//      streamer qui lance la suite.
//
//   2. Chaque fichier de test tourne dans son PROPRE processus (c'est ainsi
//      que fonctionne `node --test`), donc chacun a son dossier de donnees et
//      ils ne se marchent pas dessus.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A appeler en TOUTE PREMIERE ligne du fichier de test, avant les import().
export function dossierDeDonneesJetable() {
  const d = mkdtempSync(join(tmpdir(), 'streamkit-test-'));
  process.env.STREAMKIT_DATA = d;
  return d;
}

export function nettoyer(dossier) {
  rmSync(dossier, { recursive: true, force: true });
}
