// Processus principal Electron — c'est ce que lance le streamer.
//
// Pourquoi Electron ici :
//   - le streamer n'installe plus Node.js (le runtime est dans l'application) ;
//   - une icone pres de l'horloge au lieu d'une fenetre noire a ne pas fermer ;
//   - un vrai installeur, un vrai raccourci, une vraie desinstallation ;
//   - le remplacement d'une application en cours d'execution est gere par
//     electron-updater, au lieu du .bat externe qu'imposait le lancement Node.
//
// Ce qui NE change pas : le serveur HTTP local reste, parce qu'OBS a besoin
// d'URLs pour ses sources Navigateur. La fenetre affiche simplement ce serveur.

import { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage } from 'electron';
import pkg from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { demarrerNoyau } from './noyau.js';
import * as journal from './core/journal.js';
import { versionActuelle } from './core/maj.js';

const { autoUpdater } = pkg;
const log = journal.pour('app');

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONE = join(RACINE, 'src', 'assets', 'icone.png');

let fenetre = null;
let icone = null;
let noyau = null;
let onQuitteVraiment = false;

// --- Mise a jour ------------------------------------------------------------
// On expose a la meme forme que maj.js pour que le dashboard n'ait pas a savoir
// qui l'implemente : le bouton « Mettre a jour » est identique dans les deux cas.

autoUpdater.autoDownload = false; // c'est le streamer qui declenche, jamais nous
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = {
  info: (m) => log.debug('maj: ' + m),
  warn: (m) => log.warn('maj: ' + m),
  error: (m) => log.err('maj: ' + m),
  debug: () => {},
};

let derniereConnue = null;

const updater = {
  async verifier() {
    const actuelle = versionActuelle();
    try {
      const r = await autoUpdater.checkForUpdates();
      const derniere = r?.updateInfo?.version;
      if (!derniere) return { ok: false, raison: 'aucune version publiee', actuelle };
      derniereConnue = derniere;
      return {
        ok: true,
        actuelle,
        derniere,
        dispo: derniere !== actuelle,
        notes: typeof r.updateInfo.releaseNotes === 'string' ? r.updateInfo.releaseNotes : '',
        publieeLe: r.updateInfo.releaseDate,
      };
    } catch (e) {
      return { ok: false, raison: 'verification impossible (' + (e?.message || e) + ')', actuelle };
    }
  },

  async appliquer() {
    const actuelle = versionActuelle();
    try {
      log.info('Telechargement de la mise a jour...');
      await autoUpdater.downloadUpdate();
      log.ok('Mise a jour prete. StreamKit va redemarrer.');
      // On laisse le temps a la reponse HTTP de partir avant de tout couper.
      setTimeout(async () => {
        onQuitteVraiment = true;
        await noyau?.fermer();
        autoUpdater.quitAndInstall(false, true);
      }, 800);
      return { ok: true, actuelle, derniere: derniereConnue };
    } catch (e) {
      log.err('Mise a jour impossible : ' + (e?.message || e));
      return { ok: false, raison: e?.message || String(e) };
    }
  },

  async verifierAuDemarrage() {
    const info = await updater.verifier();
    if (info.ok && info.dispo) {
      log.info(
        'Version ' + info.derniere + ' disponible (tu es en ' + info.actuelle +
          '). Bouton « Mettre a jour » dans le dashboard.'
      );
      majMenuIcone();
    }
    return info;
  },
};

// --- Demarrage avec Windows -------------------------------------------------
// Remplace les anciens .bat qui bricolaient un raccourci dans le dossier
// Demarrage : Electron le fait nativement, et sait aussi le retirer.
// `openAsHidden` : au demarrage de session, StreamKit se met directement pres
// de l'horloge sans ouvrir sa fenetre — un stream ne commence pas par une
// fenetre a fermer.

const demarrageAuto = {
  disponible: process.platform === 'win32',
  lire: () => app.getLoginItemSettings().openAtLogin,
  ecrire: (actif) => {
    app.setLoginItemSettings({ openAtLogin: !!actif, openAsHidden: true, args: ['--cache'] });
    return app.getLoginItemSettings().openAtLogin;
  },
};

// Lance-t-on depuis le demarrage de session ? Si oui, on n'ouvre pas la fenetre.
const lanceAuDemarrage =
  process.argv.includes('--cache') || app.getLoginItemSettings().wasOpenedAtLogin;

// --- Fenetre ----------------------------------------------------------------

