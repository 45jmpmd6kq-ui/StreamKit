// Noyau de StreamKit : tout ce qui tourne, independamment de la facon dont on
// le lance.
//
// Deux points d'entree l'utilisent :
//   src/main.js   l'application Electron (ce que recoit le streamer)
//   src/index.js  le lancement en ligne de commande (developpement, tests)
//
// D'ou l'absence totale de process.exit() et de gestionnaires de signaux ici :
// c'est l'appelant qui decide de la vie et de la mort du processus. Le noyau se
// contente de demarrer et de fournir un fermer().
//
// Enchainement :
//   dossiers -> config -> modules decouverts -> Twitch -> serveur
//   -> modules actifs demarres -> verification de mise a jour
//
// Principe directeur : rien de ce qui rate ici ne doit empecher le dashboard de
// s'ouvrir. Un streamer qui a un souci doit TOUJOURS pouvoir y arriver et lire
// le journal pour comprendre -- c'est la que se joue le support.

import { preparerDossiers, DONNEES } from './core/paths.js';
import * as journal from './core/journal.js';
import * as store from './core/store.js';
import * as registre from './core/registre.js';
import * as twitchReel from './core/twitch.js';
import * as auth from './core/auth.js';
import * as maj from './core/maj.js';
import * as notes from './core/notes.js';
import * as diffusion from './core/diffusion.js';
import * as compteurs from './core/compteurs.js';
import * as connecteurs from './core/connecteurs.js';
import * as coffre from './core/coffre.js';
import { creerSante, resumeModules } from './core/sante.js';
import { creerSignalement, lireCible } from './core/signalement.js';
import { creerReconnexion, PAUSES_MS, resumeErreur } from './core/reconnexion.js';
import { creerServeur, ecouter, ENTETES_PAGE_OAUTH } from './core/serveur.js';

const log = journal.pour('noyau');

// L'updater est injecte : en ligne de commande c'est maj.js (releases GitHub +
// remplacement par .bat) ; sous Electron, main.js fournit electron-updater, qui
// sait remplacer une application en cours d'execution.
const UPDATER_PAR_DEFAUT = {
  verifier: () => maj.verifier(),
  appliquer: () => maj.appliquer(),
  verifierAuDemarrage: () => maj.verifierAuDemarrage(),
};

// Le demarrage automatique depend de l'hote : Electron sait le faire nativement
// (raccourci de session Windows), le lancement en ligne de commande non. Quand
// il n'est pas fourni, le dashboard masque simplement l'option.
const DEMARRAGE_AUTO_ABSENT = { disponible: false, lire: () => false, ecrire: () => false };

