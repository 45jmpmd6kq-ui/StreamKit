// Mise a jour : savoir OU on en est.
//
// C'est la raison d'etre de StreamKit : corriger un bug une fois, et que les
// streamers l'aient sans rien reinstaller. Ce fichier ne fait plus qu'une
// moitie du travail -- il REGARDE (version installee, derniere release
// publiee) ; c'est electron-updater, cable dans src/main.js, qui TELECHARGE et
// INSTALLE.
//
// Le partage n'a pas toujours ete la. Jusqu'a la 0.7, StreamKit se lancait avec
// Node en ligne de commande, et se mettait a jour lui-meme : telechargement du
// zip, Expand-Archive, puis un .bat externe qui recopiait les fichiers par-
// dessus l'installation (Windows refuse de remplacer les fichiers d'un
// programme qui tourne) avant de relancer start.bat. Ce code est parti :
//   - il relancait start.bat, supprime avec le passage a Electron -- une mise
//     a jour par cette voie ne serait donc jamais revenue ;
//   - il ne verifiait aucune empreinte, la ou electron-updater controle le
//     sha512 annonce par latest.yml ;
//   - il appelait process.exit() depuis le noyau, qui promet exactement
//     l'inverse (voir l'en-tete de noyau.js).
//
// Reste ici ce qui sert aux DEUX : la version installee et la consultation des
// releases GitHub. Les DONNEES ne sont jamais touchees par une mise a jour,
// elles vivent dans un autre dossier (voir paths.js).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './paths.js';
import * as journal from './journal.js';
import * as store from './store.js';
import { fetchAvecDelai } from './reseau.js';

const log = journal.pour('maj');

// La version est lue une fois pour toutes : package.json fait partie du CODE,
// et le code ne change pas pendant qu'on tourne -- une mise a jour relance
// l'application. Or versionActuelle() est appelee par l'etat general, par la
// sante et par l'icone pres de l'horloge toutes les 5 secondes : autant de
// lectures de disque bloquantes pour une chaine de six caracteres.
let version = null;

export function versionActuelle() {
  if (version) return version;
  try {
    version = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    version = '0.0.0';
  }
  return version;
}

// Comparaison de versions « x.y.z ». Renvoie 1 si a > b, -1 si a < b, 0 si egal.
export function comparer(a, b) {
  const na = String(a).replace(/^v/, '').split('.').map(Number);
  const nb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = na[i] || 0;
    const y = nb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export async function verifier() {
  const config = store.getConfig();
  const depot = (config.maj?.depot || '').trim();
  const actuelle = versionActuelle();

  if (!depot) return { ok: false, raison: 'aucun depot configure', actuelle };

  try {
    const r = await fetchAvecDelai('https://api.github.com/repos/' + depot + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StreamKit' },
    });
    if (r.status === 404) return { ok: false, raison: 'depot ou release introuvable', actuelle };
    if (!r.ok) return { ok: false, raison: 'GitHub a repondu ' + r.status, actuelle };

    const release = await r.json();
    const derniere = String(release.tag_name || '').replace(/^v/, '');

    // On ne renvoie plus l'adresse de l'archive : personne ne la telecharge
    // ici, c'est electron-updater qui s'en occupe a partir de latest.yml.
    return {
      ok: true,
      actuelle,
      derniere,
      dispo: comparer(derniere, actuelle) > 0,
      notes: release.body || '',
      publieeLe: release.published_at,
    };
  } catch (e) {
    return { ok: false, raison: 'reseau indisponible (' + (e?.message || e) + ')', actuelle };
  }
}

// L'installation elle-meme appartient a electron-updater (voir src/main.js),
// qui sait remplacer une application en cours d'execution et verifie
// l'empreinte de ce qu'il telecharge. En ligne de commande (npm run dev), il
// n'y a pas d'installation a faire : on travaille dans le depot.
export async function appliquer() {
  return {
    ok: false,
    raison:
      'la mise a jour passe par l application StreamKit ; ' +
      'en ligne de commande, fais un git pull',
    actuelle: versionActuelle(),
  };
}

// Verification silencieuse au demarrage : on informe, on n'impose rien.
// Une mise a jour qui s'applique toute seule au lancement, c'est un stream qui
// commence par une surprise -- le streamer choisit son moment.
export async function verifierAuDemarrage() {
  const config = store.getConfig();
  if (!config.maj?.auto || !config.maj?.depot) return null;
  const info = await verifier();
  if (info.ok && info.dispo) {
    log.info('Version ' + info.derniere + ' disponible (tu es en ' + info.actuelle + '). Bouton « Mettre a jour » dans le dashboard.');
  }
  return info;
}
