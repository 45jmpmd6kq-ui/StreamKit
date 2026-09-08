// Lancement en ligne de commande : node src/index.js
//
// Sert au developpement et aux tests. Le streamer, lui, recoit l'application
// Electron (src/main.js) : pas de fenetre noire, une icone pres de l'horloge,
// et Node.js embarque.
//
// Les deux partagent le meme noyau, donc ce qu'on verifie ici est exactement ce
// qui tournera chez lui.

import { demarrerNoyau } from './noyau.js';
import * as journal from './core/journal.js';

const log = journal.pour('noyau');

let noyau;
try {
  noyau = await demarrerNoyau();
} catch (e) {
  log.err(e.message);
  process.exit(1);
}

async function fermer() {
  await noyau.fermer();
  process.exit(0);
}

process.on('SIGINT', fermer);
process.on('SIGTERM', fermer);
process.on('unhandledRejection', (e) => log.err('Erreur non geree : ' + (e?.message || e)));
process.on('uncaughtException', (e) => log.err('Exception non capturee : ' + (e?.message || e)));
