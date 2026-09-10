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
import * as twitch from './core/twitch.js';
import * as auth from './core/auth.js';
import * as maj from './core/maj.js';
import * as diffusion from './core/diffusion.js';
import * as compteurs from './core/compteurs.js';
import * as connecteurs from './core/connecteurs.js';
import * as coffre from './core/coffre.js';
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

// Ce que le streamer lit du lien avec Twitch. Les deux canaux sont
// INDEPENDANTS : le chat peut tourner pendant qu'EventSub se reconnecte (les
// points de chaine ne repondent plus, mais les commandes si). Un « tout va
// bien » global l'aurait envoye chercher ailleurs.
function canauxTwitch(t) {
  if (t.chatConnecte && t.eventsubConnecte) return 'chat et EventSub connectés';
  if (!t.chatConnecte && !t.eventsubConnecte) return 'connexion en cours…';
  return t.chatConnecte ? 'chat connecté, EventSub en attente' : 'EventSub connecté, chat en reconnexion';
}

export async function demarrerNoyau({
  updater = UPDATER_PAR_DEFAUT,
  demarrageAuto = DEMARRAGE_AUTO_ABSENT,
  // safeStorage d'Electron, injecte comme l'updater : le noyau ne sait pas qui
  // l'implemente, et en ligne de commande il n'y a simplement personne.
  coffreSysteme = null,
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
  const PORT = config.reseau?.port ?? 4455;

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

  async function arreterModule(id) {
    await registre.arreter(id);
    contextes.get(id)?._nettoyer();
    contextes.delete(id);
    santeModules.delete(id); // ce qu'on savait de lui ne vaut plus rien
  }

  // Derniere sante connue de chaque module (voir app.sante).
  const santeModules = new Map(); // id -> { a: horodatage, cartes: [...] }
  const FRAICHEUR_SANTE_MS = 20000;

  // --- Suivi du live --------------------------------------------------------
  // Les compteurs se rattachent au LIVE, pas a la duree de vie de StreamKit.
  // Avec le demarrage automatique avec Windows, l'application peut tourner des
  // jours : « depuis le lancement » agregerait alors plusieurs lives et des
  // journees entieres sans stream.
  const etatDirect = { enCours: false, depuis: null };

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

  // --- Objet applicatif expose au serveur ----------------------------------

  const app = {
    registre,
    twitch,
    port: PORT,

    etatGeneral() {
      // Un module de developpement ne compte que s'il est active : sinon le
      // dashboard annoncerait « 5 modules » en n'en affichant que 4.
      const modules = registre.liste().filter((m) => !m.manifeste.developpement || m.actif);
      return {
        version: maj.versionActuelle(),
        port: PORT,
        dossierDonnees: DONNEES,
        twitch: twitch.getEtat(),
        chaine: store.getConfig().twitch.channel,
        appConfiguree: !!store.lireTokens().twitchApp?.clientId,
        modules: {
          total: modules.length,
          actifs: modules.filter((m) => m.actif).length,
          demarres: modules.filter((m) => m.etat === 'demarre').length,
          enErreur: modules.filter((m) => m.etat === 'erreur' || m.etat === 'incomplet').length,
        },
        droitsManquants: twitch.droitsManquants(registre.scopesRequis()),
        demarrageAuto: { disponible: !!demarrageAuto.disponible, actif: !!demarrageAuto.lire() },
      };
    },

    // --- Connecteurs ----------------------------------------------------
    // Écran dédié : identifiants d'application ET autorisation de compte, au
    // même endroit pour tous les services. Twitch y figure aussi, même si son
    // flux reste dans core/auth.js.

    etatConnecteurs() {
      const t = twitch.getEtat();
      const appTwitch = store.lireTokens().twitchApp ?? {};
      const manquants = twitch.droitsManquants(registre.scopesRequis({ tousLesModules: true }));

      const liste = [
        {
          id: 'twitch',
          nom: 'Twitch',
          icone: '🟣',
          description: 'Chat, points de chaîne, clips. Nécessaire à la plupart des modules.',
          consoleUrl: 'https://dev.twitch.tv/console/apps/create',
          urlDeRetour: auth.urlDeRetour(PORT),
          configure: !!(appTwitch.clientId && appTwitch.clientSecret),
          connecte: t.pret,
          compte: t.channel || '',
          detail: t.pret
            ? canauxTwitch(t) + (manquants.length ? ' — ' + manquants.length + ' droit(s) à renouveler' : '')
            : t.raison || 'non connecté',
          etat: !t.pret ? (appTwitch.clientId ? 'ko' : 'inactif') : manquants.length ? 'attention' : 'ok',
          etapes: [
            'Ouvre la console développeur Twitch et connecte-toi.',
            'Nom : StreamKit — Catégorie : Chat Bot.',
            'URL de redirection OAuth : colle l’adresse ci-dessous, exactement.',
            'Valide, puis récupère l’ID client et génère un secret client.',
          ],
          // Le nom de chaîne fait partie de la configuration Twitch, pas d'une
          // application : c'est le seul connecteur qui en demande un.
          champChaine: store.getConfig().twitch.channel || '',
        },
      ];

      for (const c of connecteurs.catalogue()) {
        const e = connecteurs.pour(c.id);
        // Un connecteur n'est réclamé que si un module le demande : inutile de
        // faire configurer Spotify à quelqu'un qui ne veut que la roue.
        const demandePar = registre
          .liste()
          .filter((m) => (m.manifeste.connecteurs ?? []).includes(c.id))
          .map((m) => m.manifeste.nom);

        liste.push({
          id: c.id,
          nom: c.nom,
          icone: c.icone,
          description: c.description,
          consoleUrl: c.consoleUrl,
          urlDeRetour: connecteurs.urlDeRetour(c.id, PORT),
          // Le dashboard en a besoin pour ne PAS reclamer de secret client a un
          // connecteur qui n'en utilise plus.
          pkce: connecteurs.estPkce(c),
          configure: e.configure,
          connecte: e.connecte,
          compte: e.compte,
          detail: e.connecte
            ? e.compte || 'connecté'
            : e.configure
              ? 'application enregistrée, compte non autorisé'
              : 'non configuré',
          etat: e.connecte ? 'ok' : e.configure ? 'attention' : 'inactif',
          etapes: c.etapes,
          demandePar,
        });
      }

      return liste;
    },

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

    // --- Vue d'ensemble des connexions ---------------------------------
    // Ce qu'on regarde avant de partir en live. Le socle sait deja beaucoup :
    // Twitch, les sources OBS branchees sur nos overlays, les mises a jour.
    // Chaque module ajoute les siennes via sante() dans son manifeste --
    // Spotify pour le bot musique, le Riot Client pour Valorant.
    async sante() {
      const connexions = [];

      // --- Twitch ---
      const t = twitch.getEtat();
      const manquants = twitch.droitsManquants(registre.scopesRequis());
      if (!t.pret) {
        connexions.push({
          id: 'twitch',
          nom: 'Twitch',
          etat: store.lireTokens().twitchApp?.clientId ? 'ko' : 'inactif',
          detail: t.raison || 'non connecté',
          aide: 'Clique sur l’indicateur Twitch en haut de la fenêtre.',
        });
      } else if (manquants.length) {
        connexions.push({
          id: 'twitch',
          nom: 'Twitch',
          etat: 'attention',
          detail: t.channel + ' — ' + manquants.length + ' droit(s) manquant(s)',
          aide: 'Reconnecte ta chaîne : ' + manquants.join(', '),
        });
      } else {
        connexions.push({
          id: 'twitch',
          nom: 'Twitch',
          etat: t.chatConnecte ? 'ok' : 'attention',
          detail: t.channel + ' — ' + canauxTwitch(t),
        });
      }

      // --- OBS : combien de sources ecoutent nos overlays ---
      // On ne parle pas a OBS, mais un overlay branche PROUVE qu'il tourne.
      // C'est la vraie question du streamer : « ma source est-elle en place ? »
      const vues = [];
      let total = 0;
      for (const m of registre.liste()) {
        for (const o of m.manifeste.overlays ?? []) {
          const n = diffusion.nbClients('overlay:' + m.id + ':' + o.chemin);
          total += n;
          if (n) vues.push(m.manifeste.nom + ' › ' + o.nom + ' (' + n + ')');
        }
      }
      connexions.push({
        id: 'obs',
        nom: 'OBS',
        etat: total ? 'ok' : 'inactif',
        detail: total ? total + ' source(s) connectée(s)' : 'aucune source connectée',
        aide: total ? vues.join(' · ') : 'Ajoute les overlays de tes modules en source Navigateur.',
      });

      // --- Connecteurs : Spotify & co, meme quand aucun module ne tourne ---
      // Un connecteur se configure au niveau du socle : son etat ne depend pas
      // d'un module demarre. Sans cette boucle, « est-ce que Spotify est
      // branche ? » n'avait de reponse qu'une fois le bot musique allume —
      // exactement l'inverse de ce qu'on vient verifier avant un live.
      for (const c of connecteurs.catalogue()) {
        const requis = registre.liste().filter((m) => (m.manifeste.connecteurs ?? []).includes(c.id));
        // Personne ne s'en sert : pas la peine d'encombrer l'ecran.
        if (!requis.length) continue;

        const e = connecteurs.pour(c.id);
        connexions.push({
          id: c.id,
          nom: c.nom,
          // Pas connecte n'est pas une panne : un streamer qui n'utilise pas le
          // bot musique n'a aucune raison d'avoir Spotify branche.
          etat: e.connecte ? 'ok' : 'inactif',
          detail: e.connecte
            ? e.compte || 'connecté'
            : e.configure
              ? 'application enregistrée, autorisation à donner'
              : 'non configuré',
          aide: e.connecte
            ? 'Utilisé par : ' + requis.map((m) => m.manifeste.nom).join(', ')
            : e.configure
              ? 'Écran Connecteurs → carte ' + c.nom + ' → Connecter.'
              : 'Écran Connecteurs : renseigne ton application ' + c.nom + '.',
        });
      }

      // --- Modules : chacun declare ses propres connexions ---
      //
      // Ces sante() parlent au RESEAU : celle du bot musique demande a Spotify
      // quel appareil joue. Le dashboard, lui, rafraichit toutes les 5 s --
      // dashboard ouvert, ca faisait douze appels Spotify par minute pour une
      // information qui ne bouge pas si vite, et qui compte surtout au moment
      // ou on verifie son installation avant un live. On garde donc la
      // derniere reponse quelques secondes.
      for (const m of registre.liste()) {
        if (typeof m.manifeste.sante !== 'function') continue;
        // Un module arrete n'a pas de contexte : inutile de l'interroger.
        if (m.etat !== 'demarre') continue;

        const connu = santeModules.get(m.id);
        let cartes;
        if (connu && Date.now() - connu.a < FRAICHEUR_SANTE_MS) {
          cartes = connu.cartes;
        } else {
          try {
            cartes = (await m.manifeste.sante(contextes.get(m.id))) ?? [];
          } catch (e) {
            // Un module qui repond mal ne doit pas etre reinterroge en boucle :
            // on met son echec en cache comme le reste.
            cartes = [
              {
                id: m.id + ':sante',
                nom: m.manifeste.nom,
                etat: 'ko',
                detail: 'état illisible',
                aide: e?.message || String(e),
              },
            ];
          }
          santeModules.set(m.id, { a: Date.now(), cartes });
        }

        for (const c of cartes) {
          const enrichi = { ...c, module: m.manifeste.nom };
          // Un module qui tourne en sait plus que le socle sur son connecteur
          // — l'appareil Spotify actif, par exemple. Sa version remplace la
          // carte generique, a la meme place, au lieu de doubler avec elle.
          const i = connexions.findIndex((x) => x.id === enrichi.id);
          if (i >= 0) connexions[i] = enrichi;
          else connexions.push(enrichi);
        }
      }

      // --- Compteurs d'usage ---
      // Un module qui declare `compteurs: { cle: 'Libelle' }` voit ses chiffres
      // remonter ici. On les expose meme module arrete : « 0 clip ce live »
      // reste une information, et l'historique ne disparait pas parce qu'on a
      // decoche une case.
      const kpis = [];
      for (const m of registre.liste()) {
        const libelles = m.manifeste.compteurs;
        if (!libelles) continue;
        const { total, session } = compteurs.pour(m.id);
        kpis.push({
          module: m.manifeste.nom,
          icone: m.manifeste.icone ?? '🧩',
          actif: m.etat === 'demarre',
          valeurs: Object.entries(libelles).map(([cle, label]) => ({
            cle,
            label,
            session: session[cle] || 0,
            total: total[cle] || 0,
          })),
        });
      }

      return {
        connexions,
        kpis,
        depuis: compteurs.debutSession(),
        causeSession: compteurs.causeSession(),
        enDirect: etatDirect.enCours,
        directDepuis: etatDirect.depuis,
        version: maj.versionActuelle(),
        modules: (() => {
          const vus = registre.liste().filter((m) => !m.manifeste.developpement || m.actif);
          return {
            total: vus.length,
            demarres: vus.filter((m) => m.etat === 'demarre').length,
            enErreur: vus.filter((m) => m.etat === 'erreur' || m.etat === 'incomplet').length,
          };
        })(),
      };
    },

    async definirActif(id, actif) {
      if (actif) {
        store.sauverModule(id, { actif: true });
        registre.get(id).actif = true;
        await registre.demarrer(id, fabriquerContexte);
      } else {
        store.sauverModule(id, { actif: false });
        registre.get(id).actif = false;
        await arreterModule(id);
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
      await registre.arreterTout();
      for (const ctx of contextes.values()) ctx._nettoyer();
      contextes.clear();
      await twitch.arreter();
      try {
        await twitch.demarrer();
      } catch (e) {
        log.err('Connexion Twitch impossible : ' + (e?.message || e));
        return { ok: false, erreur: e?.message || String(e) };
      }
      brancherSuiviDuDirect();
      await registre.demarrerActifs(fabriquerContexte);
      return { ok: true, etat: twitch.getEtat() };
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
    verifierMaj: () => updater.verifier(),
    appliquerMaj: () => updater.appliquer(),
  };

  // --- Demarrage ------------------------------------------------------------

  await registre.charger();

  // Migration ponctuelle de la config, schema 1 -> 2.
  //
  // Jusqu'a la 0.9.0, le module de demonstration s'affichait dans le rail comme
  // une fonctionnalite : certains l'ont donc active par curiosite. Depuis, un
  // module de developpement est masque — mais pas quand il est actif, sinon on
  // ne pourrait plus l'eteindre. Resultat : il resterait visible a vie chez ceux
  // qui l'ont allume. On les eteint une bonne fois, ici et pas ailleurs.
  if ((config.version ?? 1) < 2) {
    for (const m of registre.liste()) {
      if (!m.manifeste.developpement || !m.actif) continue;
      m.actif = false;
      store.sauverModule(m.id, { actif: false });
      log.info('« ' + m.manifeste.nom + " » desactive : c'est un outil de diagnostic, pas un module.");
    }
    config.version = 2;
    store.sauverConfig(config);
  }

  try {
    await twitch.demarrer();
    if (twitch.estPret()) brancherSuiviDuDirect();
  } catch (e) {
    // Twitch mal configure ne doit pas empecher le dashboard de s'ouvrir : c'est
    // justement la que le streamer va aller pour corriger.
    log.err('Twitch : ' + (e?.message || e));
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
    const autonomes = registre.liste().filter((m) => m.actif && !(m.manifeste.scopes ?? []).length);
    for (const m of autonomes) await registre.demarrer(m.id, fabriquerContexte);

    const enAttente = registre.liste().filter((m) => m.actif && (m.manifeste.scopes ?? []).length);
    if (enAttente.length) {
      log.warn(
        enAttente.length +
          ' module(s) en attente de Twitch : ' +
          enAttente.map((m) => m.manifeste.nom).join(', ') +
          '. Ouvre le dashboard pour terminer la configuration.'
      );
    }
  }

  updater.verifierAuDemarrage?.().catch(() => {});

  // --- Arret ----------------------------------------------------------------

  let enFermeture = false;
  async function fermer() {
    if (enFermeture) return;
    enFermeture = true;
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
