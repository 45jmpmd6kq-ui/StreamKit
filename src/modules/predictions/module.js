// Prédictions — la prédiction Twitch en cours, en direct dans OBS.
//
// Titre, issues, points misés, votants, temps restant ; puis le résultat
// quelques secondes, et le scoreboard disparaît. Rien à faire côté streamer : il
// lance ses prédictions depuis Twitch comme d'habitude.
//
// Deux choses à savoir :
//   - Twitch réserve les prédictions aux chaînes Affiliées et Partenaires. Sur
//     une autre chaîne, le module démarre mais n'aura jamais rien à montrer —
//     la vue d'ensemble le dit, et « Simuler une prédiction » reste utilisable
//     pour régler l'overlay.
//   - Les événements ne disent que les transitions : au démarrage, on demande
//     à Twitch s'il y a déjà une prédiction ouverte (StreamKit relancé en
//     plein live, mise à jour...).

import { creerSuivi, depuisEvenement, depuisHelix, estTerminee, scenarioSimulation } from './predictions.js';

const DROITS = ['channel:read:predictions', 'channel:manage:predictions'];
const peutLire = (ctx) => DROITS.some((d) => ctx.twitch.aLeDroit(d));

export default {
  id: 'predictions',
  nom: 'Prédictions',
  description:
    'Affiche en direct la prédiction Twitch en cours dans OBS : issues, points misés, votants, temps restant, puis le résultat.',
  icone: '🔮',
  categorie: 'twitch',

  scopes: ['channel:read:predictions'],

  config: {
    version: 1,
    champs: [
      {
        cle: 'dureeResultatSec',
        type: 'nombre',
        label: 'Durée d’affichage du résultat (secondes)',
        aide: 'Une fois la prédiction terminée ou annulée, le scoreboard reste ce temps-là, puis disparaît. 0 = disparaît aussitôt.',
        defaut: 15,
        min: 0,
        max: 300,
      },
      {
        cle: 'dureeVerrouSec',
        type: 'nombre',
        label: 'Après la fermeture des votes, disparaître au bout de (secondes)',
        aide:
          'Entre la fin des votes et le résultat, il peut se passer toute une partie : le scoreboard affiche ' +
          '« Votes fermés » ce temps-là, s’efface, puis revient tout seul avec le résultat ou l’annulation. ' +
          '0 = il reste affiché jusqu’au résultat.',
        defaut: 15,
        min: 0,
        max: 600,
      },
      {
        cle: 'couleurBleu',
        type: 'couleur',
        label: 'Couleur de la première issue',
        aide:
          'Le bloc de gauche. Twitch appelle cette couleur « bleu » ; avec plus de deux issues, elles l’utilisent toutes. ' +
          'Le texte est blanc : évite les couleurs trop claires.',
        defaut: '#2f7cff',
      },
      {
        cle: 'couleurRose',
        type: 'couleur',
        label: 'Couleur de la seconde issue',
        aide: 'Le bloc de droite.',
        defaut: '#e8409a',
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
    lancees: 'Prédictions',
    points: 'Points misés',
  },

  overlays: [
    {
      chemin: 'carte',
      nom: 'Prédiction en cours',
      description: 'Scoreboard invisible au repos, qui apparaît dès qu’une prédiction est lancée.',
      fichier: 'carte.html',
    },
  ],

  libellesActions: {
    simuler: 'Simuler une prédiction',
  },

  actions: {
    // Un contexte jetable (module arrêté) n'a pas de _simuler : ses minuteurs
    // seraient coupés dès la fin de l'action, la simulation mourrait aussitôt.
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
          id: 'predictions',
          nom: 'Prédictions',
          etat: 'ko',
          detail: 'droit de lecture des prédictions manquant',
          aide: 'Reconnecte ta chaîne dans Connecteurs → Twitch : le droit « channel:read:predictions » est nécessaire.',
        },
      ];
    }
    if (ctx._refus) {
      return [
        {
          id: 'predictions',
          nom: 'Prédictions',
          etat: 'attention',
          detail: 'Twitch refuse la lecture des prédictions',
          aide: ctx._refus,
        },
      ];
    }
    const p = ctx._suivi?.courante();
    const enCours = p && !estTerminee(p) && !p.simulation;
    return [
      {
        id: 'predictions',
        nom: 'Prédictions',
        etat: 'ok',
        detail: enCours
          ? (p.statut === 'active' ? 'votes ouverts' : 'votes fermés') + ' — ' + p.titre
          : 'en attente d’une prédiction',
        aide: '',
      },
    ];
  },

  // Rapport de bug : ce que Twitch a refuse au demarrage, et ce que le module
  // suit en ce moment.
  async diagnostic(ctx) {
    return { refusDeTwitch: ctx._refus ?? null, enCours: ctx._suivi?.courante() ?? null };
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const theme = { bleu: c.couleurBleu, rose: c.couleurRose, coin: c.coin };
    const publier = (prediction) => ctx.overlay.etat('carte', { theme, prediction });

    const suivi = creerSuivi({
      publier,
      planifier: (fn, ms) => {
        const t = ctx.minuteur.delai(fn, ms);
        return () => clearTimeout(t);
      },
      dureeResultatMs: Math.max(0, c.dureeResultatSec) * 1000,
      // 0 dans le dashboard = ne jamais masquer pendant le verrou.
      masquerVerrouApresMs: c.dureeVerrouSec > 0 ? c.dureeVerrouSec * 1000 : null,
      surNouvelle: (p) => {
        if (p.simulation) return;
        ctx.compteur.incr('lancees');
        ctx.log.info('Prédiction lancée : « ' + p.titre + ' »');
      },
      surTerminee: (p) => {
        if (p.simulation) return;
        if (p.statut === 'annulee') {
          ctx.log.info('Prédiction annulée : « ' + p.titre + ' » — points remboursés.');
          return;
        }
        ctx.compteur.incr('points', p.totalPoints);
        const gagnante = p.issues.find((o) => o.id === p.gagnant);
        ctx.log.ok(
          'Prédiction terminée : « ' +
            p.titre +
            ' » — ' +
            (gagnante ? '« ' + gagnante.titre + ' » l’emporte' : 'résultat reçu') +
            ' (' +
            p.totalPoints +
            ' points, ' +
            p.totalVotants +
            ' participants).'
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
      const p = suivi.courante();
      if (p && !p.simulation && !estTerminee(p)) {
        return { ok: false, erreur: 'Une vraie prédiction est en cours : la simulation attendra.' };
      }
      couperSimulation();
      // Le resultat arrive 5 s APRES la disparition du scoreboard : la simulation
      // montre le vrai deroule, votes fermes -> masque -> resultat.
      const etapes = scenarioSimulation({
        pauseAvantResultatMs: (c.dureeVerrouSec > 0 ? c.dureeVerrouSec * 1000 : 0) + 5000,
      });
      etapesSimulation = etapes.map(({ apresMs, prediction }) =>
        ctx.minuteur.delai(() => suivi.recevoir(prediction), apresMs)
      );
      const duree = Math.round(etapes[etapes.length - 1].apresMs / 1000);
      ctx.log.info('Simulation lancée : résultat dans ' + duree + ' s, rien n’est envoyé à Twitch.');
      return { message: 'Simulation lancée — regarde l’overlay (' + duree + ' s jusqu’au résultat).' };
    };

    // --- Les vrais événements -------------------------------------------------
    if (!peutLire(ctx)) {
      ctx.log.warn(
        'Ton autorisation Twitch ne couvre pas la lecture des prédictions. ' +
          'Reconnecte ta chaîne dans Connecteurs → Twitch.'
      );
      return {
        async arreter() {
          couperSimulation();
          publier(null);
        },
      };
    }

    // Une vraie prediction prend toujours le pas sur une simulation en cours.
    const recevoirVrai = (p) => {
      if (suivi.courante()?.simulation) couperSimulation();
      suivi.recevoir(p);
    };

    ctx.twitch.surPredictions({
      debut: (e) => recevoirVrai(depuisEvenement(e, 'debut')),
      progression: (e) => recevoirVrai(depuisEvenement(e, 'progression')),
      verrou: (e) => recevoirVrai(depuisEvenement(e, 'verrou')),
      fin: (e) => recevoirVrai(depuisEvenement(e, 'fin')),
    });

    // Une prediction deja ouverte avant le demarrage du module.
    try {
      const { data } = await ctx.twitch.api.predictions.getPredictions(ctx.twitch.broadcasterId, {
        limit: 1,
      });
      const p = data?.[0] ? depuisHelix(data[0]) : null;
      if (p && !estTerminee(p)) {
        recevoirVrai(p);
        ctx.log.info('Prédiction déjà en cours reprise : « ' + p.titre + ' »');
      }
      ctx._refus = null;
    } catch (e) {
      if (e?.statusCode === 403) {
        ctx._refus =
          'Twitch réserve les prédictions aux chaînes Affiliées et Partenaires. ' +
          '« Simuler une prédiction » reste utilisable pour régler l’overlay.';
        ctx.log.warn(
          'Twitch refuse la lecture des prédictions : la chaîne n’est probablement ni Affiliée ni Partenaire.'
        );
      } else {
        // Pas grave : on rate seulement une prediction deja ouverte, les
        // suivantes arriveront par les evenements.
        ctx.log.debug('Lecture de la prédiction en cours impossible : ' + (e?.message || e));
      }
    }

    ctx.log.ok('Prêt. Lance une prédiction sur Twitch : elle s’affiche toute seule.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('carte'));

    return {
      async arreter() {
        couperSimulation();
        // Sans ca, l'etat memorise garderait la derniere prediction : une source
        // OBS qui se connecterait plus tard l'afficherait, perimee.
        publier(null);
      },
    };
  },
};