function creerFenetre() {
  if (fenetre) {
    fenetre.show();
    fenetre.focus();
    return fenetre;
  }

  fenetre = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'StreamKit',
    icon: ICONE,
    backgroundColor: '#0d0d12', // evite le flash blanc au lancement
    autoHideMenuBar: true, // pas de barre Fichier/Edition : ce n'est pas un editeur
    show: false,
    webPreferences: {
      // Le dashboard n'est que du HTML servi par notre propre serveur local :
      // il n'a aucun besoin d'acceder a Node, autant ne pas le lui donner.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  fenetre.loadURL('http://127.0.0.1:' + noyau.port + '/');
  fenetre.once('ready-to-show', () => fenetre.show());

  // Une fenetre blanche est le cas de support le plus penible : le streamer dit
  // « ca marche pas » et on n'a rien pour trancher. On trace donc explicitement
  // le chargement du dashboard dans le journal.
  fenetre.webContents.on('did-finish-load', () => log.ok('Dashboard affiche.'));
  fenetre.webContents.on('did-fail-load', (_e, code, description, url) => {
    log.err('Dashboard non charge (' + code + ' ' + description + ') : ' + url);
  });
  fenetre.webContents.on('render-process-gone', (_e, details) => {
    log.err('La fenetre du dashboard a plante (' + details.reason + '). Rouvre-la depuis l icone.');
    fenetre = null;
  });

  // Les liens externes (console Twitch, tableau de bord Spotify, clips) partent
  // dans le vrai navigateur : le streamer y est deja connecte.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Fermer la fenetre ne quitte pas : le bot doit continuer pendant le live.
  // On previent une fois, sinon le streamer croit avoir tout arrete.
  fenetre.on('close', (e) => {
    if (onQuitteVraiment) return;
    e.preventDefault();
    fenetre.hide();
    if (!fenetre.aDejaPrevenu) {
      fenetre.aDejaPrevenu = true;
      icone?.displayBalloon?.({
        title: 'StreamKit continue de tourner',
        content: "Tes modules restent actifs. Pour tout arreter : clic droit sur l'icone > Quitter.",
        icon: nativeImage.createFromPath(ICONE),
      });
    }
  });

  return fenetre;
}

// --- Icone pres de l'horloge ------------------------------------------------

function majMenuIcone() {
  if (!icone) return;

  const etat = noyau?.etatGeneral?.();
  const twitchOk = etat?.twitch?.pret && etat?.twitch?.chatConnecte;
  const resume = etat
    ? (twitchOk ? '● Connecte — ' + etat.chaine : '○ Twitch non connecte') +
      '  (' + etat.modules.demarres + '/' + etat.modules.total + ' modules)'
    : 'Demarrage...';

  const menu = Menu.buildFromTemplate([
    { label: 'StreamKit ' + versionActuelle(), enabled: false },
    { label: resume, enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir le dashboard', click: () => creerFenetre() },
    {
      label: 'Ouvrir dans le navigateur',
      click: () => shell.openExternal('http://127.0.0.1:' + noyau.port + '/'),
    },
    { type: 'separator' },
    {
      label: 'Quitter StreamKit',
      click: async () => {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Annuler', 'Quitter'],
          defaultId: 0,
          cancelId: 0,
          title: 'Quitter StreamKit',
          message: 'Arreter StreamKit ?',
          detail: 'Tes modules ne repondront plus : bot musique, overlays, commandes de chat.',
        });
        if (response === 1) quitter();
      },
    },
  ]);

  icone.setContextMenu(menu);
  icone.setToolTip('StreamKit — ' + (twitchOk ? etat.chaine : 'non connecte'));
}

function creerIcone() {
  // resize : sans ca, Windows affiche une icone 256 px ecrasee et floue.
  const image = nativeImage.createFromPath(ICONE).resize({ width: 16, height: 16 });
  icone = new Tray(image);
  icone.on('double-click', () => creerFenetre());
  majMenuIcone();
  // L'etat bouge tout seul (chat qui se reconnecte, module qui tombe).
  setInterval(majMenuIcone, 5000);
}

// --- Cycle de vie -----------------------------------------------------------

async function quitter() {
  onQuitteVraiment = true;
  try {
    await noyau?.fermer();
  } catch {
    /* on quitte de toute facon */
  }
  app.quit();
}

// Deux StreamKit en parallele se disputeraient le port et les jetons : le second
// lancement se contente de ramener la fenetre du premier au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => creerFenetre());

  app.whenReady().then(async () => {
    try {
      noyau = await demarrerNoyau({ updater, demarrageAuto });
    } catch (e) {
      // Typiquement : le port est deja pris. Sans fenetre ni icone, le streamer
      // n'aurait aucun moyen de comprendre pourquoi rien ne se passe.
      dialog.showErrorBox('StreamKit n a pas pu demarrer', e?.message || String(e));
      app.quit();
      return;
    }

    creerIcone();
    // Lance au demarrage de Windows : on reste discret pres de l'horloge.
    if (!lanceAuDemarrage) creerFenetre();
    else log.info('Demarre avec Windows — fenetre masquee, icone pres de l horloge.');
  });

  // Sous Windows, fermer toutes les fenetres ne doit PAS quitter : c'est tout
  // l'interet de l'icone pres de l'horloge.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    onQuitteVraiment = true;
  });
}

process.on('unhandledRejection', (e) => log.err('Erreur non geree : ' + (e?.message || e)));
