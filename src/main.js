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
import { DONNEES } from './core/paths.js';
import { versionActuelle, comparer } from './core/maj.js';

const { autoUpdater } = pkg;
const log = journal.pour('app');

// Electron range SES donnees (cache Chromium, cookies, preferences, GPUCache)
// dans %APPDATA%\<productName> — exactement le dossier ou StreamKit met
// config.json, tokens.json, etat/ et journaux/. Sans separation, 6 Mo de cache
// noient les 6 Ko qui comptent vraiment, et le dossier qu'on demande au
// streamer de ne jamais partager devient illisible : impossible de lui dire
// « envoie-moi ce dossier » pour du support.
//
// A appeler AVANT requestSingleInstanceLock, qui pose son verrou dans userData.
app.setPath('userData', join(DONNEES, 'electron'));

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

// electron-updater deverse l'erreur brute : message, tous les en-tetes HTTP et
// la pile d'appels, soit une quarantaine de lignes pour un simple 404. Le
// journal est l'outil de support de StreamKit -- s'il devient illisible, il ne
// sert plus a rien. On condense en une phrase, et on garde le detail en debug
// pour quand j'en ai vraiment besoin.
function resumerErreurMaj(e) {
  const brut = String(e?.message || e || '');
  const premiere = brut.split('\n')[0];

  if (/latest\.yml/i.test(brut)) {
    return "la derniere release publiee ne contient pas latest.yml (il faut le joindre a la release)";
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/i.test(brut)) {
    return 'GitHub injoignable — connexion, VPN ou pare-feu';
  }
  if (/\b404\b/.test(brut)) return 'aucune release publiee sur le depot';
  if (/sha512|checksum/i.test(brut)) return 'le fichier telecharge ne correspond pas a la release (empreinte invalide)';
  return premiere.slice(0, 200);
}

autoUpdater.logger = {
  info: (m) => log.debug('maj: ' + m),
  warn: (m) => log.warn('maj: ' + m),
  // Ne pas verifier une mise a jour n'empeche pas de streamer : c'est un
  // avertissement, pas une erreur qui merite d'alarmer le streamer en plein live.
  error: (m) => {
    log.warn('Mise a jour indisponible : ' + resumerErreurMaj(m));
    log.debug('maj (detail) : ' + String(m?.message || m).split('\n')[0]);
  },
  debug: () => {},
};

autoUpdater.on('error', (e) => log.debug('maj (evenement) : ' + resumerErreurMaj(e)));

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
        // comparer() et pas « !== » : une release plus ancienne que
        // l'installee (rollback, tag retire) affichait « Mettre a jour » vers
        // une version inferieure. electron-updater aurait refuse de la poser,
        // mais le bouton, lui, mentait.
        dispo: comparer(derniere, actuelle) > 0,
        notes: typeof r.updateInfo.releaseNotes === 'string' ? r.updateInfo.releaseNotes : '',
        publieeLe: r.updateInfo.releaseDate,
      };
    } catch (e) {
      return { ok: false, raison: resumerErreurMaj(e), actuelle };
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
        // Demontage complet AVANT de rendre la main a l'installeur.
        //
        // Ce n'est pas de la coquetterie : l'installeur attend que le processus
        // soit mort pour remplacer les fichiers puis relancer l'application. Or
        // l'icone pres de l'horloge et son minuteur de rafraichissement gardent
        // Electron vivant. Resultat constate en 0.2.0 -> 0.2.1 : la mise a jour
        // s'installe bien, mais StreamKit ne redemarre pas.
        onQuitteVraiment = true;
        await noyau?.fermer();
        arreterRafraichissementIcone();
        icone?.destroy();
        icone = null;
        fenetre?.destroy();
        fenetre = null;

        // isSilent = true : pas d'assistant d'installation. Le streamer a clique
        // sur « Mettre a jour », il n'a pas demande a rechoisir un dossier.
        // isForceRunAfter = true : StreamKit se relance derriere.
        autoUpdater.quitAndInstall(true, true);

        // Filet de securite : si quelque chose retient encore le processus,
        // on force la sortie. Un StreamKit fantome empecherait l'installeur de
        // faire son travail, et le port 4455 resterait pris.
        setTimeout(() => app.exit(0), 4000);
      }, 800);
      return { ok: true, actuelle, derniere: derniereConnue };
    } catch (e) {
      log.err('Mise a jour impossible : ' + resumerErreurMaj(e));
      return { ok: false, raison: resumerErreurMaj(e) };
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
//
// C'est l'argument `--cache` qui fait tout le travail : au demarrage de
// session, StreamKit se met directement pres de l'horloge sans ouvrir sa
// fenetre — un stream ne commence pas par une fenetre a fermer.
//
// Il y avait ici deux autres champs, `openAsHidden` a l'ecriture et
// `wasOpenedAtLogin` a la lecture. Tous deux etaient documentes macOS
// uniquement : sous Windows, le premier etait ignore et le second valait
// toujours undefined. Ils ne servaient donc a rien, et `openAsHidden` a fini
// par disparaitre completement d'Electron (44). Le comportement, lui, ne
// change pas d'un iota.

const demarrageAuto = {
  disponible: process.platform === 'win32',
  lire: () => app.getLoginItemSettings().openAtLogin,
  ecrire: (actif) => {
    app.setLoginItemSettings({ openAtLogin: !!actif, args: ['--cache'] });
    return app.getLoginItemSettings().openAtLogin;
  },
};

// Lance-t-on depuis le demarrage de session ? Si oui, on n'ouvre pas la fenetre.
const lanceAuDemarrage = process.argv.includes('--cache');

// --- Liens exterieurs -------------------------------------------------------
//
// shell.openExternal ne se contente pas d'ouvrir un navigateur : il remet l'URL
// au SYSTEME, qui la confie au gestionnaire du protocole. « file: » ouvre
// l'explorateur, et n'importe quel logiciel installe enregistre le sien --
// « steam: », « ms-settings: », « vscode: »... StreamKit n'emet que des liens
// web (console Twitch, tableau de bord Spotify, un clip) : on n'accepte donc
// que des liens web, et on jette le reste avec une ligne de journal.
function ouvrirDehors(url) {
  let schema;
  try {
    schema = new URL(url).protocol;
  } catch {
    log.warn('Lien exterieur ignore (URL illisible) : ' + url);
    return;
  }
  if (schema !== 'http:' && schema !== 'https:') {
    log.warn('Lien exterieur refuse (schema « ' + schema + ' ») : ' + url);
    return;
  }
  shell.openExternal(url);
}

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
    ouvrirDehors(url);
    return { action: 'deny' };
  });

  // Cette fenetre ne doit JAMAIS quitter le dashboard local.
  //
  // Sans cette garde, un lien sans target=_blank, une redirection ou un
  // window.location suffisait a lui faire charger un site exterieur -- dans une
  // fenetre qui, elle, a le droit de parler a l'API locale et donc aux jetons.
  // On bloque ; si c'etait un lien web, il part dans le vrai navigateur, et le
  // streamer voit exactement ce qu'il aurait vu avec un clic normal.
  const base = 'http://127.0.0.1:' + noyau.port + '/';
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(base)) return;
    e.preventDefault();
    log.warn('Navigation hors du dashboard bloquee : ' + url);
    ouvrirDehors(url);
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

