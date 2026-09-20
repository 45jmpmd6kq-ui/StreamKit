// Moments forts Rocket League : la game de chauffe et l'overtime, a l'ecran.
//
// Source : l'API de stats officielle, par la connexion que partage le compteur
// de session (voir abonner dans ../rl-session/flux.js). Rien n'est injecte
// dans le jeu. Ni Twitch ni chat : tout se passe dans la source OBS.
//
// Les aides sur le jeu (fichiers de l'API, Launch.log, connexion) viennent du
// module voisin plutot que d'etre recopiees, comme les moments forts LoL
// empruntent au suivi de session LoL.

import { abonner } from '../rl-session/flux.js';
import { etatApi, fichiersApi, jeuLance } from '../rl-session/installation.js';
import { trouverLaunchLog } from '../rl-session/journal-jeu.js';
import { creerDetecteur } from './detection.js';

const TEXTE_CHAUFFE = 'On se chauffe, soyez indulgents';

// « Afficher un exemple » : la chauffe, puis l'overtime (millisecondes).
const EXEMPLE = { finChauffe: 7000, overtime: 8000, finOvertime: 16000 };

export default {
  id: 'rl-moments',
  nom: 'Moments forts',
  description:
    'La game de chauffe en début de session, l’overtime quand la prolongation commence : une annonce, puis une pastille qui reste. Lit la partie en cours, sans toucher au jeu.',
  icone: '⚡',
  categorie: 'rocket-league',

  // Volontairement vide : rien ne part sur Twitch.
  scopes: [],

  config: {
    version: 1,
    champs: [
      {
        cle: 'chauffe',
        type: 'bool',
        label: 'Annoncer la game de chauffe',
        aide: 'Au premier coup d’envoi de ta première partie, puis de nouveau après 3 h sans jouer. Le bouton « Réarmer la game de chauffe » la relance à la main.',
        defaut: true,
      },
      {
        cle: 'texteChauffe',
        type: 'texte',
        label: 'Texte de la game de chauffe',
        aide: 'Affiché sous « GAME DE CHAUFFE ».',
        defaut: TEXTE_CHAUFFE,
        max: 80,
      },
      {
        cle: 'pastilleChauffe',
        type: 'bool',
        label: 'Garder la pastille « CHAUFFE » jusqu’à la fin de la partie',
        aide: 'Éteint : l’annonce seule, puis plus rien à l’écran.',
        defaut: true,
      },
      {
        cle: 'overtime',
        type: 'bool',
        label: 'Annoncer l’overtime',
        defaut: true,
      },
      {
        cle: 'pastilleOvertime',
        type: 'bool',
        label: 'Garder la pastille « OVERTIME » jusqu’au but en or',
        aide: 'Éteint : l’annonce seule. Le pouls, lui, a son propre réglage.',
        defaut: true,
      },
      {
        cle: 'pouls',
        type: 'bool',
        label: 'Pouls rouge sur les bords de l’écran pendant l’overtime',
        defaut: true,
      },
    ],
  },

  migrations: {},

  compteurs: {
    chauffes: 'Games de chauffe',
    overtimes: 'Overtimes',
  },

  overlays: [
    {
      chemin: 'moments',
      nom: 'Moments forts',
      description: 'La game de chauffe et l’overtime. Une seule source, à la taille de ta scène.',
      fichier: 'moments.html',
    },
  ],

  libellesActions: {
    exemple: 'Afficher un exemple',
    rearmer: 'Réarmer la game de chauffe',
  },

  actions: {
    async exemple(ctx) {
      if (!ctx._exemple) return { ok: false, erreur: 'Le module doit être démarré.' };
      ctx._exemple();
      return {
        message:
          'Exemple en cours (16 secondes) : la game de chauffe avec ton texte, puis l’overtime. Rien ne part dans le chat.',
      };
    },

    async rearmer(ctx) {
      if (!ctx._rearmer) return { ok: false, erreur: 'Le module doit être démarré.' };
      ctx._rearmer();
      return { message: 'La prochaine partie sera annoncée comme game de chauffe.' };
    },
  },

  // Jeu ferme = « inactif » : c'est l'etat normal quand on ne joue pas.
  async sante(ctx) {
    const e = ctx._etatMoments?.();
    const ligne = (etat, detail, aide = '') => [
      { id: 'rl-moments', nom: 'Rocket League', etat, detail, aide },
    ];
    if (!e) return ligne('inactif', 'module au repos');
    if (!e.connecte) {
      if (e.apiActive === false) {
        return ligne(
          'attention',
          'API du jeu désactivée',
          'Clique « Activer l’API dans Rocket League » dans le module Compteur de session, puis relance le jeu.'
        );
      }
      // Le jeu tourne et l'API ne repond pas : il a demarre avec le reglage
      // eteint (Rocket League le remet a zero tout seul, voir installation.js).
      // Dire « jeu fermé » a ce moment-la, c'est envoyer le streamer chercher
      // ailleurs -- vecu le 20/09/2026.
      // ctx._jeuLance : injecte par les tests, pour ne pas dependre de ce qui
      // tourne sur la machine qui les lance.
      if (await (ctx._jeuLance ?? jeuLance)()) {
        return ligne(
          'attention',
          'jeu lancé, mais l’API ne répond pas',
          'Relance Rocket League : il ne lit le réglage de l’API qu’au démarrage.'
        );
      }
      return ligne(
        'inactif',
        'jeu fermé',
        'Lance Rocket League : les moments forts s’affichent pendant tes parties.'
      );
    }
    // Seulement ce qui s'affiche : une animation coupee dans les reglages ne
    // s'annonce pas ici non plus.
    const { chauffe, overtime } = ctx.config;
    if (overtime && e.enOvertime) return ligne('ok', 'connecté — overtime en cours');
    if (chauffe && e.enChauffe) return ligne('ok', 'connecté — game de chauffe en cours');
    if (chauffe && e.arme) return ligne('ok', 'connecté — game de chauffe à la prochaine partie');
    return ligne('ok', 'connecté');
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const det = creerDetecteur({ memoire: ctx.etat.lire({ derniereActiviteA: 0, rearme: false }) });

    // Ecrit seulement quand la memoire change : UpdateState arrive 30 fois par
    // seconde, la memoire bouge deux fois par partie.
    let memorise = JSON.stringify(det.memoire());
    const sauver = () => {
      const texte = JSON.stringify(det.memoire());
      if (texte === memorise) return;
      memorise = texte;
      ctx.etat.sauver(det.memoire());
    };

    // --- Overlay -------------------------------------------------------------

    let exemple = { chauffe: false, overtime: false };
    const pousser = () =>
      ctx.overlay.etat('moments', {
        texte: c.texteChauffe,
        pouls: c.pouls,
        // Garder la pastille apres l'annonce : c'est l'overlay qui l'applique,
        // pour que ?demo=1 montre la meme chose que le live.
        garder: { chauffe: c.pastilleChauffe, overtime: c.pastilleOvertime },
        // Ce qui est en cours dans la partie (ou dans l'exemple).
        pastilles: {
          chauffe: exemple.chauffe || (c.chauffe && det.enChauffe()),
          overtime: exemple.overtime || (c.overtime && det.enOvertime()),
        },
      });
    pousser();

    function annoncer(type) {
      if (type === 'chauffe' && c.chauffe) {
        ctx.overlay.diffuser('moments', 'moment', { type, texte: c.texteChauffe });
        ctx.compteur.incr('chauffes');
        ctx.log.ok('Game de chauffe annoncée.');
      } else if (type === 'overtime' && c.overtime) {
        ctx.overlay.diffuser('moments', 'moment', { type });
        ctx.compteur.incr('overtimes');
        ctx.log.ok('Overtime !');
      }
    }

    // --- Jeu -------------------------------------------------------------------

    // La liste des fichiers ne bouge pas de la session ; leur CONTENU si : le
    // jeu remet l'API a zero tout seul (voir ../rl-session/installation.js).
    // C'est le compteur de session qui la rallume -- un seul module ecrit dans
    // les fichiers du jeu --, mais la carte doit dire la verite du moment.
    const fichiers = await fichiersApi(await trouverLaunchLog(''));
    const api = etatApi(fichiers);
    let champsNotes = false;

    const client = abonner({
      // ctx.portJeu : un faux jeu, injecte par les tests.
      port: ctx.portJeu ?? api.port,
      surErreur: (e) => ctx.log.warn('Message du jeu mal traité : ' + (e?.message || e)),
      surEtat: (connecte) => ctx.log.debug(connecte ? 'Connecté à Rocket League.' : 'Rocket League fermé.'),
      surMessage: (m) => {
        // Une fois par partie, les champs de Game au journal : si l'overtime ne
        // se declenche jamais, c'est la que le support regardera.
        if (m.evenement === 'UpdateState' && !champsNotes && m.data?.Game) {
          champsNotes = true;
          ctx.log.debug('Champs de Game : ' + Object.keys(m.data.Game).join(', '));
        }
        if (m.evenement === 'MatchDestroyed') champsNotes = false;

        const sorties = det.recevoir(m);
        sauver();
        if (!sorties.length) return;
        for (const s of sorties) annoncer(s.type);
        pousser();
      },
    });

    // --- Pour la vue d'ensemble et les actions -------------------------------

    ctx._etatMoments = () => ({
      connecte: client.estConnecte(),
      apiActive: client.estConnecte() ? true : etatApi(fichiers).active,
      arme: det.arme(),
      enChauffe: det.enChauffe(),
      enOvertime: det.enOvertime(),
    });

    ctx._exemple = () => {
      const poser = (e) => {
        exemple = e;
        pousser();
      };
      ctx.overlay.diffuser('moments', 'moment', { type: 'chauffe', texte: c.texteChauffe });
      poser({ chauffe: true, overtime: false });
      ctx.minuteur.delai(() => poser({ chauffe: false, overtime: false }), EXEMPLE.finChauffe);
      ctx.minuteur.delai(() => {
        ctx.overlay.diffuser('moments', 'moment', { type: 'overtime' });
        poser({ chauffe: false, overtime: true });
      }, EXEMPLE.overtime);
      ctx.minuteur.delai(() => poser({ chauffe: false, overtime: false }), EXEMPLE.finOvertime);
    };

    ctx._rearmer = () => {
      det.rearmer();
      sauver();
      ctx.log.ok('Game de chauffe réarmée : la prochaine partie sera annoncée.');
    };

    ctx.log.ok('Prêt. La game de chauffe et l’overtime s’affichent pendant tes parties de Rocket League.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('moments'));

    return {
      async arreter() {
        client.arreter();
        sauver();
      },
    };
  },
};
