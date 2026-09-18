// Trouver Rocket League sur le PC, et allumer son API de stats.
//
// L'API est livree ETEINTE : `PacketSendRate=0` dans
// <installation>\TAGame\Config\DefaultStatsAPI.ini. Un streamer ne va pas
// fouiller ce fichier : un bouton du module le fait pour lui, avec une copie
// de sauvegarde. Le jeu ne relit ce reglage qu'a son demarrage.
//
// On modifie aussi la copie utilisateur (Documents\My Games\...\TAStatsAPI.ini)
// quand elle existe : c'est la version generee que le jeu garde de son cote,
// et on ne veut pas qu'elle contredise l'autre.

import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PORT_PAR_DEFAUT } from './flux.js';
import { requeteRegistre } from './journal-jeu.js';

const SECTION = 'TAGame.MatchStatsExporter_TA';

// Assez pour suivre une partie ; d'autres outils (overlays de diffusion)
// peuvent vouloir plus, on ne baisse donc jamais un reglage deja actif.
export const TAUX_ACTIVATION = 30;

// --- Le fichier .ini --------------------------------------------------------

// Lit la section de l'API. Absente ou illisible : valeurs du jeu par defaut.
export function lireIni(texte) {
  const valeurs = {};
  let dansSection = false;
  for (const brute of String(texte ?? '').split(/\r?\n/)) {
    const ligne = brute.trim();
    if (ligne.startsWith('[')) {
      dansSection = ligne === '[' + SECTION + ']';
      continue;
    }
    if (!dansSection || ligne.startsWith(';')) continue;
    const m = /^(\w+)\s*=\s*(.*)$/.exec(ligne);
    if (m) valeurs[m[1]] = m[2].trim();
  }
  const nombre = (v, defaut) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : defaut);
  return {
    port: nombre(valeurs.Port, PORT_PAR_DEFAUT),
    taux: nombre(valeurs.PacketSendRate, 0),
  };
}

// Met PacketSendRate a TAUX_ACTIVATION s'il vaut 0 (ou manque). Les
// commentaires et les autres reglages sont conserves a l'identique.
export function activerIni(texte) {
  const original = String(texte ?? '');
  if (lireIni(original).taux > 0) return { texte: original, change: false };

  const fin = original.includes('\r\n') ? '\r\n' : '\n';
  const lignes = original.split(/\r?\n/);
  const debut = lignes.findIndex((l) => l.trim() === '[' + SECTION + ']');

  if (debut < 0) {
    const ajout = ['[' + SECTION + ']', 'Port=' + PORT_PAR_DEFAUT, 'PacketSendRate=' + TAUX_ACTIVATION];
    const base = original.trim() ? original.replace(/\s*$/, fin + fin) : '';
    return { texte: base + ajout.join(fin) + fin, change: true };
  }

  let finSection = lignes.findIndex((l, i) => i > debut && l.trim().startsWith('['));
  if (finSection < 0) finSection = lignes.length;
  const existante = lignes.findIndex(
    (l, i) => i > debut && i < finSection && /^\s*PacketSendRate\s*=/.test(l)
  );
  if (existante >= 0) {
    lignes[existante] = 'PacketSendRate=' + TAUX_ACTIVATION;
  } else {
    // Juste apres la derniere ligne non vide de la section.
    let i = finSection;
    while (i - 1 > debut && !lignes[i - 1].trim()) i--;
    lignes.splice(i, 0, 'PacketSendRate=' + TAUX_ACTIVATION);
  }
  return { texte: lignes.join(fin), change: true };
}

// --- Les installations ------------------------------------------------------

// Epic range ses installations dans un JSON commun a tous ses jeux. Le nom
// interne de Rocket League y est « Sugar ».
function installationsEpic() {
  const fichier = join(
    process.env.ProgramData || 'C:\\ProgramData',
    'Epic',
    'UnrealEngineLauncher',
    'LauncherInstalled.dat'
  );
  try {
    const liste = JSON.parse(readFileSync(fichier, 'utf8')).InstallationList ?? [];
    return liste
      .filter((j) => j.AppName === 'Sugar' || /rocketleague/i.test(j.InstallLocation || ''))
      .map((j) => ({ plateforme: 'Epic', dossier: j.InstallLocation }));
  } catch {
    return [];
  }
}