// Dernier resume affiche : reconstruire le menu a l'identique toutes les 5
// secondes le REFERME sous la souris du streamer qui vient de l'ouvrir. On ne
// touche a rien tant que le texte n'a pas bouge.
let dernierResumeIcone = null;

function majMenuIcone() {
  if (!icone) return;

  const etat = noyau?.etatGeneral?.();
  const twitchOk = etat?.twitch?.pret && etat?.twitch?.chatConnecte;
  const resume = etat
    ? (twitchOk ? '● Connecte — ' + etat.chaine : '○ Twitch non connecte') +
      '  (' + etat.modules.demarres + '/' + etat.modules.total + ' modules)'
    : 'Demarrage...';

  if (resume === dernierResumeIcone) return;
  dernierResumeIcone = resume;

  const menu = Menu.buildFromTemplate([
    { label: 'StreamKit ' + versionActuelle(), enabled: false },
    { label: resume, enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir le dashboard', click: () => creerFenetre() },
    {
      label: 'Ouvrir dans le navigateur',
      click: () => ouvrirDehors('http://127.0.0.1:' + noyau.port + '/'),
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

// Minuteur de rafraichissement de l'icone. On garde sa reference : un minuteur
// actif maintient Electron en vie, ce qui empeche l'installeur de mise a jour
// de reprendre la main (voir updater.appliquer).
let rafraichissementIcone = null;

function arreterRafraichissementIcone() {
  clearInterval(rafraichissementIcone);
  rafraichissementIcone = null;
}

function creerIcone() {
  // resize : sans ca, Windows affiche une icone 256 px ecrasee et floue.
  const image = nativeImage.createFromPath(ICONE).resize({ width: 16, height: 16 });
  icone = new Tray(image);
  icone.on('double-click', () => creerFenetre());
  majMenuIcone();
  // L'etat bouge tout seul (chat qui se reconnecte, module qui tombe).
  rafraichissementIcone = setInterval(majMenuIcone, 5000);
}

// --- Cycle de vie -----------------------------------------------------------

async function quitter() {
  onQuitteVraiment = true;
  try {
    await noyau?.fermer();
  } catch {
    /* on quitte de toute facon */
  }
  // Meme demontage que pour la mise a jour : l'icone et son minuteur gardent
  // Electron vivant, et le port 4455 resterait pris par un processus fantome.
  arreterRafraichissementIcone();
  icone?.destroy();
  icone = null;
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

// Meme filet que dans index.js, et il manquait justement ici -- la ou il compte
// le plus. Sans lui, la moindre exception non rattrapee (un flux de fichier qui
// echoue, une dependance qui jette) fait afficher a Electron sa boite d'erreur
// et tue le processus : icone, bot, overlays, tout s'arrete en plein live. Une
// ligne dans le journal est infiniment preferable.
process.on('uncaughtException', (e) => log.err('Exception non capturee : ' + (e?.message || e)));
