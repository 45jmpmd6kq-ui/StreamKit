// Module de reference — sert de modele pour tous les autres.
//
// Il n'a besoin de rien (ni Twitch, ni Spotify) : c'est aussi le banc d'essai du
// socle. Active-le depuis le dashboard pour verifier que les reglages, le
// journal et les overlays fonctionnent avant de brancher quoi que ce soit.
//
// Pour creer un module : copier ce dossier, changer l'id (= le nom du dossier),
// vider ce qui ne sert pas.

export default {
  // --- Identite -------------------------------------------------------------
  id: 'exemple', // DOIT etre identique au nom du dossier
  nom: 'Module de démonstration',
  description: "Modèle de référence. Compte les secondes et l'affiche dans un overlay OBS.",
  icone: '🧪',
  jeu: null, // 'rocket-league' | 'valorant' | 'lol' | null si tous jeux

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

  // --- Actions (boutons dans le dashboard) ----------------------------------
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

    ctx.minuteur.intervalle(() => {
      ticks++;
      pousser();
      if (bavard && ticks % 12 === 0) {
        ctx.log.debug(ticks + ' tics — ' + ctx.overlay.nbSources('compteur') + ' source(s) OBS connectée(s)');
      }
    }, Math.max(1, intervalle) * 1000);

    return {
      async arreter() {
        ctx.etat.sauver({ ticks });
        ctx.log.info('Arrêté à ' + ticks + ' tics.');
      },
    };
  },
};
