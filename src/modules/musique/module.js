// Bot Musique — portage du projet Bot-Musique-Twitch-V2 dans StreamKit.
//
// Ce que fait le module :
//  - recompense de points de chaine « demande de musique » -> ajout a la file Spotify
//  - recompense « annuler une musique » -> le morceau sera saute a son passage
//    (Spotify ne permet pas de retirer un morceau precis de sa file)
//  - commandes de chat : passer le morceau, afficher le morceau en cours
//  - deux overlays OBS : les annonces (7 s) et la liste « a venir » (permanente)
//
// Ce qui a disparu par rapport a la version autonome, et que le socle fournit :
// la connexion Twitch, le serveur d'overlay, le rafraichissement des jetons, le
// journal, la persistance et l'ecran de reglages.

import { SpotifyClient, looseMatch } from './spotify.js';
import { creerFile } from './file.js';

const TITRE_ANNULATION = '🚫 On écoute pas ta musique de merde';
const VUES = ['annonces', 'liste'];

export default {
  id: 'musique',
  nom: 'Bot Musique',
  description:
    'Les viewers demandent une musique avec leurs points de chaîne, elle part dans ta file Spotify. Avec refus et passage.',
  icone: '🎵',
  categorie: 'twitch',

  // Spotify est configure UNE fois dans l'ecran Connecteurs, pas ici : deux
  // modules Spotify auraient sinon demande deux fois le meme ID et le meme
  // secret, et le streamer devait chercher « ou on configure Spotify » au fond
  // d'un module.
  connecteurs: ['spotify'],

  scopes: [
    'channel:read:redemptions',
    'channel:manage:redemptions',
    'chat:read',
    'chat:edit',
  ],

  config: {
    version: 3,
    champs: [
      // --- Recompense principale ---
      {
        cle: 'rewardTitle',
        type: 'texte',
        label: 'Nom de la récompense « demande de musique »',
        aide: 'Créée automatiquement sur ta chaîne si elle n’existe pas encore.',
        defaut: '🎵 Demande de musique',
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

      // --- Annulation ---
      {
        cle: 'annulationActive',
        type: 'bool',
        label: 'Autoriser le refus d’une musique',
        aide: 'Une seconde récompense permet aux viewers d’annuler une musique en attente.',
        defaut: true,
      },
      {
        cle: 'cancelRewardCost',
        type: 'nombre',
        label: 'Coût du refus',
        defaut: 1000,
        min: 1,
        max: 1000000,
      },

      // --- Commandes de chat ---
      {
        cle: 'skipCommand',
        type: 'commande',
        label: 'Commande « passer le morceau »',
        aide: 'Laisse vide pour désactiver.',
        defaut: '!skipsong',
      },
      {
        cle: 'songCommand',
        type: 'commande',
        label: 'Commande « quel est ce morceau »',
        aide: 'Laisse vide pour désactiver.',
        defaut: '',
      },
      {
        cle: 'modsCanSkip',
        type: 'bool',
        label: 'Les modérateurs peuvent passer un morceau',
        defaut: true,
      },
      {
        cle: 'announceInChat',
        type: 'bool',
        label: 'Annoncer dans le chat',
        aide: 'Les réponses aux commandes explicites sont toujours envoyées, même si tu coupes ça.',
        defaut: true,
      },

      // --- Habillage ---
      {
        cle: 'accent1',
        type: 'couleur',
        label: 'Couleur principale',
        aide: 'Barre des annonces et égaliseur.',
        defaut: '#1db954',
      },
      {
        cle: 'accent2',
        type: 'couleur',
        label: 'Couleur secondaire',
        aide: 'Pseudo du viewer, numéros de la liste.',
        defaut: '#9146ff',
      },
      {
        cle: 'corner',
        type: 'choix',
        label: 'Coin de l’écran',
        aide: 'Chaque source OBS peut aussi forcer le sien avec ?corner=bottom-left.',
        defaut: 'top-left',
        options: [
          { valeur: 'top-left', label: 'En haut à gauche' },
          { valeur: 'top-right', label: 'En haut à droite' },
          { valeur: 'bottom-left', label: 'En bas à gauche' },
          { valeur: 'bottom-right', label: 'En bas à droite' },
        ],
      },
    ],
  },

  compteurs: {
    demandes: 'Musiques demandées',
    introuvables: 'Introuvables sur Spotify',
    refusees: 'Refusées par un viewer',
    passees: 'Morceaux passés',
  },

  migrations: {
    // v3 : l'ID et le secret Spotify sont partis dans l'ecran Connecteurs.
    3: (r) => {
      delete r.spotifyClientId;
      delete r.spotifyClientSecret;
      return r;
    },

    // v2 : la commande de clip est partie dans son propre module « Clips ».
    // On retire ses réglages d'ici — ils n'ont plus d'effet, et les laisser
    // traîner ferait croire que la commande marche encore depuis ce module.
    2: (r) => {
      delete r.clipCommand;
      delete r.modsCanClip;
      delete r.clipCooldownSec;
      return r;
    },
  },

  overlays: [
    {
      chemin: 'annonces',
      nom: 'Annonces',
      description: 'Les notifications de 7 secondes : demande et refus.',
      fichier: 'overlay.html',
    },
    {
      chemin: 'liste',
      nom: 'Liste « à venir »',
      description: 'Le panneau permanent des morceaux en attente.',
      fichier: 'overlay.html',
    },
  ],

  // --- Autorisation Spotify -------------------------------------------------

  // Ce que ce module apporte a la vue d'ensemble. L'existence de la connexion
  // Spotify est deja rapportee par le socle (ecran Connecteurs) : ici on parle
  // de ce que lui seul sait, l'appareil de lecture actif.
  async sante(ctx) {
    if (!ctx.connecteur('spotify').connecte) {
      return [
        {
          id: 'spotify',
          nom: 'Spotify',
          etat: 'inactif',
          detail: 'non connecté',
          aide: 'Branche Spotify depuis l’écran Connecteurs.',
        },
      ];
    }

    try {
      // Un appareil actif est la condition pour qu'une musique parte en file :
      // sans lui, chaque demande serait remboursée.
      const appareil = await ctx._spotify?.getActiveDevice();
      return [
        {
          id: 'spotify',
          nom: 'Spotify',
          etat: appareil ? 'ok' : 'attention',
          detail: appareil ? appareil.name : 'aucun appareil actif',
          aide: appareil ? '' : 'Ouvre Spotify et lance une musique, sinon les demandes seront remboursées.',
        },
      ];
    } catch (e) {
      return [
        {
          id: 'spotify',
          nom: 'Spotify',
          etat: 'ko',
          detail: 'injoignable',
          aide: e?.message || String(e),
        },
      ];
    }
  },

  // --- Cycle de vie ---------------------------------------------------------

  async demarrer(ctx) {
    const c = ctx.config;

    // Le socle garantit que le connecteur est branché avant de démarrer le
    // module (voir registre.demarrer), mais on ne s'appuie pas là-dessus en
    // aveugle : une erreur claire vaut mieux qu'un plantage plus loin.
    const spotifyConn = ctx.connecteur('spotify');
    if (!spotifyConn.connecte) {
      throw new Error('Spotify n’est pas branché. Va dans l’écran Connecteurs.');
    }

    const spotify = new SpotifyClient({
      clientId: spotifyConn.clientId,
      clientSecret: spotifyConn.clientSecret,
      refreshToken: spotifyConn.refreshToken,
    });

    ctx._spotify = spotify; // lu par sante() pour la vue d ensemble

    const file = creerFile();

    // Spotify peut faire tourner le jeton de rafraîchissement. Il appartient au
    // connecteur, pas au module : on le repersiste là où le socle le lira.
    const persisterSpotify = () => {
      if (spotify.refreshToken && spotify.refreshToken !== spotifyConn.refreshToken) {
        ctx.connecteur('spotify').majJeton?.(spotify.refreshToken);
      }
    };

    // --- Overlays : deux vues, le meme etat ---
    const diffuser = (type, data) => VUES.forEach((v) => ctx.overlay.diffuser(v, type, data));
    const theme = { accent1: c.accent1, accent2: c.accent2, corner: c.corner };
    const pousserEtat = () =>
      VUES.forEach((v) =>
        ctx.overlay.etat(v, { theme, nowPlaying: file.enCours(), upcoming: file.aVenir() })
      );
    pousserEtat();

    // Annonce dans le chat, seulement si le streamer l'a laissee active.
    const annoncer = (msg) => {
      if (c.announceInChat !== false) ctx.twitch.dire(msg);
    };
    // --- Recompenses ---------------------------------------------------------

    const principale = await ctx.twitch.assurerRecompense({
      titre: c.rewardTitle,
      cout: c.rewardCost,
      prompt: 'Écris le titre + l’artiste (ex : Beautiful Things - Benson Boone).',
      saisieRequise: true,
      couleur: c.accent1,
    });

    let annulation = null;
    if (c.annulationActive) {
      annulation = await ctx.twitch.assurerRecompense({
        titre: TITRE_ANNULATION,
        cout: c.cancelRewardCost,
        prompt:
          'Écris le titre de la musique à refuser (ex : Beautiful Things - Benson Boone). ' +
          'Elle sera retirée de la file et ne passera pas. Si rien ne correspond, tes points sont remboursés.',
        saisieRequise: true,
        couleur: '#ff4d5e',
      });
    }

    // --- 1) Demande de musique ----------------------------------------------

    ctx.twitch.surRecompense(principale.id, async (e) => {
      const saisie = (e.input || '').trim();
      ctx.log.info('Demande de ' + e.userDisplayName + ' : « ' + saisie + ' »');

      if (!saisie) {
        await ctx.twitch.statutRedemption(e, 'CANCELED');
        annoncer('@' + e.userDisplayName + ' il faut indiquer un titre + un artiste 🙂 (points remboursés)');
        return;
      }

      try {
        const morceau = await spotify.searchTrack(saisie);
        if (!morceau) {
          await ctx.twitch.statutRedemption(e, 'CANCELED');
          ctx.compteur.incr('introuvables');
          annoncer('@' + e.userDisplayName + ' morceau introuvable sur Spotify ❌ (points remboursés)');
          return;
        }

        await spotify.addToQueue(morceau.uri);
        persisterSpotify();
        await ctx.twitch.statutRedemption(e, 'FULFILLED');

        const item = file.ajouter({ ...morceau, requester: e.userDisplayName });
        file.elaguer();
        diffuser('added', { requester: item.requester, name: item.name, artists: item.artists });
        pousserEtat();

        ctx.compteur.incr('demandes');
        ctx.log.ok('Ajouté à la file : ' + morceau.name + ' — ' + morceau.artists);
        annoncer(
          '@' + e.userDisplayName + ' 🎶 « ' + morceau.name + ' — ' + morceau.artists + ' » ajouté à la file !'
        );
      } catch (err) {
        if (err.reason === 'NO_ACTIVE_DEVICE' || err.message === 'NO_ACTIVE_DEVICE') {
          ctx.log.warn('Aucun appareil Spotify actif.');
          await ctx.twitch.statutRedemption(e, 'CANCELED');
          annoncer(
            '@' + e.userDisplayName + " Spotify n'est pas actif (points remboursés). " +
              ctx.twitch.channel + ' → ouvre Spotify et lance une musique 🙏'
          );
        } else {
          ctx.log.err('Erreur : ' + err.message);
          await ctx.twitch.statutRedemption(e, 'CANCELED');
          annoncer('@' + e.userDisplayName + ' petit souci technique, points remboursés 🙏');
        }
      }
    });

    // --- 2) Annulation d'une musique -----------------------------------------

    if (annulation) {
      ctx.twitch.surRecompense(annulation.id, async (e) => {
        const saisie = (e.input || '').trim();
        ctx.log.info('Annulation demandée par ' + e.userDisplayName + ' : « ' + saisie + ' »');

        const cible = file.trouverAAnnuler(saisie, looseMatch);
        if (!cible) {
          await ctx.twitch.statutRedemption(e, 'CANCELED');
          annoncer(
            '@' + e.userDisplayName + ' aucune musique en attente ne correspond à « ' + saisie + ' » ❌ (points remboursés)'
          );
          return;
        }

        file.annuler(cible);
        await ctx.twitch.statutRedemption(e, 'FULFILLED');
        diffuser('cancelled', { requester: e.userDisplayName, name: cible.name, artists: cible.artists });
        pousserEtat();
        ctx.compteur.incr('refusees');
        ctx.log.ok('Annulé : ' + cible.name + ' — ' + cible.artists + ' (sera sauté à son passage)');
        annoncer('@' + e.userDisplayName + ' 🚫 « ' + cible.name + ' — ' + cible.artists + ' » ne passera pas.');

        // Si le morceau annule joue deja, on le passe tout de suite.
        try {
          const cur = await spotify.currentlyPlaying();
          if (cur && cur.uri === cible.uri) {
            await spotify.next();
            file.retirer(cible.uri);
            pousserEtat();
            ctx.log.info('Le morceau annulé était en cours : passé immédiatement.');
          }
        } catch {
          /* le suivi de lecture s'en chargera */
        }
      });
    }

    // --- 3) Suivi de lecture : passe automatiquement les morceaux annules -----

    ctx.minuteur.intervalle(async () => {
      try {
        const cur = await spotify.currentlyPlaying();
        if (!cur) return;

        if (file.estAnnule(cur.uri)) {
          await spotify.next();
          file.retirer(cur.uri);
          ctx.log.info('Morceau annulé détecté en lecture : passé.');
          pousserEtat();
          return;
        }

        if (file.marquerEnLecture(cur.uri)) pousserEtat();
      } catch {
        /* Spotify momentanement indisponible : on reessaiera au prochain tour */
      }
    }, 5000);

    // --- 4) Commandes de chat -------------------------------------------------

    if (c.skipCommand) {
      ctx.twitch.surCommande(
        c.skipCommand,
        async ({ user }) => {
          try {
            await spotify.next();
            persisterSpotify();
            annoncer('⏭️ Morceau suivant !');
            ctx.compteur.incr('passees');
            ctx.log.info(user + ' a passé le morceau');
          } catch (err) {
            ctx.log.err('Impossible de passer le morceau : ' + err.message);
          }
        },
        { qui: c.modsCanSkip ? 'mods' : 'streamer' }
      );
    }

    if (c.songCommand) {
      ctx.twitch.surCommande(c.songCommand, async () => {
        try {
          const cur = await spotify.currentlyPlaying();
          annoncer(cur ? '🎧 En cours : ' + cur.name + ' — ' + cur.artists : 'Rien en lecture pour le moment.');
        } catch (err) {
          ctx.log.err('Lecture en cours indisponible : ' + err.message);
        }
      });
    }

    // --- Demarrage termine ----------------------------------------------------

    ctx.log.ok('Prêt. Récompense surveillée : « ' + c.rewardTitle + ' ».');
    spotify
      .getActiveDevice()
      .then((d) => {
        if (!d) ctx.log.warn('Aucun appareil Spotify actif. Ouvre Spotify et lance une musique.');
        else ctx.log.info('Appareil Spotify actif : ' + d.name);
      })
      .catch(() => {});

    // Rien à libérer : les abonnements Twitch et les minuteurs sont retirés
    // automatiquement par le socle quand le module s'arrête.
    return {};
  },
};
