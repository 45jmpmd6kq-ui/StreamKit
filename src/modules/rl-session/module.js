// Compteur de session Rocket League — victoires, defaites et serie, en direct.
//
// Source : l'API de stats OFFICIELLE de Psyonix, un socket local ouvert par le
// jeu lui-meme. Rien n'est injecte dans Rocket League : c'est compatible avec
// l'anti-triche (EAC), contrairement a BakkesMod, et ca ne demande pas de
// sauvegarder les replays.
//
// L'API ne dit ni la playlist ni qui est le streamer : ces deux informations
// viennent de Launch.log (voir journal-jeu.js). Elle ne donne pas non plus le
// MMR -- aucun champ ne le porte.
//
// Aucun droit Twitch : le module tourne meme sans chaine connectee.

import { creerClient, PORT_PAR_DEFAUT } from './flux.js';
import { creerSuiviParties } from './partie.js';
import { creerLecteur, creerSuiviFichier, nomPlaylist, trouverLaunchLog } from './journal-jeu.js';
import {
  activerFichiers,
  etatApi,
  iniDe,
  iniUtilisateur,
  jeuLance,
  trouverInstallations,
} from './installation.js';
import { accepter, ajouter, bilan, debutSession } from './session.js';

// Evenements qui racontent la vie d'une partie : on les trace (niveau debug)
// pour le support. Les autres arrivent jusqu'a 30 fois par seconde.
const EVENEMENTS_TRACES = new Set([
  'MatchCreated',
  'MatchInitialized',
  'MatchEnded',
  'MatchDestroyed',
  'ReplayCreated',
]);

async function fichiersIni(ctx) {
  const installations = await trouverInstallations();
  const launchLog = await trouverLaunchLog(ctx.config.cheminLaunchLog);
  return [...installations.map(iniDe), iniUtilisateur(launchLog)].filter(Boolean);
}