// Steam : dossier principal (registre) puis bibliotheques supplementaires.
async function installationsSteam() {
  const racine = (await requeteRegistre('HKCU\\Software\\Valve\\Steam', 'SteamPath'))?.replace(/\//g, '\\');
  const bibliotheques = new Set();
  if (racine) bibliotheques.add(racine);
  bibliotheques.add('C:\\Program Files (x86)\\Steam');
  for (const b of [...bibliotheques]) {
    try {
      const vdf = readFileSync(join(b, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) bibliotheques.add(m[1].replace(/\\\\/g, '\\'));
    } catch {
      /* pas de Steam ici */
    }
  }
  return [...bibliotheques]
    .map((b) => join(b, 'steamapps', 'common', 'rocketleague'))
    .filter((d) => existsSync(d))
    .map((dossier) => ({ plateforme: 'Steam', dossier }));
}

export async function trouverInstallations() {
  const toutes = [...installationsEpic(), ...(await installationsSteam())];
  const vues = new Set();
  return toutes.filter((i) => {
    const cle = i.dossier.toLowerCase();
    if (vues.has(cle) || !existsSync(join(i.dossier, 'TAGame', 'Config'))) return false;
    vues.add(cle);
    return true;
  });
}

export const iniDe = (installation) => join(installation.dossier, 'TAGame', 'Config', 'DefaultStatsAPI.ini');

// La copie utilisateur, a cote de Launch.log : ...\TAGame\Logs -> ...\TAGame\Config
export const iniUtilisateur = (cheminLaunchLog) =>
  cheminLaunchLog ? join(dirname(dirname(cheminLaunchLog)), 'Config', 'TAStatsAPI.ini') : null;

// Les fichiers de reglage de l'API : celui de chaque installation, puis la copie
// utilisateur. Les deux modules Rocket League y lisent le meme port.
export async function fichiersApi(cheminLaunchLog) {
  const installations = await trouverInstallations();
  return [...installations.map(iniDe), iniUtilisateur(cheminLaunchLog)].filter(Boolean);
}

// Etat de l'API d'apres les fichiers : { active, port, fichiers }.
export function etatApi(fichiers) {
  const lus = fichiers
    .filter((f) => f && existsSync(f))
    .map((f) => ({ f, ...lireIni(readFileSync(f, 'utf8')) }));
  if (!lus.length) return { active: null, port: PORT_PAR_DEFAUT, fichiers: [] };
  return {
    // Le fichier de l'installation fait foi ; la copie utilisateur sert de repli.
    active: lus[0].taux > 0,
    port: lus[0].port,
    fichiers: lus.map((l) => l.f),
  };
}

// Active l'API dans chaque fichier fourni. Sauvegarde « .bak » a la premiere
// modification seulement : la copie garde l'etat d'origine du jeu.
export function activerFichiers(fichiers) {
  const rapport = [];
  for (const f of fichiers) {
    if (!f || !existsSync(f)) continue;
    try {
      const { texte, change } = activerIni(readFileSync(f, 'utf8'));
      if (change) {
        if (!existsSync(f + '.bak')) copyFileSync(f, f + '.bak');
        writeFileSync(f, texte, 'utf8');
      }
      rapport.push({ fichier: f, ok: true, change });
    } catch (e) {
      rapport.push({
        fichier: f,
        ok: false,
        erreur: e?.code === 'EPERM' || e?.code === 'EACCES' ? 'droits' : e?.message,
      });
    }
  }
  return rapport;
}

// Rocket League tourne-t-il ? Sert seulement a choisir le bon conseil quand
// l'API ne repond pas (« lance le jeu » ou « relance-le »).
export function jeuLance() {
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq RocketLeague.exe', '/NH', '/FO', 'CSV'],
      { windowsHide: true, timeout: 5000 },
      (err, sortie) => resolve(!err && /RocketLeague\.exe/i.test(String(sortie)))
    );
  });
}
