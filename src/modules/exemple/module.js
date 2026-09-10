// Module de demonstration — banc d essai du socle.
//
// Ce n est PLUS le modele a copier : le contrat a beaucoup grandi et ce module
// est reste au premier jour. Pour ecrire un module, regarde plutot roue-rl
// (pages sur mesure, assets partages) ou valorant (sans Twitch, etat persistant).
//
// Il n'a besoin de rien : ni Twitch, ni Spotify, ni jeu lance. C'est ce qui en
// fait un outil de diagnostic -- si son overlay s'affiche, le socle va bien et
// le probleme est ailleurs.

export default {
  // --- Identite -------------------------------------------------------------
  id: 'exemple', // DOIT etre identique au nom du dossier
  nom: 'Module de démonstration',
  description: "Modèle de référence. Compte les secondes et l'affiche dans un overlay OBS.",
  icone: '🧪',
  // Regroupement dans le rail du dashboard. Voir core/categories.js.
  // 'twitch' | 'rocket-league' | 'lol' | 'valorant' | 'outils'
  categorie: 'outils',

  // Masque du rail par defaut : c'est un outil de diagnostic, pas une
  // fonctionnalite. Il reste le SEUL module qui tourne sans aucune dependance
  // externe -- quand un streamer dit « ca marche pas », l'activer repond a la
  // question « est-ce le socle ou le service ? ».
  // Revelable par « Afficher les modules de developpement » dans les reglages.
  developpement: true,

  // --- Droits Twitch demandes ------------------------------------------------
  // StreamKit demande l'union des droits de TOUS les modules a l'autorisation :
  // activer un module plus tard ne redemandera pas au streamer de se reconnecter.
  scopes: [],

  // --- Reglages -------------------------------------------------------------
  // Le dashboard fabrique l'ecran de reglages a partir de ceci. On n'ecrit
  // jamais de formulaire a la main.
  config: {
    version: 1, // a incrementer quand le schema change (voir migrations)
    champs: [
      {
        cle: 'message',
        type: 'texte',
        label: 'Message affiché',
        aide: "Ce texte apparaît dans l'overlay.",
        defaut: 'StreamKit tourne 🎉',
      },
      {
        cle: 'intervalle',
        type: 'nombre',
        label: 'Rythme (secondes)',
        aide: 'Fréquence de mise à jour de l’overlay.',
        defaut: 5,
        min: 1,
        max: 3600,
      },
      {
        cle: 'bavard',
        type: 'bool',
        label: 'Écrire dans le journal',
        aide: 'Utile pour vérifier que le flux du journal fonctionne.',
        defaut: true,
      },
      {
        cle: 'couleur',
        type: 'couleur',
        label: 'Couleur principale',
        defaut: '#9146ff',
      },
      {
        cle: 'coin',
        type: 'choix',
        label: 'Position dans OBS',
        defaut: 'top-left',
        options: [
          { valeur: 'top-left', label: 'En haut à gauche' },
          { valeur: 'top-right', label: 'En haut à droite' },
          { valeur: 'bottom-left', label: 'En bas à gauche' },
          { valeur: 'bottom-right', label: 'En bas à droite' },
        ],
      },
      {
        cle: 'motsInterdits',
        type: 'liste',
        label: 'Liste de démonstration',
        aide: 'Un élément par ligne. Montre le champ « liste ».',
        defaut: [],
      },
    ],
  },

  // Migrations des reglages entre versions de schema.
  // Exemple : si on passait la version a 2 en renommant « intervalle » :
  //   migrations: { 2: (r) => ({ ...r, rythme: r.intervalle }) }
  migrations: {},

  // --- Overlays OBS ---------------------------------------------------------
  overlays: [
    {
      chemin: 'compteur', // -> http://127.0.0.1:4455/overlay/exemple/compteur
      nom: 'Compteur',
      description: 'Source Navigateur de démonstration.',
      fichier: 'compteur.html', // dans le sous-dossier overlay/
    },
  ],

  // --- Actions -------------------------------------------------------------
  // Seules celles listees dans libellesActions apparaissent en bouton dans le
  // dashboard. Les autres restent appelables par les pages du module.
  libellesActions: {
    tester: 'Tester l’overlay',
  },

  actions: {
    // POST /api/modules/exemple/action/tester
    async tester(ctx) {
      ctx.log.ok('Bouton « Tester » : tout fonctionne.');
      ctx.overlay.diffuser('compteur', 'notification', { texte: 'Test depuis le dashboard' });
      return { message: 'Test envoyé à l’overlay.' };
    },
  },

  // --- Cycle de vie ---------------------------------------------------------
  // demarrer() recoit le contexte et renvoie de quoi s'arreter proprement.
  // Les minuteurs pris via ctx.minuteur sont coupes automatiquement : pas besoin
  // de les nettoyer soi-meme.
  async demarrer(ctx) {
    const { message, intervalle, bavard, couleur, coin } = ctx.config;

    // On reprend le compteur la ou il en etait au dernier arret.
    const memoire = ctx.etat.lire({ ticks: 0 });
    let ticks = memoire.ticks;

    ctx.log.info('Démarré. Overlay : ' + ctx.overlay.url('compteur'));

    const pousser = () => {
      ctx.overlay.etat('compteur', { message, ticks, couleur, coin });
    };
    pousser();

    ctx.minuteur.intervalle(
      () => {
        ticks++;
        pousser();
        if (bavard && ticks % 12 === 0) {
          ctx.log.debug(
            ticks + ' tics — ' + ctx.overlay.nbSources('compteur') + ' source(s) OBS connectée(s)'
          );
        }
      },
      Math.max(1, intervalle) * 1000
    );

    return {
      async arreter() {
        ctx.etat.sauver({ ticks });
        ctx.log.info('Arrêté à ' + ticks + ' tics.');
      },
    };
  },
};