export default {
  id: 'rl-session',
  nom: 'Compteur de session',
  description:
    'Victoires, défaites et série de ta session, lues en direct dans Rocket League via l’API officielle du jeu. Sans BakkesMod, compatible anti-triche.',
  icone: '🏁',
  categorie: 'rocket-league',

  scopes: [],

  config: {
    version: 1,
    champs: [
      {
        cle: 'filtre',
        type: 'choix',
        label: 'Parties comptées',
        defaut: 'classe',
        options: [
          { valeur: 'classe', label: 'Classé seulement' },
          { valeur: 'enligne', label: 'Toutes les parties en ligne (hors matchs privés)' },
          { valeur: 'toutes', label: 'Toutes, matchs privés compris' },
        ],
      },
      {
        cle: 'format',
        type: 'choix',
        label: 'Format',
        defaut: 'tous',
        options: [
          { valeur: 'tous', label: 'Tous les formats' },
          { valeur: '1', label: '1v1 seulement' },
          { valeur: '2', label: '2v2 seulement' },
          { valeur: '3', label: '3v3 seulement' },
        ],
      },
      {
        cle: 'sessionMode',
        type: 'choix',
        label: 'Début de la session',
        aide: 'Ce qui remet le compteur à zéro. Le bouton « Réinitialiser la session » le fait à la main.',
        defaut: 'launch',
        options: [
          { valeur: 'launch', label: 'Au lancement de StreamKit' },
          { valeur: 'day', label: 'À minuit (journée en cours)' },
        ],
      },
      {
        cle: 'coin',
        type: 'choix',
        label: 'Position dans OBS',
        defaut: 'top-left',
        options: [
          { valeur: 'top-left', label: 'En haut à gauche' },
          { valeur: 'top-center', label: 'En haut au centre' },
          { valeur: 'top-right', label: 'En haut à droite' },
          { valeur: 'bottom-left', label: 'En bas à gauche' },
          { valeur: 'bottom-center', label: 'En bas au centre' },
          { valeur: 'bottom-right', label: 'En bas à droite' },
        ],
      },
      {
        cle: 'pseudo',
        type: 'texte',
        label: 'Ton pseudo en jeu (si non détecté)',
        aide: 'Laisse vide : StreamKit reconnaît ton compte tout seul dans le journal du jeu. À remplir seulement si la vue d’ensemble dit « joueur non identifié ».',
        defaut: '',
        groupe: 'Avancé',
      },
      {
        cle: 'cheminLaunchLog',
        type: 'texte',
        label: 'Chemin de Launch.log (si non trouvé)',
        aide: 'Laisse vide. Sinon : Documents\\My Games\\Rocket League\\TAGame\\Logs\\Launch.log',
        defaut: '',
        groupe: 'Avancé',
      },
      {
        cle: 'port',
        type: 'nombre',
        label: 'Port de l’API du jeu',
        aide: '0 = automatique (lu dans la configuration de Rocket League, 49123 d’habitude).',
        defaut: 0,
        min: 0,
        max: 65535,
        groupe: 'Avancé',
      },
    ],
  },

  migrations: {},

  compteurs: {
    victoires: 'Victoires',
    defaites: 'Défaites',
  },

  overlays: [
    {
      chemin: 'session',
      nom: 'Compteur de session',
      description: 'Victoires – défaites et série en cours.',
      fichier: 'session.html',
    },
  ],

  libellesActions: {
    activerApi: 'Activer l’API dans Rocket League',
    reinitialiserSession: 'Réinitialiser la session',
  },

  actions: {
    // Fonctionne module arrete : c'est justement la premiere chose a faire.
    async activerApi(ctx) {
      const fichiers = await fichiersIni(ctx);
      if (!fichiers.length) {
        return {
          ok: false,
          erreur:
            'Rocket League introuvable (ni Epic ni Steam). Ouvre DefaultStatsAPI.ini dans TAGame\\Config du dossier du jeu, et mets PacketSendRate=30.',
        };
      }
      const rapport = activerFichiers(fichiers);
      const refus = rapport.filter((r) => !r.ok);
      if (refus.length && refus.length === rapport.length) {
        return {
          ok: false,
          erreur:
            'Windows refuse de modifier ' +
            refus[0].fichier +
            ' (dossier protégé). Lance StreamKit en administrateur une fois, ou mets PacketSendRate=30 dans ce fichier à la main.',
        };
      }
      const changes = rapport.filter((r) => r.change).length;
      for (const r of rapport)
        ctx.log.info(
          'API Rocket League : ' + r.fichier + (r.ok ? (r.change ? ' activée' : ' déjà active') : ' — refusé')
        );
      ctx._rafraichirDiag?.();
      return {
        message: changes
          ? 'API activée. Relance Rocket League : le jeu ne lit ce réglage qu’au démarrage.'
          : 'L’API était déjà active. Si rien ne remonte, relance Rocket League.',
      };
    },

    async reinitialiserSession(ctx) {
      if (!ctx._reinitialiser) return { ok: false, erreur: 'Le module doit être démarré.' };
      return { message: 'Session repartie de ' + ctx._reinitialiser() + '.' };
    },
  },

  // Etat de la connexion au jeu, sur la vue d'ensemble. Jeu ferme = « inactif » :
  // c'est l'etat normal quand on ne joue pas, pas une erreur.
  async sante(ctx) {
    const e = ctx._etatRL?.();
    if (!e)
      return [{ id: 'rocket-league', nom: 'Rocket League', etat: 'inactif', detail: 'module au repos' }];

    if (e.connecte) {
      if (!e.identifie) {
        return [
          {
            id: 'rocket-league',
            nom: 'Rocket League',
            etat: 'attention',
            detail: 'connecté — joueur non identifié',
            aide: 'Renseigne ton pseudo en jeu tout en bas des réglages du module : sans lui, les parties ne peuvent pas être attribuées.',
          },
        ];
      }
      if (e.filtre !== 'toutes' && !e.launchLog) {
        return [
          {
            id: 'rocket-league',
            nom: 'Rocket League',
            etat: 'attention',
            detail: 'connecté — Launch.log introuvable',
            aide: 'Sans le journal du jeu, impossible de savoir si une partie est classée. Indique son chemin tout en bas des réglages du module, ou compte « Toutes les parties ».',
          },
        ];
      }
      return [
        {
          id: 'rocket-league',
          nom: 'Rocket League',
          etat: 'ok',
          detail:
            (e.enPartie ? 'en partie' : 'connecté') +
            ' — ' +
            e.bilan.victoires +
            ' V / ' +
            e.bilan.defaites +
            ' D',
          aide: '',
        },
      ];
    }
    if (e.apiActive === false) {
      return [
        {
          id: 'rocket-league',
          nom: 'Rocket League',
          etat: 'attention',
          detail: 'API du jeu désactivée',
          aide: 'Clique sur « Activer l’API dans Rocket League » dans le module, puis relance le jeu.',
        },
      ];
    }
    if (e.jeuLance) {
      return [
        {
          id: 'rocket-league',
          nom: 'Rocket League',
          etat: 'attention',
          detail: 'jeu lancé, mais l’API ne répond pas',
          aide: 'Relance Rocket League : le jeu ne lit le réglage de l’API qu’au démarrage.',
        },
      ];
    }
    return [
      {
        id: 'rocket-league',
        nom: 'Rocket League',
        etat: 'inactif',
        detail: 'jeu fermé',
        aide: 'Lance Rocket League : le compteur se met à jour tout seul.',
      },
    ];
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const stocke = ctx.etat.lire({ historique: [], reinitA: 0 });
    const historique = Array.isArray(stocke.historique) ? stocke.historique : [];
    let reinitA = Number(stocke.reinitA) || 0;
    const lanceA = Date.now();
    const sauver = () => ctx.etat.sauver({ historique, reinitA });

    const depuis = () => debutSession({ mode: c.sessionMode, lanceA, reinitA });
    const calculer = () => bilan(historique, depuis());
    const pousser = () => ctx.overlay.etat('session', { theme: { coin: c.coin }, session: calculer() });
    pousser();

    // --- Launch.log : playlist et identite -----------------------------------
    const lecteur = creerLecteur();
    const cheminLog = await trouverLaunchLog(c.cheminLaunchLog);
    const journal = cheminLog ? creerSuiviFichier(cheminLog, lecteur.ligne) : null;
    if (journal) {
      journal.lire();
      ctx.minuteur.intervalle(() => journal.lire(), 2000);
      ctx.log.info('Journal du jeu : ' + cheminLog);
    } else {
      ctx.log.warn(
        'Launch.log introuvable : impossible de distinguer les parties classées. ' +
          'Lance Rocket League une fois, ou indique son chemin tout en bas des réglages du module.'
      );
    }

    const identite = () => ({ primaryId: lecteur.etat.primaryId, pseudo: c.pseudo });

    // --- Etat de l'API dans les fichiers du jeu ------------------------------
    const diag = { apiActive: null, port: PORT_PAR_DEFAUT, jeuLance: false };
    const rafraichirDiag = async () => {
      const api = etatApi(await fichiersIni(ctx));
      diag.apiActive = api.active;
      diag.port = api.port;
    };
    ctx._rafraichirDiag = rafraichirDiag;
    await rafraichirDiag();
    if (diag.apiActive === false) {
      ctx.log.warn(
        'L’API de stats est désactivée dans Rocket League : clique « Activer l’API dans Rocket League », puis relance le jeu.'
      );
    }

    // --- Parties -------------------------------------------------------------
    const parties = creerSuiviParties({
      identite,
      playlist: ({ forcer }) => {
        if (forcer) journal?.lire();
        return lecteur.etat.playlist;
      },
      surIgnoree: (raison) => ctx.log.info('Partie non comptée : ' + raison + '.'),
      surResultat: (r) => {
        const decision = accepter(r, c);
        const quoi =
          (r.victoire ? 'Victoire' : 'Défaite') +
          ' (' +
          nomPlaylist(r.playlist) +
          (r.scores ? ', ' + r.scores.join('-') : '') +
          ')';
        if (!decision.ok) {
          ctx.log.info(quoi + ' non comptée : ' + decision.raison + '.');
          return;
        }
        ajouter(historique, r);
        sauver();
        ctx.compteur.incr(r.victoire ? 'victoires' : 'defaites');
        const b = calculer();
        ctx.log.ok(quoi + ' — session ' + b.victoires + ' V / ' + b.defaites + ' D.');
        pousser();
      },
    });

    const client = creerClient({
      port: Number(c.port) > 0 ? Number(c.port) : diag.port,
      planifier: (fn, ms) => ctx.minuteur.delai(fn, ms),
      surEtat: (connecte) => {
        if (connecte) {
          ctx.log.ok('Connecté à Rocket League.');
          if (!identite().primaryId && !c.pseudo) {
            ctx.log.warn(
              'Joueur non identifié : renseigne ton pseudo en jeu tout en bas des réglages du module.'
            );
          }
        } else {
          ctx.log.info('Rocket League fermé.');
        }
      },
      surMessage: (m) => {
        if (EVENEMENTS_TRACES.has(m.evenement)) {
          ctx.log.debug(
            m.evenement +
              (m.data?.WinnerTeamNum != null ? ' (vainqueur : équipe ' + m.data.WinnerTeamNum + ')' : '')
          );
        }
        // Une partie terminee (ou quittee) : la suivante devra dire sa playlist.
        if (m.evenement === 'MatchDestroyed') {
          journal?.lire();
        }
        parties.recevoir(m);
        if (m.evenement === 'MatchDestroyed') lecteur.oublierPlaylist();
      },
    });
    client.demarrer();

    // Hors connexion, on regarde de temps en temps si le jeu tourne, pour
    // donner le bon conseil (« lance le jeu » / « relance-le »).
    ctx.minuteur.intervalle(async () => {
      if (client.estConnecte()) return;
      diag.jeuLance = await jeuLance();
    }, 10000);

    // --- Pour la vue d'ensemble et les actions ---------------------------------
    ctx._etatRL = () => ({
      connecte: client.estConnecte(),
      enPartie: parties.enPartie(),
      identifie: !!(identite().primaryId || c.pseudo),
      launchLog: !!cheminLog,
      filtre: c.filtre,
      apiActive: diag.apiActive,
      jeuLance: diag.jeuLance,
      bilan: calculer(),
    });

    ctx._reinitialiser = () => {
      reinitA = Date.now();
      sauver();
      pousser();
      ctx.log.ok('Session réinitialisée.');
      const d = new Date(reinitA);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    // A minuit en mode « journee », la session change sans qu'aucune partie
    // n'arrive : on repousse l'etat de temps en temps.
    if (c.sessionMode === 'day') ctx.minuteur.intervalle(pousser, 60000);

    ctx.log.ok('Prêt. Lance Rocket League : le compteur se met à jour à chaque fin de partie.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('session'));

    return {
      async arreter() {
        client.arreter();
        sauver();
      },
    };
  },
};
