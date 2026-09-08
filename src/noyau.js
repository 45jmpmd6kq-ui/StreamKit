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
import { creerServeur, ecouter } from './core/serveur.js';

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

export async function demarrerNoyau({ updater = UPDATER_PAR_DEFAUT, demarrageAuto = DEMARRAGE_AUTO_ABSENT } = {}) {
  preparerDossiers();
  journal.purger();

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

      // Minuteurs suivis : coupes automatiquement quand le module s'arrete.
      // Sans ca, desactiver un module laisserait ses setInterval tourner
      // jusqu'au redemarrage.
      minuteur: {
        intervalle(fn, ms) {
          const t = setInterval(fn, ms);
          minuteurs.add(t);
          return t;
        },
        delai(fn, ms) {
          const t = setTimeout(fn, ms);
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
  }

  // --- Objet applicatif expose au serveur ----------------------------------

  const app = {
    registre,
    twitch,
    port: PORT,

    etatGeneral() {
      const modules = registre.liste();
      return {
        version: maj.versionActuelle(),
        port: PORT,
        dossierDonnees: DONNEES,
        twitch: twitch.getEtat(),
        chaine: store.getConfig().twitch.channel,
        depotMaj: store.getConfig().maj?.depot || '',
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
      try {
        const res = await action(contextes.get(id) ?? fabriquerContexte(m), corps);
        return { ok: true, ...(res ?? {}) };
      } catch (e) {
        journal.pour(id).err('action « ' + nom + ' » : ' + (e?.message || e));
        return { ok: false, erreur: e?.message || String(e) };
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
      const nom = String(channel || '').trim().toLowerCase();
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
      await registre.demarrerActifs(fabriquerContexte);
      return { ok: true, etat: twitch.getEtat() };
    },

    async callbackTwitch(url, res) {
      const r = await auth.traiterRetour(url, PORT);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
        try {
          const ctx = contextes.get(id) ?? fabriquerContexte(m);
          resultat = (await gestionnaire(ctx, url)) ?? { ok: true, message: "C'est bon !" };
        } catch (e) {
          journal.pour(id).err('retour OAuth : ' + (e?.message || e));
          resultat = { ok: false, message: e?.message || 'erreur inattendue' };
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(auth.pageRetour(resultat));

      // L'autorisation change ce que le module peut faire : on le relance.
      if (resultat.ok && m?.actif) await app.recharger(id);
    },

    // --- Reglages generaux ---

    async definirReglagesGeneraux({ depotMaj, demarrageAuto: auto }) {
      const c = store.getConfig();
      c.maj ??= {};
      if (depotMaj !== undefined) c.maj.depot = String(depotMaj).trim();
      store.sauverConfig(c);
      log.info('Depot de mise a jour : ' + (c.maj.depot || 'aucun'));

      if (auto !== undefined && demarrageAuto.disponible) {
        demarrageAuto.ecrire(!!auto);
        log.info('Demarrage avec Windows : ' + (auto ? 'active' : 'desactive'));
      }

      return {
        ok: true,
        depotMaj: c.maj.depot,
        demarrageAuto: { disponible: !!demarrageAuto.disponible, actif: !!demarrageAuto.lire() },
      };
    },

    // --- Mise a jour (implementation injectee) ---
    verifierMaj: () => updater.verifier(),
    appliquerMaj: () => updater.appliquer(),
  };

  // --- Demarrage ------------------------------------------------------------

  await registre.charger();

  try {
    await twitch.demarrer();
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
    await twitch.arreter();
    serveur.close();
    serveur.jumeauIPv6?.close();
    log.info('A bientot !');
  }

  return { app, port: PORT, serveur, fermer, etatGeneral: () => app.etatGeneral() };
}
