// Bot Musique — portage du projet Bot-Musique-Twitch-V2 dans StreamKit.
//
// Ce que fait le module :
//  - recompense de points de chaine « demande de musique » -> ajout a la file Spotify
//  - recompense « annuler une musique » -> le morceau sera saute a son passage
//    (Spotify ne permet pas de retirer un morceau precis de sa file)
//  - commandes de chat : passer le morceau, afficher le morceau en cours, !clip
//  - deux overlays OBS : les annonces (7 s) et la liste « a venir » (permanente)
//
// Ce qui a disparu par rapport a la version autonome, et que le socle fournit :
// la connexion Twitch, le serveur d'overlay, le rafraichissement des jetons, le
// journal, la persistance et l'ecran de reglages.

import { SpotifyClient, looseMatch } from './spotify.js';
import { creerFile } from './file.js';
import { creerClipper } from './clips.js';
import * as spotifyAuth from './spotify-auth.js';

const TITRE_ANNULATION = '🚫 On écoute pas ta musique de merde';
const VUES = ['annonces', 'liste'];

export default {
  id: 'musique',
  nom: 'Bot Musique',
  description:
    'Les viewers demandent une musique avec leurs points de chaîne, elle part dans ta file Spotify. Avec refus, passage et clips.',
  icone: '🎵',
  categorie: 'twitch',

  scopes: [
    'channel:read:redemptions',
    'channel:manage:redemptions',
    'chat:read',
    'chat:edit',
    'clips:edit', // commande !clip
    // Nommer un clip = basculer le titre du stream une fraction de seconde
    // (l'API Twitch ne permet pas de nommer un clip autrement).
    'channel:manage:broadcast',
  ],

  config: {
    version: 1,
    champs: [
      // --- Spotify ---
      {
        cle: 'spotifyClientId',
        type: 'texte',
        label: 'ID client Spotify',
        aide: "Depuis ton tableau de bord développeur Spotify. Le bouton « Connecter Spotify » plus bas t'explique la marche à suivre.",
        requis: true,
      },
      {
        cle: 'spotifyClientSecret',
        type: 'secret',
        label: 'Secret client Spotify',
        aide: 'Reste sur ce PC, dans un fichier que tu ne partages jamais.',
        requis: true,
      },

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

      // --- Clips ---
      {
        cle: 'clipCommand',
        type: 'commande',
        label: 'Commande de clip',
        aide: '« !clip pentakill » nomme le clip. Laisse vide pour désactiver.',
        defaut: '!clip',
      },
      {
        cle: 'modsCanClip',
        type: 'bool',
        label: 'Les modérateurs peuvent clipper',
        defaut: true,
      },
      {
        cle: 'clipCooldownSec',
        type: 'nombre',
        label: 'Délai entre deux clips (secondes)',
        defaut: 30,
        min: 0,
        max: 3600,
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

  migrations: {},

  overlays: [
    {
      chemin: 'annonces',
      nom: 'Annonces',
      description: 'Les notifications de 7 secondes : demande, refus, clip.',
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

  libellesActions: {
    connecterSpotify: 'Connecter Spotify',
    adresseDeRetour: 'Voir l’adresse de retour Spotify',
  },

  actions: {
    // Bouton « Connecter Spotify » dans le dashboard.
    async connecterSpotify(ctx) {
      const { spotifyClientId, spotifyClientSecret } = ctx.config;
      if (!spotifyClientId || !spotifyClientSecret) {
        return { ok: false, erreur: 'Renseigne d’abord l’ID et le secret client Spotify, puis enregistre.' };
      }

      const url = spotifyAuth.construireUrl({
        clientId: spotifyClientId,
        clientSecret: spotifyClientSecret,
        urlDeRetour: ctx.oauth.urlDeRetour(),
      });

      ctx.oauth.ouvrir(url);
      ctx.log.info('Page d’autorisation Spotify ouverte.');
      return { message: 'Autorise StreamKit dans la page Spotify qui vient de s’ouvrir.', url };
    },

    // Affiche l'adresse a coller dans l'application Spotify du streamer.
    async adresseDeRetour(ctx) {
      return { message: ctx.oauth.urlDeRetour(), url: ctx.oauth.urlDeRetour() };
    },
  },

  async callbackOAuth(ctx, url) {
    const r = await spotifyAuth.traiterRetour(url);
    if (r.ok) {
      ctx.secrets.ecrire('spotifyRefreshToken', r.refreshToken);
      ctx.log.ok('Spotify connecté.');
    } else {
      ctx.log.err('Spotify : ' + r.message);
    }
    return r;
  },

  // --- Cycle de vie ---------------------------------------------------------

  async demarrer(ctx) {
    const c = ctx.config;

    const refreshToken = ctx.secrets.lire('spotifyRefreshToken');
    if (!refreshToken) {
      throw new Error(
        'Spotify n’est pas encore connecté. Renseigne l’ID et le secret client, puis clique sur « Connecter Spotify ».'
      );
    }

    const spotify = new SpotifyClient({
      clientId: c.spotifyClientId,
      clientSecret: c.spotifyClientSecret,
      refreshToken,
    });

    const file = creerFile();
    const clipper = creerClipper({
      api: ctx.twitch.api,
      broadcasterId: ctx.twitch.broadcasterId,
      log: ctx.log,
    });

    // Spotify peut faire tourner le refresh token : on le repersiste s'il change.
    const persisterSpotify = () => {
      if (spotify.refreshToken && spotify.refreshToken !== refreshToken) {
        ctx.secrets.ecrire('spotifyRefreshToken', spotify.refreshToken);
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
    // Reponse a une commande explicite : on ecrit meme si les annonces
    // automatiques sont coupees (sinon !clip ne renverrait aucun lien).
    const repondre = (msg) => ctx.twitch.dire(msg);

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

    // --- 5) Clips -------------------------------------------------------------

    if (c.clipCommand) {
      const peutClipper = ctx.twitch.aLeDroit('clips:edit');
      const peutNommer = ctx.twitch.aLeDroit('channel:manage:broadcast');
      const delaiMs = Math.max(0, c.clipCooldownSec * 1000);
      let dernierClip = 0;
      let clipEnCours = false;

      if (!peutClipper) {
        ctx.log.warn(
          'Commande ' + c.clipCommand + ' indisponible : ton autorisation Twitch ne couvre pas la création de clips. ' +
            'Reconnecte ta chaîne depuis le dashboard.'
        );
      } else if (!peutNommer) {
        ctx.log.warn('« ' + c.clipCommand + ' <nom> » ne pourra pas nommer le clip : droit manquant.');
      }

      ctx.twitch.surCommande(
        c.clipCommand,
        async ({ user, argument }) => {
          if (!peutClipper) {
            repondre('@' + user + ' le bot n’a pas le droit de créer des clips — reconnecte la chaîne dans StreamKit 🔑');
            return;
          }
          if (clipEnCours) return;

          const restant = delaiMs - (Date.now() - dernierClip);
          if (restant > 0) {
            repondre('@' + user + ' encore ' + Math.ceil(restant / 1000) + ' s avant le prochain clip ⏳');
            return;
          }

          clipEnCours = true;
          try {
            const clip = await clipper.creer({ nom: peutNommer ? argument : '' });
            dernierClip = Date.now();
            diffuser('clip', { by: user, url: clip.url, title: clip.title });

            const nom = clip.renamed ? ' « ' + clip.title + ' »' : '';
            let souci = '';
            if (argument && peutNommer && !clip.renamed) souci = ' (nom non appliqué cette fois)';

            repondre('✂️ Clip' + nom + ' créé par @' + user + ' : ' + clip.url + souci);
            ctx.log.ok('Clip créé par ' + user + nom + ' : ' + clip.url);
          } catch (err) {
            if (err.reason === 'OFFLINE') {
              repondre('@' + user + ' impossible de clipper : la chaîne n’est pas en live ❌');
            } else if (err.reason === 'RATE_LIMIT') {
              repondre('@' + user + ' trop de clips d’un coup, laisse souffler Twitch ⏳');
            } else if (err.reason === 'NO_SCOPE') {
              repondre('@' + user + ' le bot n’a pas le droit de créer des clips — reconnecte la chaîne 🔑');
              ctx.log.warn('Droit « clips:edit » manquant.');
            } else {
              repondre('@' + user + ' le clip n’a pas pu être créé 🙏');
              ctx.log.err('Clip : ' + err.message);
            }
          } finally {
            clipEnCours = false;
          }
        },
        { qui: c.modsCanClip ? 'mods' : 'streamer' }
      );
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

    return {
      async arreter() {
        // Si un clip etait en train d'etre nomme, on rend son vrai titre au stream.
        await clipper.restaurerTitre();
      },
    };
  },
};