export async function demarrerNoyau({
  updater = UPDATER_PAR_DEFAUT,
  demarrageAuto = DEMARRAGE_AUTO_ABSENT,
  // safeStorage d'Electron, injecte comme l'updater : le noyau ne sait pas qui
  // l'implemente, et en ligne de commande il n'y a simplement personne.
  coffreSysteme = null,
  // La couche Twitch et le rythme de ses nouveaux essais : injectables pour les
  // tests, qui simulent un Twitch injoignable sans attendre des minutes.
  twitch = twitchReel,
  pausesTwitchMs = PAUSES_MS,
  // Ouvre un dossier dans l'explorateur (shell.openPath sous Electron) : un
  // rapport de bug qui n'a pas pu partir y est enregistre. Absent en ligne de
  // commande, le dashboard affiche alors le chemin.
  ouvrirDossier = null,
  // Salon Discord des rapports de bug : lu dans l'installeur par defaut (voir
  // core/signalement.js), remplace par un faux Discord dans les tests.
  cibleSignalement = lireCible(),
} = {}) {
  preparerDossiers();
  journal.purger();
  compteurs.charger();

  // AVANT la premiere lecture de tokens.json : sans coffre branche, les
  // secrets deja chiffres reviendraient vides.
  coffre.brancher(coffreSysteme);
  if (store.chiffrerSecretsAuRepos()) {
    log.ok('Secrets chiffres sur le disque (cle liee a ta session Windows).');
  }

  const config = store.chargerConfig();
  // Le repli couvre un config.json abime a la main (« reseau »: null) : un
  // mauvais port ne doit pas empecher StreamKit de demarrer.
  const PORT = config.reseau?.port ?? store.PORT_PAR_DEFAUT;

  log.info('StreamKit ' + maj.versionActuelle() + ' — demarrage');

  // --- Contexte fourni a chaque module -------------------------------------
  // Seul point de contact entre un module et le reste du monde. Un module ne lit
  // jamais un fichier de config lui-meme, n'ouvre jamais de connexion Twitch, et
  // ne cree jamais son propre serveur.

  const contextes = new Map();

  function contextePour(m) {
    const id = m.id;
    const logModule = journal.pour(id);
    const minuteurs = new Set();

    return {
      id,
      nom: m.manifeste.nom,
      version: maj.versionActuelle(),

      // Reglages du module (deja migres et completes par leurs defauts).
      config: registre.reglagesDe(id),

      log: logModule,

      twitch: twitch.contextePour(id, logModule),

      // Overlays du module : un canal de diffusion par vue.
      overlay: {
        diffuser: (vue, type, data) => diffusion.diffuser('overlay:' + id + ':' + vue, type, data),
        // L'etat est memorise : une source OBS qui se reconnecte au milieu du
        // live retrouve tout de suite quoi afficher.
        etat: (vue, data) => diffusion.diffuser('overlay:' + id + ':' + vue, 'etat', data),
        nbSources: (vue) => diffusion.nbClients('overlay:' + id + ':' + vue),
        url: (vue) => 'http://127.0.0.1:' + PORT + '/overlay/' + id + '/' + vue,
      },

      // Memoire de travail persistante (file d'attente, compteurs, historique).
      etat: {
        lire: (defaut) => store.lireEtat(id, defaut),
        sauver: (v) => store.sauverEtat(id, v),
      },

      // OAuth propre au module (Spotify, Riot...). Le retour arrive sur
      // /callback/module/<id> et part dans manifeste.callbackOAuth().
      oauth: {
        // « localhost » et pas 127.0.0.1 : Spotify comme Twitch refusent une IP.
        urlDeRetour: () => 'http://localhost:' + PORT + '/callback/module/' + id,
        ouvrir: (url) => auth.ouvrirNavigateur(url),
      },

      // Secrets propres au module (jeton Spotify, cle d'API...), ranges dans
      // tokens.json sous le nom du module — jamais dans config.json.
      secrets: {
        lire: (cle) => store.lireTokens().modules?.[id]?.[cle],
        ecrire: (cle, valeur) =>
          store.majTokens((t) => {
            t.modules ??= {};
            t.modules[id] ??= {};
            t.modules[id][cle] = valeur;
          }),
      },

      // Identifiants d'un connecteur configure au niveau du socle (Spotify...).
      // Le module ne demande plus d'ID ni de secret dans ses reglages.
      connecteur: (idConnecteur) => connecteurs.pour(idConnecteur),

      // Compteurs d'usage : le module incremente, le socle persiste et agrege.
      // Rien a declarer ailleurs qu'un libelle dans le manifeste.
      compteur: {
        incr: (cle, combien = 1) => compteurs.incr(id, cle, combien),
        lire: () => compteurs.pour(id),
      },

      // Minuteurs suivis : coupes automatiquement quand le module s'arrete.
      // Sans ca, desactiver un module laisserait ses setInterval tourner
      // jusqu'au redemarrage.
      minuteur: {
        // Un tour n'est JAMAIS double par le suivant.
        //
        // setInterval ne demande pas la permission : il relance toutes les
        // `ms`, que le tour precedent soit fini ou non. Or nos tours font des
        // appels reseau -- l'overlay Valorant tourne toutes les 2 s et peut
        // aller chercher un detail de match de plusieurs Mo, avec 45 s de
        // patience. Les tours s'empilaient alors par dizaines : appels
        // dupliques chez Riot (jusqu'au 429), et deux tours qui ecrivent en
        // meme temps dans la meme liste de matchs.
        //
        // Un module n'a pas a s'en occuper : on saute simplement le tic tant
        // que le precedent travaille.
        intervalle(fn, ms) {
          let enCours = false;
          let sautes = 0;

          const t = setInterval(async () => {
            if (enCours) {
              sautes++;
              return;
            }
            enCours = true;
            const debut = Date.now();
            try {
              await fn();
            } catch (e) {
              // Sans ce filet, une exception dans un tour async remonterait en
              // « unhandledRejection » loin de son module d'origine.
              logModule.err('minuteur : ' + (e?.message || e));
            } finally {
              enCours = false;
              // Une seule ligne par tour trop long, pas une par tic saute :
              // c'est exactement ce qu'on veut lire quand un module rame.
              if (sautes) {
                logModule.debug('tour de ' + (Date.now() - debut) + ' ms — ' + sautes + ' tic(s) sautes');
                sautes = 0;
              }
            }
          }, ms);

          minuteurs.add(t);
          return t;
        },

        delai(fn, ms) {
          // On retire le minuteur du suivi une fois qu'il a servi : la roue en
          // pose un a chaque tirage, et l'ensemble grossirait toute la soiree
          // pour des minuteurs deja eteints.
          const t = setTimeout(async () => {
            minuteurs.delete(t);
            try {
              await fn();
            } catch (e) {
              logModule.err('minuteur : ' + (e?.message || e));
            }
          }, ms);
          minuteurs.add(t);
          return t;
        },
      },

      _nettoyer() {
        for (const t of minuteurs) {
          clearInterval(t);
          clearTimeout(t);
        }
        minuteurs.clear();
        twitch.retirerAbonnements(id);
      },
    };
  }

  function fabriquerContexte(m) {
    const ctx = contextePour(m);
    contextes.set(m.id, ctx);
    return ctx;
  }

  async function arreterModule(id, raison) {
    await registre.arreter(id, raison);
    contextes.get(id)?._nettoyer();
    contextes.delete(id);
    vuesSante.oublier(id); // ce qu'on savait de sa sante ne vaut plus rien
  }

  // --- Suivi du live --------------------------------------------------------
  // Les compteurs se rattachent au LIVE, pas a la duree de vie de StreamKit.
  // Avec le demarrage automatique avec Windows, l'application peut tourner des
  // jours : « depuis le lancement » agregerait alors plusieurs lives et des
  // journees entieres sans stream.
  const etatDirect = { enCours: false, depuis: null };

  // Vue d'ensemble et ecran Connecteurs : voir core/sante.js.
  const vuesSante = creerSante({
    registre,
    twitch,
    connecteurs,
    diffusion,
    compteurs,
    port: PORT,
    contexteDe: (id) => contextes.get(id),
    etatDirect,
  });

  // « Signaler un bug » : voir core/signalement.js.
  const signalement = creerSignalement({
    registre,
    twitch,
    diffusion,
    compteurs,
    sante: () => vuesSante.sante(),
    connecteurs: () => vuesSante.etatConnecteurs(),
    contexteDe: (id) => contextes.get(id),
    // Un module arrete a quand meme son diagnostic (l'API de stats de Rocket
    // League se verifie jeu ferme) : meme contexte jetable que pour ses actions.
    contexteJetable: (m) => contextePour(m),
    config: () => store.getConfig(),
    secrets: () => store.lireTokens(),
    cible: cibleSignalement,
    ouvrir: ouvrirDossier,
  });

  function brancherSuiviDuDirect() {
    twitch.surDirect({
      debut: () => {
        etatDirect.enCours = true;
        etatDirect.depuis = Date.now();
        compteurs.nouvelleSession('live');
        log.ok('Live démarré — compteurs de session remis à zéro.');
      },
      fin: () => {
        etatDirect.enCours = false;
        log.info('Live terminé. Les compteurs de la session restent affichés.');
      },
    });

    // StreamKit peut demarrer alors que le live tourne deja : les evenements ne
    // disent que les transitions, il faut donc demander l'etat courant.
    twitch
      .enDirect()
      .then((s) => {
        if (!s) return;
        etatDirect.enCours = true;
        etatDirect.depuis = s.depuis;
        compteurs.nouvelleSession('live');
        log.info('Live déjà en cours : les compteurs comptent depuis son début.');
      })
      .catch(() => {});
  }

  // --- Connexion a Twitch ---------------------------------------------------

  let enFermeture = false;

  // Un seul essai a la fois : le nouvel essai automatique et une reconnexion
  // demandee depuis le dashboard ne doivent jamais se croiser (deux connexions,
  // des modules demarres deux fois).
  let fileTwitch = Promise.resolve();
  const enSerie = (fn) => {
    const p = fileTwitch.then(fn);
    fileTwitch = p.catch(() => {});
    return p;
  };

  // Les modules qui se passent de Twitch (compteur Rocket League, suivi LoL...)
  // n'ont pas a l'attendre.
  async function demarrerSansTwitch() {
    const autonomes = registre.liste().filter((m) => m.actif && !(m.manifeste.scopes ?? []).length);
    for (const m of autonomes) await registre.demarrer(m.id, fabriquerContexte);

    const enAttente = registre.liste().filter((m) => m.actif && (m.manifeste.scopes ?? []).length);
    if (enAttente.length) {
      log.warn(
        enAttente.length +
          ' module(s) en attente de Twitch : ' +
          enAttente.map((m) => m.manifeste.nom).join(', ') +
          '. Ils démarreront dès que Twitch sera connecté.'
      );
    }
  }

  // Twitch injoignable (reseau pas encore la au lancement de Windows, panne) :
  // StreamKit retente seul, puis demarre les modules qui attendaient. Avant,
  // ils restaient eteints jusqu'au lancement suivant. Voir core/reconnexion.js.
  const reconnexion = creerReconnexion({
    log,
    pausesMs: pausesTwitchMs,
    connecter: () =>
      enSerie(async () => {
        if (enFermeture) return false;
        await twitch.demarrer();
        if (!twitch.estPret() || enFermeture) return false;
        brancherSuiviDuDirect();
        await registre.demarrerActifs(fabriquerContexte);
        return true;
      }),
  });

  // --- Objet applicatif expose au serveur ----------------------------------

  const app = {
    registre,
    twitch,
    port: PORT,

    etatGeneral() {
      return {
        version: maj.versionActuelle(),
        port: PORT,
        dossierDonnees: DONNEES,
        twitch: twitch.getEtat(),
        chaine: store.getConfig().twitch.channel,
        appConfiguree: !!store.lireTokens().twitchApp?.clientId,
        modules: resumeModules(registre),
        droitsManquants: twitch.droitsManquants(registre.scopesRequis()),
        demarrageAuto: { disponible: !!demarrageAuto.disponible, actif: !!demarrageAuto.lire() },
      };
    },

    // --- Connecteurs ----------------------------------------------------
    // Écran dédié : identifiants d'application ET autorisation de compte, au
    // même endroit pour tous les services. La vue est calculée dans
    // core/sante.js ; les actions restent ici, car elles relancent des modules.
    etatConnecteurs: () => vuesSante.etatConnecteurs(),

    async definirAppConnecteur(id, corps) {
      if (id === 'twitch') return app.definirAppTwitch(corps);
      const r = connecteurs.definirApp(id, corps);
      if (r.ok) await app.rechargerModulesDeConnecteur(id);
      return r;
    },

    async autoriserConnecteur(id) {
      if (id === 'twitch') return app.demarrerAutorisation();
      return connecteurs.demarrerAutorisation(id, PORT);
    },

    async deconnecterConnecteur(id) {
      if (id === 'twitch') return { ok: false, erreur: 'utilise la reconnexion de chaîne' };
      const r = connecteurs.deconnecter(id);
      await app.rechargerModulesDeConnecteur(id);
      return r;
    },

    async callbackConnecteur(id, url, res) {
      const r = await connecteurs.traiterRetour(id, url, PORT);
      res.writeHead(200, ENTETES_PAGE_OAUTH);
      res.end(auth.pageRetour(r));
      if (r.ok) await app.rechargerModulesDeConnecteur(id);
    },

    // Un connecteur qui change (branché, débranché) peut débloquer ou casser
    // des modules : on les relance plutôt que d'attendre un redémarrage.
    async rechargerModulesDeConnecteur(id) {
      for (const m of registre.liste()) {
        if (!(m.manifeste.connecteurs ?? []).includes(id)) continue;
        if (m.actif) await app.recharger(m.id);
      }
    },

    // --- Vue d'ensemble des connexions (core/sante.js) -----------------
    sante: () => vuesSante.sante(),

    async definirActif(id, actif) {
      if (actif) {
        store.sauverModule(id, { actif: true });
        registre.get(id).actif = true;
        await registre.demarrer(id, fabriquerContexte);
      } else {
        store.sauverModule(id, { actif: false });
        registre.get(id).actif = false;
        await arreterModule(id, { desactive: true });
      }
      return registre.vue(id);
    },

    async recharger(id) {
      const m = registre.get(id);
      if (!m) return null;
      const etait = m.etat === 'demarre';
      await arreterModule(id);
      if (etait || m.actif) await registre.demarrer(id, fabriquerContexte);
      return registre.vue(id);
    },

    async executerAction(id, nom, corps) {
      const m = registre.get(id);
      const action = m?.manifeste.actions?.[nom];
      if (!action) return { ok: false, erreur: 'action inconnue' };
      // Un module ARRETE n'a pas de contexte. Lui en fabriquer un via
      // fabriquerContexte l'enregistrerait dans `contextes` : au demarrage
      // suivant, contextes.set l'ecraserait sans jamais appeler son
      // _nettoyer(). Aucune action ne pose de minuteur aujourd'hui, mais la
      // premiere qui le ferait laisserait un minuteur orphelin -- exactement le
      // genre de fuite qu'on ne retrouve pas. D'ou ce contexte jetable.
      const ctx = contextes.get(id);
      const jetable = ctx ? null : contextePour(m);
      try {
        const res = await action(ctx ?? jetable, corps);
        return { ok: true, ...(res ?? {}) };
      } catch (e) {
        journal.pour(id).err('action « ' + nom + ' » : ' + (e?.message || e));
        return { ok: false, erreur: e?.message || String(e) };
      } finally {
        jetable?._nettoyer();
      }
    },

    // --- Twitch ---

    async definirAppTwitch({ clientId, clientSecret }) {
      if (!clientId || !clientSecret) return { ok: false, erreur: 'identifiants incomplets' };
      store.majTokens((t) => {
        t.twitchApp = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
      });
      log.ok('Application Twitch enregistree.');
      return { ok: true, urlDeRetour: auth.urlDeRetour(PORT) };
    },

    async definirChaine(channel) {
      const nom = String(channel || '')
        .trim()
        .toLowerCase();
      if (!nom) return { ok: false, erreur: 'nom de chaine vide' };
      const c = store.getConfig();
      if (c.twitch.channel !== nom) {
        c.twitch.channel = nom;
        c.twitch.broadcasterId = ''; // sera re-resolu au prochain demarrage
        store.sauverConfig(c);
        log.info('Chaine definie : ' + nom);
      }
      return { ok: true, channel: nom };
    },

    async demarrerAutorisation() {
      const reseau = await auth.twitchJoignable();
      if (!reseau.ok) return { ok: false, erreur: reseau.detail, conseil: reseau.conseil };

      // On demande les droits de TOUS les modules, pas seulement des actifs :
      // sinon activer un module plus tard obligerait a re-autoriser.
      const scopes = registre.scopesRequis({ tousLesModules: true });
      if (!scopes.length) scopes.push('chat:read');

      const r = auth.demarrerAutorisation({ port: PORT, scopes });
      if (!r.ok) return { ok: false, erreur: r.raison };

      r.promesse.then(async (res) => {
        if (res.ok) await app.reconnecterTwitch();
      });
      return { ok: true, url: r.url, scopes };
    },

    async reconnecterTwitch() {
      reconnexion.arreter(); // la demande du streamer remplace l'essai prevu
      return enSerie(async () => {
        await registre.arreterTout();
        for (const ctx of contextes.values()) ctx._nettoyer();
        contextes.clear();
        await twitch.arreter();
        try {
          await twitch.demarrer();
        } catch (e) {
          log.err('Connexion Twitch impossible : ' + (e?.message || e));
          // Tout vient d'etre arrete : ce qui se passe de Twitch repart tout de
          // suite, et Twitch est retente si ca peut s'arranger seul.
          await demarrerSansTwitch();
          reconnexion.apresEchec(e);
          return { ok: false, erreur: e?.message || String(e) };
        }
        brancherSuiviDuDirect();
        await registre.demarrerActifs(fabriquerContexte);
        return { ok: true, etat: twitch.getEtat() };
      });
    },

    async callbackTwitch(url, res) {
      const r = await auth.traiterRetour(url, PORT);
      res.writeHead(200, ENTETES_PAGE_OAUTH);
      res.end(auth.pageRetour(r));
    },

    // Un module peut avoir son propre OAuth (Spotify pour le bot musique, Riot
    // pour un module Valorant). Il declare callbackOAuth() dans son manifeste et
    // recoit le retour ici : aucun module n'ouvre jamais son propre serveur.
    async callbackModule(id, url, res) {
      const m = registre.get(id);
      const gestionnaire = m?.manifeste.callbackOAuth;
      let resultat;

      if (!gestionnaire) {
        resultat = { ok: false, message: "Ce module n'attend aucune autorisation." };
      } else {
        // Meme precaution que dans executerAction : un module arrete recoit un
        // contexte jetable, jamais une entree fantome dans `contextes`.
        const ctx = contextes.get(id);
        const jetable = ctx ? null : contextePour(m);
        try {
          resultat = (await gestionnaire(ctx ?? jetable, url)) ?? { ok: true, message: "C'est bon !" };
        } catch (e) {
          journal.pour(id).err('retour OAuth : ' + (e?.message || e));
          resultat = { ok: false, message: e?.message || 'erreur inattendue' };
        } finally {
          jetable?._nettoyer();
        }
      }

      res.writeHead(200, ENTETES_PAGE_OAUTH);
      res.end(auth.pageRetour(resultat));

      // L'autorisation change ce que le module peut faire : on le relance.
      if (resultat.ok && m?.actif) await app.recharger(id);
    },

    // --- Reglages generaux ---

    // Le depot des mises a jour n'est PLUS un reglage : sous Electron il est
    // fige a la compilation (build.publish de package.json), et le champ du
    // dashboard n'avait aucun effet -- il ne restait qu'a le faire croire au
    // streamer, qui l'avait deja retire de ce qu'il envoie. config.maj.depot
    // survit pour maj.js en ligne de commande, mais ne passe plus ni par l'etat
    // general ni par cette API.
    async definirReglagesGeneraux({ demarrageAuto: auto }) {
      if (auto !== undefined && demarrageAuto.disponible) {
        demarrageAuto.ecrire(!!auto);
        log.info('Demarrage avec Windows : ' + (auto ? 'active' : 'desactive'));
      }

      return {
        ok: true,
        demarrageAuto: { disponible: !!demarrageAuto.disponible, actif: !!demarrageAuto.lire() },
      };
    },

    // --- Mise a jour (implementation injectee) ---
    //
    // Les notes sont decoupees ici, pas dans le dashboard : elles arrivent
    // tantot en Markdown (latest.yml), tantot en HTML (release GitHub).
    async verifierMaj() {
      const r = await updater.verifier();
      return { ...r, blocs: notes.decouper(r.notes) };
    },
    appliquerMaj: () => updater.appliquer(),

    // Ce que la version INSTALLEE a apporte : lu dans l'application, sans
    // reseau. C'est le « Quoi de neuf » du redemarrage.
    notesDeVersion: () => ({
      version: maj.versionActuelle(),
      blocs: notes.decouper(notes.notesLocales()),
    }),

    // --- Signaler un bug ---
    apercuSignalement: (corps) => signalement.apercu(corps),
    envoyerSignalement: (corps) => signalement.envoyer(corps),
    ouvrirSignalement: (reference) => signalement.ouvrirDossier(reference),
  };

  // --- Demarrage ------------------------------------------------------------

  // Les migrations du format de config.json ont deja eu lieu dans
  // store.chargerConfig(), plus haut : le registre lit ici des modules a jour.
  await registre.charger();

  let echecTwitch = null;
  try {
    await twitch.demarrer();
    if (twitch.estPret()) brancherSuiviDuDirect();
  } catch (e) {
    // Twitch injoignable ou mal configure ne doit pas empecher le dashboard de
    // s'ouvrir : c'est justement la que le streamer va aller pour corriger.
    log.err('Twitch : ' + resumeErreur(e));
    echecTwitch = e;
  }

  const serveur = creerServeur(app);
  await ecouter(serveur, PORT); // l'appelant traite l'echec (port occupe)
  log.ok('Dashboard : http://127.0.0.1:' + PORT);

  // Twitch absent ne bloque QUE les modules qui en ont besoin. Un module qui ne
  // declare aucun scope (un compteur local, un lecteur de fichiers de jeu) doit
  // tourner meme si la chaine n'est pas encore connectee.
  if (twitch.estPret()) {
    await registre.demarrerActifs(fabriquerContexte);
  } else {
    await demarrerSansTwitch();
    // Seulement maintenant : un essai qui aboutirait avant la ligne du dessus
    // demarrerait les modules Twitch pendant qu'on les annonce « en attente ».
    if (echecTwitch) reconnexion.apresEchec(echecTwitch);
  }

  updater.verifierAuDemarrage?.().catch(() => {});

  // --- Arret ----------------------------------------------------------------

  async function fermer() {
    if (enFermeture) return;
    enFermeture = true;
    reconnexion.arreter();
    log.info('Arret de StreamKit...');
    for (const id of [...contextes.keys()]) await arreterModule(id);
    compteurs.vider();
    await twitch.arreter();
    serveur.close();
    serveur.jumeauIPv6?.close();
    log.info('A bientot !');
  }

  return { app, port: PORT, serveur, fermer, etatGeneral: () => app.etatGeneral() };
}
