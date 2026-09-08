// Mise a jour automatique depuis les releases GitHub.
//
// C'est la raison d'etre de StreamKit : corriger un bug une fois, et que les
// streamers l'aient sans rien reinstaller. Le mecanisme est volontairement
// simple et inspectable :
//
//   1. on demande a GitHub la derniere release du depot configure ;
//   2. si sa version est plus recente que celle de package.json, on telecharge
//      l'archive dans %APPDATA%\StreamKit\maj\ ;
//   3. on la decompresse (Expand-Archive, present sur tout Windows) ;
//   4. on ecrit un petit .bat qui : attend la fin du processus, recopie les
//      fichiers par-dessus l'installation, puis relance StreamKit ;
//   5. StreamKit se ferme et laisse le .bat travailler.
//
// Windows ne permet pas de remplacer les fichiers d'un programme qui tourne :
// d'ou l'etape 4, faite de l'exterieur. Les DONNEES ne sont jamais touchees,
// elles sont dans un autre dossier (voir paths.js).

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE, MAJ_DIR } from './paths.js';
import * as journal from './journal.js';
import * as store from './store.js';

const log = journal.pour('maj');

export function versionActuelle() {
  try {
    return JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
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
    const r = await fetch('https://api.github.com/repos/' + depot + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StreamKit' },
    });
    if (r.status === 404) return { ok: false, raison: 'depot ou release introuvable', actuelle };
    if (!r.ok) return { ok: false, raison: 'GitHub a repondu ' + r.status, actuelle };

    const release = await r.json();
    const derniere = String(release.tag_name || '').replace(/^v/, '');
    // On privilegie une archive .zip jointe a la release (elle contient
    // node_modules) ; a defaut, l'archive du code source.
    const asset = (release.assets ?? []).find((a) => a.name.endsWith('.zip'));

    const dispo = comparer(derniere, actuelle) > 0;
    return {
      ok: true,
      actuelle,
      derniere,
      dispo,
      notes: release.body || '',
      publieeLe: release.published_at,
      url: asset?.browser_download_url || release.zipball_url,
      nomArchive: asset?.name || 'streamkit-' + derniere + '.zip',
    };
  } catch (e) {
    return { ok: false, raison: 'reseau indisponible (' + (e?.message || e) + ')', actuelle };
  }
}

async function telecharger(url, destination) {
  const r = await fetch(url, { headers: { 'User-Agent': 'StreamKit' }, redirect: 'follow' });
  if (!r.ok) throw new Error('telechargement impossible (HTTP ' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(destination, buf);
  return buf.length;
}

function powershell(commande) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', commande], {
      windowsHide: true,
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || 'code ' + code))));
    p.on('error', reject);
  });
}

export async function appliquer({ redemarrer = true } = {}) {
  const info = await verifier();
  if (!info.ok) return { ok: false, raison: info.raison };
  if (!info.dispo) return { ok: false, raison: 'deja a jour (' + info.actuelle + ')' };

  if (process.platform !== 'win32') {
    return { ok: false, raison: 'mise a jour automatique prevue pour Windows uniquement' };
  }

  log.info('Mise a jour ' + info.actuelle + ' -> ' + info.derniere + ' : telechargement...');

  rmSync(MAJ_DIR, { recursive: true, force: true });
  mkdirSync(MAJ_DIR, { recursive: true });

  const archive = join(MAJ_DIR, info.nomArchive);
  const taille = await telecharger(info.url, archive);
  log.info('Archive recuperee (' + Math.round(taille / 1024) + ' Ko), decompression...');

  const extrait = join(MAJ_DIR, 'contenu');
  await powershell("Expand-Archive -LiteralPath '" + archive + "' -DestinationPath '" + extrait + "' -Force");

  // Une archive GitHub « source » range tout dans un sous-dossier unique
  // (projet-abc1234) ; une archive qu'on a fabriquee, non. On detecte.
  let source = extrait;
  const entrees = readdirSync(extrait);
  if (entrees.length === 1 && !existsSync(join(extrait, 'package.json'))) {
    source = join(extrait, entrees[0]);
  }
  if (!existsSync(join(source, 'package.json'))) {
    return { ok: false, raison: "l'archive ne ressemble pas a une installation StreamKit" };
  }

  const script = join(MAJ_DIR, 'appliquer-maj.bat');
  writeFileSync(
    script,
    [
      '@echo off',
      'chcp 65001 >nul',
      'title Mise a jour de StreamKit',
      'echo Mise a jour de StreamKit vers ' + info.derniere + '...',
      // On laisse le temps au processus de liberer ses fichiers.
      'timeout /t 3 /nobreak >nul',
      // /E sous-dossiers, /IS on remplace meme si identique, /NFL /NDL /NJH /NJS
      // silencieux. On ne supprime rien : robocopy ecrase et complete.
      'robocopy "' + source + '" "' + RACINE + '" /E /IS /NFL /NDL /NJH /NJS /R:2 /W:2',
      'echo Termine.',
      redemarrer ? 'start "" /D "' + RACINE + '" cmd /c "start.bat"' : 'pause',
      'exit',
    ].join('\r\n'),
    'utf8'
  );

  log.ok('Mise a jour prete. StreamKit va se fermer et redemarrer tout seul.');

  // detached + unref : le .bat survit a la fermeture de StreamKit, c'est tout
  // l'interet (il ne peut pas se remplacer lui-meme en cours d'execution).
  const enfant = spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: false });
  enfant.unref();

  setTimeout(() => process.exit(0), 500);
  return { ok: true, actuelle: info.actuelle, derniere: info.derniere };
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
