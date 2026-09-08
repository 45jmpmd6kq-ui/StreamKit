// Roue des voitures — portage du projet Roue-Voitures-RL dans StreamKit.
//
// A chaque utilisation de la recompense de points de chaine, tire une voiture
// au sort parmi celles que le streamer possede, et l'affiche dans un overlay
// OBS en forme de machine a sous.
//
// Ce que le socle fournit et qui a disparu du module : la connexion Twitch, le
// serveur d'overlay, le rafraichissement des jetons, le journal, la
// persistance, l'ecran de reglages.
//
// Ce qui reste specifique : le catalogue des 137 carrosseries, la selection du
// streamer (page « Mes voitures »), et la file de tirages.

import { Roue } from './roue.js';
import * as voitures from './voitures.js';

export default {
  id: 'roue-rl',
  nom: 'Roue des voitures',
  description:
    'Les viewers tirent au sort une de tes voitures avec leurs points de chaîne. Machine à sous animée dans OBS.',
  icone: '🎡',
  categorie: 'rocket-league',

  scopes: ['channel:read:redemptions', 'channel:manage:redemptions', 'chat:read', 'chat:edit'],

  config: {
    version: 1,
    champs: [
      // --- Recompense ---
      {
        cle: 'rewardTitle',
        type: 'texte',
        label: 'Nom de la récompense',
        aide: 'Créée automatiquement sur ta chaîne si elle n’existe pas encore.',
        defaut: '🚗 Random Car',
        requis: true,
      },
      {
        cle: 'rewardCost',
        type: 'nombre',
        label: 'Coût en points',
        defaut: 500,
        min: 1,
        max: 1000000,
      },
      {
        cle: 'rewardCooldownSec',
        type: 'nombre',
        label: 'Délai entre deux utilisations (secondes)',
        aide: 'Appliqué par Twitch à la création de la récompense.',
        defaut: 60,
        min: 0,
        max: 86400,
      },

      // --- Tirage ---
      {
        cle: 'avoidRepeat',
        type: 'bool',
        label: 'Ne jamais retomber sur la voiture précédente',
        aide: 'Sur 3 ou 4 voitures, le hasard pur donne vite l’impression d’un bug.',
        defaut: true,
      },
      {
        cle: 'noRepeatUntilExhausted',
        type: 'bool',
        label: 'Passer toutes les voitures avant d’en répéter une',
        aide: 'Mode « sac de tirage » : plus équitable sur une longue session.',
        defaut: false,
      },
      {
        cle: 'announceInChat',
        type: 'bool',
        label: 'Annoncer le résultat dans le chat',
        defaut: true,
      },

      // --- Overlay ---
      {
        cle: 'spinSeconds',
        type: 'nombre',
        label: 'Durée du défilement (secondes)',
        defaut: 5.2,
        min: 1,
        max: 30,
        pas: 0.1,
      },
      {
        cle: 'holdSeconds',
        type: 'nombre',
        label: 'Durée d’affichage du résultat (secondes)',
        defaut: 6.5,
        min: 1,
        max: 60,
        pas: 0.5,
      },
      {
        cle: 'accent1',
        type: 'couleur',
        label: 'Couleur principale',
        aide: 'Cadre et curseur de la machine.',
        defaut: '#00b0ff',
      },
      {
        cle: 'accent2',
        type: 'couleur',
        label: 'Couleur du résultat',
        defaut: '#ff9800',
      },
      {
        cle: 'corner',
        type: 'choix',
        label: 'Position dans OBS',
        aide: 'Chaque source peut aussi forcer la sienne avec ?corner=center.',
        defaut: 'bottom-right',
        options: [
          { valeur: 'top-left', label: 'En haut à gauche' },
          { valeur: 'top-right', label: 'En haut à droite' },
          { valeur: 'bottom-left', label: 'En bas à gauche' },
          { valeur: 'bottom-right', label: 'En bas à droite' },
          { valeur: 'center', label: 'Au centre' },
        ],
      },
    ],
  },

  compteurs: {
    tirages: 'Tirages',
    rembourses: 'Remboursés (aucune voiture)',
  },

  migrations: {},

  overlays: [
    {
      chemin: 'roue',
      nom: 'Machine à sous',
      description: 'Invisible au repos : elle n’apparaît qu’au moment d’un tirage.',
      fichier: 'roue.html',
    },
  ],

  pages: [
    {
      chemin: 'voitures',
      nom: 'Mes voitures',
      description: 'Coche les carrosseries que tu possèdes — elles seules seront tirées.',
      fichier: 'voitures.html',
    },
  ],

  libellesActions: {
    catalogue: 'Voir la sélection',
    tirageDeTest: 'Lancer un tirage de test',
  },

  actions: {
    // Utilisee par la page « Mes voitures » pour se remplir.
    async catalogue(ctx) {
      const possedees = ctx.etat.lire({ possedees: [] }).possedees;
      const { voitures: resolues, inconnues } = voitures.resoudre(possedees);
      return {
        message: resolues.length
          ? resolues.length + ' voiture(s) sélectionnée(s).'
          : 'Aucune voiture sélectionnée — les utilisations seraient remboursées.',
        catalogue: voitures.catalogue(),
        possedees,
        selection: resolues.map((v) => v.slug),
        inconnues,
        base: voitures.VOITURES_DE_BASE,
      };
    },

    // Ecriture depuis la page « Mes voitures ».
    async enregistrer(ctx, corps) {
      const propre = voitures.nettoyer(corps?.noms ?? []);
      ctx.etat.sauver({ possedees: propre });
      ctx.log.ok('Sélection mise à jour : ' + propre.length + ' voiture(s).');
      // La roue doit oublier son sac et son dernier tirage : la liste a change.
      ctx._roue?.reset();
      return { message: propre.length + ' voiture(s) enregistrée(s).', nombre: propre.length };
    },

    // Permet de regler l'overlay dans OBS sans depenser de points.
    async tirageDeTest(ctx) {
      if (!ctx._tirer) return { ok: false, erreur: 'Le module doit être démarré pour lancer un tirage.' };
      const r = await ctx._tirer('Test');
      return { message: r ? 'Tirage lancé : ' + r : 'Aucune voiture sélectionnée.' };
    },
  },

  async demarrer(ctx) {
    const c = ctx.config;

    const roue = new Roue({
      avoidRepeat: c.avoidRepeat !== false,
      noRepeatUntilExhausted: c.noRepeatUntilExhausted === true,
    });
    ctx._roue = roue; // pour que l'action « enregistrer » puisse la reinitialiser

    const spinMs = Math.round(c.spinSeconds * 1000);
    const holdMs = Math.round(c.holdSeconds * 1000);

    const theme = { accent1: c.accent1, accent2: c.accent2, corner: c.corner };
    ctx.overlay.etat('roue', { theme });

    const annoncer = (msg) => {
      if (c.announceInChat !== false) ctx.twitch.dire(msg);
    };

    // --- Selection courante ---------------------------------------------------
    // Relue a CHAQUE tirage : le streamer peut cocher des voitures en plein live
    // depuis la page « Mes voitures », ca doit s'appliquer tout de suite.
    function selection() {
      const possedees = ctx.etat.lire({ possedees: [] }).possedees;
      return voitures.resoudre(possedees);
    }

    const depart = selection();
    if (depart.voitures.length) {
      ctx.log.ok(depart.voitures.length + ' voiture(s) en jeu.');
    } else {
      ctx.log.warn(
        'Aucune voiture sélectionnée : les utilisations seront remboursées. ' +
          'Ouvre « Mes voitures » depuis le dashboard.'
      );
    }
    if (depart.inconnues.length) {
      ctx.log.warn(depart.inconnues.length + ' nom(s) non reconnu(s) : ' + depart.inconnues.join(', '));
    }

    // --- Recompense -----------------------------------------------------------

    const recompense = await ctx.twitch.assurerRecompense({
      titre: c.rewardTitle,
      cout: c.rewardCost,
      prompt: 'Tire au sort une voiture parmi celles du streamer. Il la joue pour le prochain match !',
      saisieRequise: false,
      couleur: c.accent1,
      cooldownSec: c.rewardCooldownSec,
    });

    // --- File de tirages ------------------------------------------------------
    // Les utilisations qui s'enchainent sont mises en file : deux rouleaux qui se
    // chevauchent a l'ecran seraient illisibles, et le second ecraserait le
    // premier avant qu'on ait lu le resultat.
    const file = [];
    let enCours = false;

    async function tirer(par, redemption = null) {
      const { voitures: dispo, inconnues } = selection();

      if (inconnues.length) {
        ctx.log.warn('Noms ignorés : ' + inconnues.join(', '));
      }

      if (!dispo.length) {
        ctx.log.err(par + ' : aucune voiture configurée, points remboursés.');
        ctx.compteur.incr('rembourses');
        annoncer('@' + par + " aucune voiture n'est configurée pour l'instant, tes points t'ont été rendus.");
        if (redemption) await ctx.twitch.statutRedemption(redemption, 'CANCELED');
        return null;
      }

      const gagnante = roue.spin(dispo);
      ctx.log.ok(par + ' → ' + gagnante.name);
      ctx.compteur.incr('tirages');

      ctx.overlay.diffuser('roue', 'spin', { by: par, winner: gagnante, pool: dispo, spinMs, holdMs });

      // Les points sont valides des que le tirage part : l'animation dure encore
      // quelques secondes, inutile de faire patienter le viewer.
      if (redemption) await ctx.twitch.statutRedemption(redemption, 'FULFILLED');

      // Annonce differee, pour tomber en meme temps que le resultat a l'ecran.
      ctx.minuteur.delai(() => annoncer('@' + par + ' a tiré : ' + gagnante.name + ' 🚗'), spinMs);

      return gagnante.name;
    }

    ctx._tirer = tirer; // utilise par l'action « tirage de test »

    function empiler(job) {
      file.push(job);
      if (!enCours) void suivant();
    }

    async function suivant() {
      const job = file.shift();
      if (!job) {
        enCours = false;
        return;
      }
      enCours = true;
      try {
        await tirer(job.par, job.redemption);
      } catch (e) {
        ctx.log.err('Tirage en échec : ' + (e?.message || e));
      }
      // On laisse l'overlay finir son animation avant d'enchainer.
      ctx.minuteur.delai(() => void suivant(), spinMs + 1200);
    }

    ctx.twitch.surRecompense(recompense.id, (e) => {
      empiler({ par: e.userDisplayName, redemption: e });
    });

    ctx.log.ok('Prêt. Récompense surveillée : « ' + c.rewardTitle + ' ».');

    return {
      async arreter() {
        file.length = 0;
        // L'overlay peut etre reste sur un resultat : on le referme proprement.
        ctx.overlay.diffuser('roue', 'hide', {});
      },
    };
  },
};
