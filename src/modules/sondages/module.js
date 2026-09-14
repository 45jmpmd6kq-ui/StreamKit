// Sondages — le sondage Twitch en cours, en direct dans OBS.
//
// Meme famille visuelle que Predictions (scoreboard biseaute) : une ligne par
// choix avec son pourcentage, le total des votes et le temps restant ; puis le
// resultat quelques secondes, et la carte disparait.
//
// Twitch reserve les sondages aux chaines Affiliees et Partenaires. Sur une
// autre chaine, le module demarre mais n'aura rien a montrer ; « Simuler un
// sondage » reste utilisable pour regler l'overlay.

import { creerSuivi, depuisEvenement, depuisHelix, estTermine, scenarioSimulation } from './sondages.js';

const DROITS = ['channel:read:polls', 'channel:manage:polls'];
const peutLire = (ctx) => DROITS.some((d) => ctx.twitch.aLeDroit(d));

export default {
  id: 'sondages',
  nom: 'Sondages',
  description:
    'Affiche en direct le sondage Twitch en cours dans OBS : pourcentage de chaque choix, votes, temps restant, puis le résultat.',
  icone: '🗳️',
  categorie: 'twitch',

  scopes: ['channel:read:polls'],

  config: {
    version: 1,
    champs: [
      {
        cle: 'dureeResultatSec',
        type: 'nombre',
        label: 'Durée d’affichage du résultat (secondes)',
        aide: 'Une fois le sondage terminé, le scoreboard reste ce temps-là, puis disparaît. 0 = disparaît aussitôt.',
        defaut: 15,
        min: 0,
        max: 300,
      },
      {
        cle: 'coin',
        type: 'choix',
        label: 'Position dans OBS',
        defaut: 'top-right',
        options: [
          { valeur: 'top-left', label: 'En haut à gauche' },
          { valeur: 'top-center', label: 'En haut au centre' },
          { valeur: 'top-right', label: 'En haut à droite' },
          { valeur: 'bottom-left', label: 'En bas à gauche' },
          { valeur: 'bottom-center', label: 'En bas au centre' },
          { valeur: 'bottom-right', label: 'En bas à droite' },
        ],
      },
    ],
  },

  migrations: {},

  compteurs: {
    sondages: 'Sondages',
    votes: 'Votes',
  },

  overlays: [
    {
      chemin: 'carte',
      nom: 'Sondage en cours',
      description: 'Scoreboard invisible au repos, qui apparaît dès qu’un sondage est lancé.',
      fichier: 'carte.html',
    },
  ],

  libellesActions: {
    simuler: 'Simuler un sondage',
  },

  actions: {
    // Un contexte jetable (module arrete) n'a pas de _simuler : ses minuteurs
    // seraient coupes des la fin de l'action.
    async simuler(ctx) {
      if (!ctx._simuler) {
        return {
          ok: false,
          erreur: 'Le module doit être démarré (activé, et Twitch connecté) pour lancer une simulation.',
        };
      }
      return ctx._simuler();
    },
  },

  async sante(ctx) {
    if (!peutLire(ctx)) {
      return [
        {
          id: 'sondages',
          nom: 'Sondages',
          etat: 'ko',
          detail: 'droit de lecture des sondages manquant',
          aide: 'Reconnecte ta chaîne dans Connecteurs → Twitch : le droit « channel:read:polls » est nécessaire.',
        },
      ];
    }
    if (ctx._refus) {
      return [
        {
          id: 'sondages',
          nom: 'Sondages',
          etat: 'attention',
          detail: 'Twitch refuse la lecture des sondages',
          aide: ctx._refus,
        },
      ];
    }
    const s = ctx._suivi?.courant();
    const enCours = s && !estTermine(s) && !s.simulation;
    return [
      {
        id: 'sondages',
        nom: 'Sondages',
        etat: 'ok',
        detail: enCours ? 'sondage en cours — ' + s.titre : 'en attente d’un sondage',
        aide: '',
      },
    ];
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const theme = { coin: c.coin };
    const publier = (sondage) => ctx.overlay.etat('carte', { theme, sondage });

    const suivi = creerSuivi({
      publier,
      planifier: (fn, ms) => {
        const t = ctx.minuteur.delai(fn, ms);
        return () => clearTimeout(t);
      },
      dureeResultatMs: Math.max(0, c.dureeResultatSec) * 1000,
      surNouveau: (s) => {
        if (s.simulation) return;
        ctx.compteur.incr('sondages');
        ctx.log.info('Sondage lancé : « ' + s.titre + ' »');
      },
      surTermine: (s) => {
        if (s.simulation) return;
        ctx.compteur.incr('votes', s.totalVotes);
        const gagnants = s.choix.filter((x) => s.gagnants.includes(x.id)).map((x) => '« ' + x.titre + ' »');
        ctx.log.ok(
          'Sondage terminé : « ' +
            s.titre +
            ' » — ' +
            (gagnants.length
              ? gagnants.join(' et ') + (gagnants.length > 1 ? ' à égalité' : ' l’emporte')
              : 'aucun vote') +
            ' (' +
            s.totalVotes +
            ' votes).'
        );
      },
    });
    ctx._suivi = suivi;
    publier(null); // l'overlay recoit le theme tout de suite

    // --- Simulation ---------------------------------------------------------
    let etapesSimulation = [];
    const couperSimulation = () => {
      etapesSimulation.forEach(clearTimeout);
      etapesSimulation = [];
    };

    ctx._simuler = () => {
      const s = suivi.courant();
      if (s && !s.simulation && !estTermine(s)) {
        return { ok: false, erreur: 'Un vrai sondage est en cours : la simulation attendra.' };
      }
      couperSimulation();
      const etapes = scenarioSimulation();
      etapesSimulation = etapes.map(({ apresMs, sondage }) =>
        ctx.minuteur.delai(() => suivi.recevoir(sondage), apresMs)
      );
      const duree = Math.round(etapes.at(-1).apresMs / 1000);
      ctx.log.info('Simulation lancée : résultat dans ' + duree + ' s, rien n’est envoyé à Twitch.');
      return { message: 'Simulation lancée — regarde l’overlay (' + duree + ' s jusqu’au résultat).' };
    };

    if (!peutLire(ctx)) {
      ctx.log.warn(
        'Ton autorisation Twitch ne couvre pas la lecture des sondages. Reconnecte ta chaîne dans Connecteurs → Twitch.'
      );
      return {
        async arreter() {
          couperSimulation();
          publier(null);
        },
      };
    }

    // Un vrai sondage prend toujours le pas sur une simulation en cours.
    const recevoirVrai = (s) => {
      if (suivi.courant()?.simulation) couperSimulation();
      suivi.recevoir(s);
    };

    ctx.twitch.surSondages({
      debut: (e) => recevoirVrai(depuisEvenement(e, 'debut')),
      progression: (e) => recevoirVrai(depuisEvenement(e, 'progression')),
      fin: (e) => recevoirVrai(depuisEvenement(e, 'fin')),
    });

    // Un sondage deja ouvert avant le demarrage du module.
    try {
      const { data } = await ctx.twitch.api.polls.getPolls(ctx.twitch.broadcasterId, { limit: 1 });
      const s = data?.[0] ? depuisHelix(data[0]) : null;
      if (s && !estTermine(s)) {
        recevoirVrai(s);
        ctx.log.info('Sondage déjà en cours repris : « ' + s.titre + ' »');
      }
      ctx._refus = null;
    } catch (e) {
      if (e?.statusCode === 403) {
        ctx._refus =
          'Twitch réserve les sondages aux chaînes Affiliées et Partenaires. « Simuler un sondage » reste utilisable pour régler l’overlay.';
        ctx.log.warn(
          'Twitch refuse la lecture des sondages : la chaîne n’est probablement ni Affiliée ni Partenaire.'
        );
      } else {
        ctx.log.debug('Lecture du sondage en cours impossible : ' + (e?.message || e));
      }
    }

    ctx.log.ok('Prêt. Lance un sondage sur Twitch : il s’affiche tout seul.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('carte'));

    return {
      async arreter() {
        couperSimulation();
        // Sans ca, l'etat memorise garderait le dernier sondage : une source OBS
        // qui se connecterait plus tard l'afficherait, perime.
        publier(null);
      },
    };
  },
};
