// Serveur HTTP unique de StreamKit.
//
// Un seul port pour tout, au lieu d'un port par projet comme aujourd'hui :
//   /                        le dashboard
//   /api/...                 l'API que consomme le dashboard
//   /overlay/<module>/<vue>  les sources Navigateur a coller dans OBS
//   /overlay/<module>/<vue>/flux   le flux temps reel de cet overlay
//
// Le serveur n'ecoute que sur les boucles locales (127.0.0.1 et ::1, voir
// ecouter) : rien n'est expose sur le reseau ni sur internet. C'est volontaire
// -- les jetons du streamer sont derriere.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DASHBOARD_DIR, MODULES_DIR, JOURNAUX_DIR } from './paths.js';
import * as journal from './journal.js';
import * as diffusion from './diffusion.js';

const log = journal.pour('serveur');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.log': 'text/plain; charset=utf-8',
};

function json(res, code, data) {
  const corps = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(corps),
  });
  res.end(corps);
}

function texte(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

// On accumule des Buffer, puis on decode une seule fois en UTF-8.
// Concatener les morceaux dans une chaine (brut += c) casserait tout caractere
// accentue tombant a cheval sur deux paquets TCP : « é » deviendrait « <?> ».
// Invisible sur un petit formulaire, systematique sur une longue blocklist.
async function corpsJson(req, limite = 512 * 1024) {
  return new Promise((resolve, reject) => {
    // Seconde barriere anti-CSRF, independante du controle d'origine.
    //
    // Une page web ne peut envoyer QUE trois types de contenu sans declencher
    // un preflight CORS : text/plain, multipart/form-data et
    // application/x-www-form-urlencoded. En n'acceptant que application/json,
    // on sort du lot des requetes « simples » : le navigateur devra demander
    // l'autorisation avant d'envoyer quoi que ce soit, et ne l'obtiendra pas.
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type && type !== 'application/json') {
      return reject(new Error('format attendu : application/json'));
    }

    const morceaux = [];
    let taille = 0;
    req.on('data', (c) => {
      taille += c.length;
      if (taille > limite) {
        reject(new Error('corps trop volumineux'));
        req.destroy();
        return;
      }
      morceaux.push(c);
    });
    req.on('end', () => {
      if (!taille) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(morceaux).toString('utf8')));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

// --- Content-Security-Policy -----------------------------------------------
//
// Le dashboard, les overlays et l'API partagent la MEME origine, et les jetons
// du streamer sont derriere. Un script qui arriverait a s'executer dans une de
// ces pages (un pseudo de viewer mal echappe, une regression dans un esc())
// aurait donc acces a tout. La CSP est la seconde barriere : meme dans ce cas,
// il ne peut ni charger du code d'ailleurs, ni ressortir quoi que ce soit.
//
// script-src par NONCE plutot que 'unsafe-inline' : chaque overlay porte son
// <script> inline, et c'est justement ce qui le rend autonome -- un dossier de
// module se copie tel quel. On lui donne donc un jeton, different a chaque
// reponse. Cela ne tient que parce qu'aucune page n'utilise onclick= ni
// javascript: : ces deux formes-la, le nonce ne les couvre pas.
//
// style-src reste 'unsafe-inline'. Le dashboard pose des attributs style=, que
// le nonce ne couvre pas non plus ; il faudrait style-src-attr, que Firefox ne
// connait pas -- et « Ouvrir dans le navigateur » y enverrait un dashboard sans
// mise en page. Un style injecte n'execute pas de code : le risque n'a rien de
// comparable a celui d'un script.
function csp(nonce) {
  return [
    "default-src 'self'",
    nonce ? "script-src 'self' 'nonce-" + nonce + "'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // data: pour le favicon SVG du dashboard ; media.valorant-api.com pour les
    // icones de rang du bandeau Valorant, servies par l'editeur du jeu.
    "img-src 'self' data: https://media.valorant-api.com",
    // fetch et EventSource des overlays : tout est local, rien ne sort.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

// Entetes de la page de retour OAuth (voir auth.pageRetour). Elle recopie un
// message venu de Twitch ou de Spotify (?error=...) : c'est le seul HTML de
// StreamKit dont le contenu vient de l'exterieur. Il est echappe, mais ici on
// peut aller jusqu'a script-src 'none' -- cette page n'a aucun script.
export const ENTETES_PAGE_OAUTH = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};

// Sert une page HTML en y posant le nonce de ses scripts.
//
// On lit le fichier au lieu de le diffuser en flux : il faut le reecrire. Ce
// sont quelques kilo-octets, et ces pages ne sont de toute facon jamais mises
// en cache -- contrairement a leurs images, qui passent par servirFichier.
async function servirHtml(res, chemin) {
  let html;
  try {
    html = await readFile(chemin, 'utf8');
  } catch {
    return texte(res, 404, 'Introuvable');
  }

  const nonce = randomBytes(16).toString('base64');
  // « <script> » et « <script src=... > », jamais « </script> » : le lookahead
  // impose une espace ou le chevron fermant juste apres le nom de la balise.
  html = html.replace(/<script(?=[\s>])/gi, '<script nonce="' + nonce + '"');

  res.writeHead(200, {
    'Content-Type': MIME['.html'],
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': csp(nonce),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

// Resout `relatif` DANS `base`, ou renvoie null si on en sort.
//
// normalize() reduit les « .. » : il suffit ensuite de verifier que le resultat
// commence toujours par le dossier autorise. Le separateur final n'est pas du
// zele -- sans lui, « modules/overlay-bis » passerait le test pour la base
// « modules/overlay ».
function cheminSous(base, relatif) {
  const racine = normalize(base);
  const prefixe = racine.endsWith(sep) ? racine : racine + sep;
  const cible = normalize(join(racine, relatif));
  return cible.startsWith(prefixe) ? cible : null;
}

// Sert un fichier en empechant toute sortie du dossier autorise (../..).
function servirFichier(res, base, relatif, { cache = false } = {}) {
  const cible = cheminSous(base, relatif);
  if (!cible) return texte(res, 403, 'Interdit');

  // statSync et pas existsSync : un DOSSIER existe, lui aussi. Or
  // createReadStream sur un dossier emet EISDIR de facon asynchrone -- sans
  // gestionnaire d'erreur, c'etait une exception non rattrapee, et sous
  // Electron l'application entiere mourait. Une balise <img> pointant sur
  // /overlay/roue-rl/roue/cars, posee sur n'importe quel site, suffisait donc a
  // couper le stream : une requete d'image n'envoie pas d'Origin, et l'en-tete
  // Host est legitime, les deux gardes laissent passer.
  if (!statSync(cible, { throwIfNoEntry: false })?.isFile()) return texte(res, 404, 'Introuvable');

  const flux = createReadStream(cible);

  // Le fichier peut encore disparaitre entre le stat et l'ouverture (antivirus,
  // mise a jour de module). On n'ecrit donc l'en-tete qu'une fois le descripteur
  // ouvert : tant qu'il ne l'est pas, on peut encore repondre une erreur propre.
  flux.once('open', () => {
    res.writeHead(200, {
      'Content-Type': MIME[extname(cible).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': cache ? 'public, max-age=3600' : 'no-cache',
      // Plancher : ces reponses-la sont des images, des scripts et des feuilles
      // de style, jamais du HTML a nonce (les pages passent par servirHtml).
      'Content-Security-Policy': csp(null),
      // Sans nosniff, un fichier de type inconnu tombe en octet-stream et le
      // navigateur devine -- il peut donc decider d'executer ce qu'on lui sert.
      'X-Content-Type-Options': 'nosniff',
    });
    flux.pipe(res);
  });

  flux.once('error', (e) => {
    log.warn('Lecture impossible (' + relatif + ') : ' + (e?.message || e));
    if (!res.headersSent) texte(res, 500, 'Lecture impossible');
    else res.destroy();
  });

  // pipe() ne detruit pas la source quand la destination se ferme : un OBS qui
  // coupe sa source en plein telechargement laisserait le descripteur ouvert.
  res.once('close', () => flux.destroy());
}

// --- Qui a le droit de nous parler ? ---------------------------------------
//
// N'ecouter que sur la boucle locale protege du RESEAU, pas du NAVIGATEUR du
// streamer -- et c'est par la que passent les deux attaques qui nous concernent :
//
//   CSRF : n'importe quelle page ouverte dans un onglet peut envoyer un POST
//   vers 127.0.0.1:4455. Sans controle, elle reecrit les identifiants Twitch,
//   declenche une action de module ou force une mise a jour. Le navigateur
//   joint TOUJOURS un en-tete Origin a une requete qui change quelque chose :
//   il suffit de le lire.
//
//   Rebinding DNS : un domaine attaquant qui resout vers 127.0.0.1 devient
//   MEME ORIGINE que le dashboard -- Origin devient legitime, et la page lit
//   alors tout ce que l'API renvoie. La parade est ailleurs : ce domaine reste
//   dans l'en-tete Host, et nous ne repondons qu'a des noms qu'on reconnait.
//
// Les deux controles sont donc complementaires, aucun ne remplace l'autre.

const HOTES_LOCAUX = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// « 127.0.0.1:4455 », « localhost », « [::1]:4455 » -> autorise ou non.
function hoteLocal(valeur, port) {
  if (!valeur) return false; // HTTP/1.1 impose Host : son absence est louche
  // On coupe au DERNIER deux-points, et seulement s'il suit le crochet
  // fermant : sans ca, « [::1]:4455 » serait decoupe au milieu de l'adresse.
  const i = valeur.lastIndexOf(':');
  const avecPort = i > valeur.lastIndexOf(']');
  const nom = (avecPort ? valeur.slice(0, i) : valeur).toLowerCase();
  const p = avecPort ? valeur.slice(i + 1) : '';
  if (!HOTES_LOCAUX.has(nom)) return false;
  return !p || p === String(port);
}

function origineLocale(origine, port) {
  if (!origine) return true; // pas d'Origin : navigation directe, retour OAuth
  try {
    // « null » (iframe bac a sable) fait echouer le parsing : c'est voulu.
    return hoteLocal(new URL(origine).host, port);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

export function creerServeur(app) {
  // `app` fournit les dependances (registre, twitch, maj...) : le serveur ne
  // connait rien du reste, il ne fait que router.

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const methode = req.method ?? 'GET';
    let chemin = url.pathname;

    if (!hoteLocal(req.headers.host, app.port) || !origineLocale(req.headers.origin, app.port)) {
      // On ne dit pas pourquoi : une page qui sonde n'a pas a savoir si elle
      // s'est trompee d'hote ou d'origine. Le journal, lui, le dit.
      log.warn(
        'Requete refusee (hote « ' + (req.headers.host ?? '?') + ' »' +
          (req.headers.origin ? ', origine « ' + req.headers.origin + ' »' : '') +
          ') : ' + methode + ' ' + chemin
      );
      return texte(res, 403, 'Interdit');
    }

    // Le decodage est fait APRES le controle d'acces, et surtout dans un try :
    // « /overlay/%E0%A4%A » est une sequence percent tronquee, decodeURIComponent
    // leve alors URIError. Comme ce handler est async, le rejet partait dans le
    // vide -- aucune reponse n'etait envoyee et la connexion restait pendue.
    try {
      chemin = decodeURIComponent(chemin);
    } catch {
      return texte(res, 400, 'Chemin invalide');
    }

    try {
      // --- Overlays OBS ----------------------------------------------------
      // /overlay/<module>/<vue>[/flux][/<fichier>]
      if (chemin.startsWith('/overlay/')) {
        const bouts = chemin.slice('/overlay/'.length).split('/').filter(Boolean);
        const [idModule, vue, ...reste] = bouts;
        const m = app.registre.get(idModule);
        if (!m) return texte(res, 404, 'Module inconnu');

        const dossierOverlay = join(MODULES_DIR, m.dossier, 'overlay');

        if (reste[0] === 'flux') {
          diffusion.brancher('overlay:' + idModule + ':' + vue, req, res);
          return;
        }
        if (reste.length) return servirFichier(res, dossierOverlay, reste.join('/'), { cache: true });

        const def = (m.manifeste.overlays ?? []).find((o) => o.chemin === vue);
        if (!def) return texte(res, 404, 'Overlay inconnu');
        const page = cheminSous(dossierOverlay, def.fichier);
        if (!page) return texte(res, 403, 'Interdit');
        return servirHtml(res, page);
      }

      // --- Pages d'un module -----------------------------------------------
      // /module/<id>/<page>[/<fichier>]
      //
      // Certains modules ont besoin d'une interface que le formulaire genere ne
      // peut pas rendre : cocher 137 voitures Rocket League dans une grille
      // d'icones, par exemple. Le module fournit sa page, StreamKit la sert et
      // le dashboard y met un bouton. Elle dialogue avec le module via ses
      // actions, comme le dashboard lui-meme.
      if (chemin.startsWith('/module/')) {
        const bouts = chemin.slice('/module/'.length).split('/').filter(Boolean);
        const [idModule, page, ...reste] = bouts;
        const m = app.registre.get(idModule);
        if (!m) return texte(res, 404, 'Module inconnu');

        const dossierPages = join(MODULES_DIR, m.dossier, 'pages');

        if (reste.length) {
          // Les fichiers d'une page sont cherches dans pages/, puis dans
          // overlay/. Une page et un overlay partagent souvent les memes images
          // -- les 137 icones de voitures de la roue, par exemple : 1,5 Mo qu'on
          // ne va pas dupliquer pour une question de dossier.
          const relatif = reste.join('/');
          const dansPages = cheminSous(dossierPages, relatif);
          if (dansPages && statSync(dansPages, { throwIfNoEntry: false })?.isFile()) {
            return servirFichier(res, dossierPages, relatif, { cache: true });
          }
          return servirFichier(res, join(MODULES_DIR, m.dossier, 'overlay'), relatif, { cache: true });
        }

        const def = (m.manifeste.pages ?? []).find((p) => p.chemin === page);
        if (!def) return texte(res, 404, 'Page inconnue');
        const fichier = cheminSous(dossierPages, def.fichier);
        if (!fichier) return texte(res, 403, 'Interdit');
        return servirHtml(res, fichier);
      }

      // --- API -------------------------------------------------------------
      if (chemin.startsWith('/api/')) {
        // Etat general (bandeau du dashboard)
        if (chemin === '/api/etat' && methode === 'GET') {
          return json(res, 200, app.etatGeneral());
        }

        // Vue d'ensemble des connexions (Twitch, OBS, Spotify, Riot...)
        if (chemin === '/api/sante' && methode === 'GET') {
          return json(res, 200, await app.sante());
        }

        // --- Connecteurs : identifiants d'application et autorisation ---
        if (chemin === '/api/connecteurs' && methode === 'GET') {
          return json(res, 200, app.etatConnecteurs());
        }

        const mConn = chemin.match(/^\/api\/connecteurs\/([\w-]+)\/(\w+)$/);
        if (mConn && methode === 'POST') {
          const [, id, quoi] = mConn;
          const body = await corpsJson(req);
          if (quoi === 'app') return json(res, 200, await app.definirAppConnecteur(id, body));
          if (quoi === 'autoriser') return json(res, 200, await app.autoriserConnecteur(id));
          if (quoi === 'deconnecter') return json(res, 200, await app.deconnecterConnecteur(id));
          if (quoi === 'chaine') return json(res, 200, await app.definirChaine(body.channel));
          return json(res, 404, { erreur: 'action inconnue' });
        }

        // --- Modules ---
        if (chemin === '/api/modules' && methode === 'GET') {
          return json(res, 200, app.registre.vues());
        }

        const mModule = chemin.match(/^\/api\/modules\/([\w-]+)(?:\/(\w+))?$/);
        if (mModule) {
          const [, id, sousRoute] = mModule;
          if (!app.registre.get(id)) return json(res, 404, { erreur: 'module inconnu' });

          if (!sousRoute && methode === 'GET') return json(res, 200, app.registre.vue(id));

          if (sousRoute === 'actif' && methode === 'POST') {
            const body = await corpsJson(req);
            await app.definirActif(id, !!body.actif);
            return json(res, 200, app.registre.vue(id));
          }

          if (sousRoute === 'config' && methode === 'POST') {
            const body = await corpsJson(req);
            const r = app.registre.definirReglages(id, body.reglages ?? body);
            if (!r.ok) return json(res, 400, { erreur: 'reglages invalides', details: r.erreurs });
            await app.recharger(id);
            return json(res, 200, app.registre.vue(id));
          }

          if (sousRoute === 'redemarrer' && methode === 'POST') {
            await app.recharger(id);
            return json(res, 200, app.registre.vue(id));
          }
        }

        // Action personnalisee exposee par un module (bouton « Tester », etc.)
        const mAction = chemin.match(/^\/api\/modules\/([\w-]+)\/action\/([\w-]+)$/);
        if (mAction && methode === 'POST') {
          const [, id, nom] = mAction;
          const body = await corpsJson(req);
          const r = await app.executerAction(id, nom, body);
          return json(res, r.ok ? 200 : 400, r);
        }

        // --- Journal ---
        if (chemin === '/api/journal' && methode === 'GET') {
          return json(res, 200, {
            sources: journal.sources(),
            niveaux: journal.NIVEAUX,
            lignes: journal.historique({
              source: url.searchParams.get('source') || undefined,
              niveau: url.searchParams.get('niveau') || undefined,
              recherche: url.searchParams.get('q') || undefined,
              depuis: Number(url.searchParams.get('depuis') || 0),
              limite: Number(url.searchParams.get('limite') || 500),
            }),
          });
        }

        if (chemin === '/api/journal/flux' && methode === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          });
          res.write('retry: 2000\n\n');
          const stop = journal.abonner((entree) => {
            try {
              res.write('event: ligne\ndata: ' + JSON.stringify(entree) + '\n\n');
            } catch {
              stop();
            }
          });
          const battement = setInterval(() => {
            try {
              res.write(': ping\n\n');
            } catch {
              /* ferme au prochain close */
            }
          }, 25000);
          req.on('close', () => {
            clearInterval(battement);
            stop();
          });
          return;
        }

        // Liste des fichiers de journal (pour telecharger la soiree d'hier)
        if (chemin === '/api/journal/fichiers' && methode === 'GET') {
          const fichiers = existsSync(JOURNAUX_DIR)
            ? readdirSync(JOURNAUX_DIR)
                .filter((f) => f.endsWith('.log'))
                .sort()
                .reverse()
            : [];
          return json(res, 200, fichiers);
        }

        const mFichierJournal = chemin.match(/^\/api\/journal\/fichier\/([\w-]+\.log)$/);
        if (mFichierJournal && methode === 'GET') {
          return servirFichier(res, JOURNAUX_DIR, mFichierJournal[1]);
        }

        // --- Twitch ---
        if (chemin === '/api/twitch/etat' && methode === 'GET') {
          return json(res, 200, app.twitch.getEtat());
        }
        // Configurer Twitch passe par /api/connecteurs/twitch/... comme tout
        // service : les routes /api/twitch/app, /chaine et /autoriser faisaient
        // double emploi avec elles — elles appelaient d'ailleurs exactement les
        // memes fonctions — et sont parties avec la fenetre qui les utilisait.
        if (chemin === '/api/twitch/reconnecter' && methode === 'POST') {
          const r = await app.reconnecterTwitch();
          return json(res, r.ok ? 200 : 400, r);
        }

        // --- Reglages generaux ---
        if (chemin === '/api/reglages' && methode === 'POST') {
          const body = await corpsJson(req);
          return json(res, 200, await app.definirReglagesGeneraux(body));
        }

        // --- Mise a jour ---
        if (chemin === '/api/maj/verifier' && methode === 'POST') {
          return json(res, 200, await app.verifierMaj());
        }
        if (chemin === '/api/maj/appliquer' && methode === 'POST') {
          return json(res, 200, await app.appliquerMaj());
        }

        return json(res, 404, { erreur: 'route inconnue' });
      }

      // --- Retour d'autorisation Twitch ------------------------------------
      if (chemin === '/callback/twitch') {
        return app.callbackTwitch(url, res);
      }

      // --- Retour d'autorisation d'un module (Spotify, Riot...) -------------
      // Un module qui a besoin de son propre OAuth declare callbackOAuth() dans
      // son manifeste ; il recoit l'URL de retour ici, sans ouvrir de serveur.
      const mCallback = chemin.match(/^\/callback\/module\/([\w-]+)$/);
      if (mCallback) {
        return app.callbackModule(mCallback[1], url, res);
      }

      // --- Retour d'autorisation d'un connecteur (Spotify...) ---------------
      const mConnCb = chemin.match(/^\/callback\/connecteur\/([\w-]+)$/);
      if (mConnCb) {
        return app.callbackConnecteur(mConnCb[1], url, res);
      }

      // --- Dashboard --------------------------------------------------------
      if (chemin === '/' || chemin === '/index.html') {
        const page = join(DASHBOARD_DIR, 'index.html');
        if (!existsSync(page)) return texte(res, 200, 'StreamKit demarre. Dashboard non installe.');
        return servirHtml(res, page);
      }

      return servirFichier(res, DASHBOARD_DIR, chemin.slice(1));
    } catch (e) {
      log.err(methode + ' ' + chemin + ' : ' + (e?.message || e));
      if (!res.headersSent) json(res, 500, { erreur: e?.message || 'erreur interne' });
      else res.end();
    }
  };

  const serveur = http.createServer(handler);
  serveur.handler = handler; // reutilise par l'ecoute IPv6 (voir ecouter)
  return serveur;
}

// Ecoute sur les DEUX boucles locales, 127.0.0.1 ET ::1.
//
// Ce n'est pas du zele : sous Windows, « localhost » se resout tres souvent en
// IPv6 d'abord. Or Twitch impose « localhost » dans l'URL de redirection OAuth
// (il refuse une IP en http) -- avec une seule ecoute IPv4, le retour
// d'autorisation tomberait dans le vide. Meme piege pour le navigateur interne
// d'OBS, qui laisse alors la source desesperement vide.
//
// Rien n'est expose au reseau pour autant : uniquement les adresses de
// bouclage, jamais 0.0.0.0.
export function ecouter(serveur, port) {
  return new Promise((resolve, reject) => {
    serveur.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(
          new Error(
            'Le port ' + port + ' est deja utilise. StreamKit tourne peut-etre deja ' +
              '(regarde dans la barre des taches), ou un ancien bot est reste ouvert.'
          )
        );
      } else reject(e);
    });

    serveur.listen(port, '127.0.0.1', () => {
      const jumeau = http.createServer(serveur.handler);
      // Machine sans IPv6 : on continue simplement en IPv4.
      jumeau.on('error', () => {});
      jumeau.listen(port, '::1');
      serveur.jumeauIPv6 = jumeau;
      resolve(port);
    });
  });
}
