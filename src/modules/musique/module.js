// Bot Musique — portage du projet Bot-Musique-Twitch-V2 dans StreamKit.
//
// Ce que fait le module :
//  - recompense de points de chaine « demande de musique » -> ajout a la file Spotify
//  - recompense « annuler une musique » -> le morceau sera saute a son passage
//    (Spotify ne permet pas de retirer un morceau precis de sa file)
//  - commandes de chat : passer le morceau, afficher le morceau en cours
//  - deux overlays OBS : les annonces (7 s) et la liste « a venir » (permanente),
//    que le reglage « Afficher le morceau en cours » coiffe de la pochette et du
//    titre qui tournent sur Spotify
//
// Ce qui a disparu par rapport a la version autonome, et que le socle fournit :
// la connexion Twitch, le serveur d'overlay, le rafraichissement des jetons, le
// journal, la persistance et l'ecran de reglages.

import { SpotifyClient, looseMatch } from './spotify.js';
import { creerFile } from './file.js';
import { etatLecture, lectureAChange, msAvantFin } from './lecture.js';

const TITRE_ANNULATION = '🚫 On écoute pas ta musique de merde';
const VUES = ['annonces', 'liste'];

// Rythme du suivi de lecture : c'est aussi le retard maximal avec lequel un
// morceau annule est saute, et avec lequel l'overlay voit un changement.
const INTERVALLE_SUIVI = 5000;

const points = (n) => Number(n).toLocaleString('fr-FR') + (Math.abs(n) > 1 ? ' points' : ' point');

// La ligne « Bot Musique » de la vue d'ensemble : le nom et le cout que porte
// VRAIMENT la recompense sur Twitch, pas ceux des reglages. Le module aligne
// Twitch sur ses reglages a chaque demarrage ; cette ligne est l'endroit ou le
// streamer verifie que c'est bien parti, sans ouvrir son tableau de bord Twitch
// (Random Car le fait deja dans sa carte Rocket League).
//
// Rien tant que le module n'a pas demarre : ses recompenses ne sont connues
// qu'a ce moment-la.
function carteRecompenses(ctx) {
  const r = ctx._etatMusique?.();
  if (!r) return [];
  return [
    {
      id: 'musique',
      nom: 'Bot Musique',
      etat: 'ok',
      detail:
        '« ' + r.titre + ' » à ' + points(r.cout) + (r.refus ? ' · refus à ' + points(r.refus.cout) : ''),
      aide: r.refus
        ? 'Récompense de refus : « ' + r.refus.titre + ' ».'
        : 'Le refus d’une musique est désactivé dans les réglages.',
    },
  ];
}

async function carteSpotify(ctx) {
  if (!ctx.connecteur('spotify').connecte) {
    return {
      id: 'spotify',
      nom: 'Spotify',
      etat: 'inactif',
      detail: 'non connecté',
      aide: 'Branche Spotify depuis l’écran Connecteurs.',
    };
  }

  try {
    // Un appareil actif est la condition pour qu'une musique parte en file :
    // sans lui, chaque demande serait remboursée.
    const appareil = await ctx._spotify?.getActiveDevice();
    return {
      id: 'spotify',
      nom: 'Spotify',
      etat: appareil ? 'ok' : 'attention',
      detail: appareil ? appareil.name : 'aucun appareil actif',
      aide: appareil ? '' : 'Ouvre Spotify et lance une musique, sinon les demandes seront remboursées.',
    };
  } catch (e) {
    return {
      id: 'spotify',
      nom: 'Spotify',
      etat: 'ko',
      detail: 'injoignable',
      aide: e?.message || String(e),
    };
  }
}

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

  scopes: ['channel:read:redemptions', 'channel:manage:redemptions', 'chat:read', 'chat:edit'],

  config: {
    version: 3,
    champs: [
      // --- Recompense principale ---
      {
        cle: 'rewardTitle',
        type: 'texte',
        label: 'Nom de la récompense « demande de musique »',
        aide: 'StreamKit crée la récompense sur ta chaîne et la tient à jour : change son nom et son coût ici, pas sur Twitch.',
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
        cle: 'afficherEnCours',
        type: 'bool',
        label: 'Afficher le morceau en cours',
        aide: 'Pochette, titre et avancement du morceau Spotify, en tête de la liste « À venir ». Tout le bloc disparaît quand la musique est en pause, et revient à la reprise.',
        // Coupe par defaut : une mise a jour ne doit pas changer l'ecran d'un
        // streamer qui a deja cale sa source OBS.
        defaut: false,
      },
      {
        cle: 'tailleBloc',
        type: 'choix',
        label: 'Taille du bloc',
        aide: 'Compacte : petite pochette, 3 demandes affichées au plus. Normale : grande pochette, temps écoulé et vignettes. Sert seulement si le morceau en cours est affiché.',
        // Compacte par defaut : la normale a ete jugee trop envahissante a
        // l'ecran, et le bloc etait sorti depuis quelques heures seulement.
        defaut: 'compacte',
        options: [
          { valeur: 'compacte', label: 'Compacte' },
          { valeur: 'normale', label: 'Normale' },
        ],
      },
      {
        cle: 'opaciteFond',
        type: 'nombre',
        label: 'Opacité du fond (%)',
        aide: '100 : fond sombre plein. 0 : plus de fond, seuls les textes et les pochettes restent. Vaut pour les annonces et la liste.',
        // 92 : le fond d'origine des overlays musique, au pourcent pres.
        defaut: 92,
        min: 0,
        max: 100,
      },
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
      description: 'Le panneau permanent des morceaux en attente, et le morceau en cours si tu l’affiches.',
      fichier: 'overlay.html',
    },
  ],

  // --- Autorisation Spotify -------------------------------------------------

  // Ce que ce module apporte a la vue d'ensemble : ses recompenses telles que
  // Twitch les porte, et l'appareil de lecture actif. L'existence de la
  // connexion Spotify, elle, est deja rapportee par le socle (ecran
  // Connecteurs) ; la carte « Spotify » ci-dessous prend sa place.
  async sante(ctx) {
    return [...carteRecompenses(ctx), await carteSpotify(ctx)];
  },

  // --- Cycle de vie ---------------------------------------------------------

  // Rapport de bug : les recompenses telles que Twitch les porte, l'appareil
  // Spotify (sans lui, chaque demande est remboursee) et la file.
  async diagnostic(ctx) {
    let appareil = 'module arrêté';
    if (ctx._spotify) {
      try {
        const a = await ctx._spotify.getActiveDevice();
        appareil = a
          ? a.name + ' (' + a.type + ', volume ' + a.volume_percent + ' %)'
          : 'aucun appareil actif';
      } catch (e) {
        appareil = 'Spotify injoignable : ' + (e?.message || e);
      }
    }
    return { enMarche: ctx._etatMusique?.() ?? 'module arrêté', appareilSpotify: appareil };
  },

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
    const theme = {
      accent1: c.accent1,
      accent2: c.accent2,
      corner: c.corner,
      taille: c.tailleBloc,
      opacite: c.opaciteFond,
    };

    // Le morceau que l'overlay affiche en tete du bloc. null : rien ne joue, et
    // l'overlay masque alors tout le bloc ; la file continue d'etre envoyee,
    // pour qu'il revienne complet a la reprise. Reste null tant que le reglage
    // est coupe : l'overlay garde alors exactement la liste d'avant.
    let lecture = null;

    const pousserEtat = () =>
      VUES.forEach((v) =>
        ctx.overlay.etat(v, {
          theme,
          afficherEnCours: !!c.afficherEnCours,
          lecture,
          upcoming: file.aVenir(),
        })
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
        cle: 'annulation',
        titre: TITRE_ANNULATION,
        cout: c.cancelRewardCost,
        prompt:
          'Écris le titre de la musique à refuser (ex : Beautiful Things - Benson Boone). ' +
          'Elle sera retirée de la file et ne passera pas. Si rien ne correspond, tes points sont remboursés.',
        saisieRequise: true,
        couleur: '#ff4d5e',
      });
    }

    // Lu par sante() : ce que Twitch porte apres l'alignement, pas les reglages.
    ctx._etatMusique = () => ({
      id: principale.id,
      enFile: file.aVenir().length,
      titre: principale.titre,
      cout: principale.cout,
      refus: annulation && { titre: annulation.titre, cout: annulation.cout },
    });

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
          '@' +
            e.userDisplayName +
            ' 🎶 « ' +
            morceau.name +
            ' — ' +
            morceau.artists +
            ' » ajouté à la file !'
        );
      } catch (err) {
        if (err.reason === 'NO_ACTIVE_DEVICE' || err.message === 'NO_ACTIVE_DEVICE') {
          ctx.log.warn('Aucun appareil Spotify actif.');
          await ctx.twitch.statutRedemption(e, 'CANCELED');
          annoncer(
            '@' +
              e.userDisplayName +
              " Spotify n'est pas actif (points remboursés). " +
              ctx.twitch.channel +
              ' → ouvre Spotify et lance une musique 🙏'
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
            '@' +
              e.userDisplayName +
              ' aucune musique en attente ne correspond à « ' +
              saisie +
              ' » ❌ (points remboursés)'
          );
          return;
        }

        file.annuler(cible);
        await ctx.twitch.statutRedemption(e, 'FULFILLED');
        diffuser('cancelled', { requester: e.userDisplayName, name: cible.name, artists: cible.artists });
        pousserEtat();
        ctx.compteur.incr('refusees');
        ctx.log.ok('Annulé : ' + cible.name + ' — ' + cible.artists + ' (sera sauté à son passage)');
        annoncer(
          '@' + e.userDisplayName + ' 🚫 « ' + cible.name + ' — ' + cible.artists + ' » ne passera pas.'
        );

        // Si le morceau annule joue deja, on le passe tout de suite.
        try {
          const cur = await spotify.currentlyPlaying();
          if (cur && cur.uri === cible.uri) {
            await spotify.next();
            file.retirer(cible.uri);
            pousserEtat();
            rafraichirBientot();
            ctx.log.info('Le morceau annulé était en cours : passé immédiatement.');
          }
        } catch {
          /* le suivi de lecture s'en chargera */
        }
      });
    }

    // --- 3) Suivi de lecture ---------------------------------------------------
    // Passe automatiquement les morceaux annules, et tient a jour le morceau en
    // cours de l'overlay quand le streamer l'affiche.

    // Un seul releve a la fois. Le socle n'empile pas les tours de l'intervalle,
    // mais les releves anticipes (fin de morceau, morceau passe) arrivent par un
    // autre chemin : sans ce verrou, deux releves simultanes verraient le meme
    // morceau annule et appelleraient « suivant » deux fois -- le second
    // sauterait le morceau d'un autre viewer.
    let suiviEnCours = false;
    // Morceau dont la fin a deja son releve anticipe.
    let finSurveillee = null;

    async function suivre() {
      if (suiviEnCours) return;
      suiviEnCours = true;
      try {
        const cur = await spotify.currentlyPlaying();

        if (cur && file.estAnnule(cur.uri)) {
          await spotify.next();
          file.retirer(cur.uri);
          ctx.log.info('Morceau annulé détecté en lecture : passé.');
          pousserEtat();
          rafraichirBientot();
          return;
        }

        let change = cur ? file.marquerEnLecture(cur.uri) : false;

        if (c.afficherEnCours) {
          const releve = etatLecture(cur, file.enCours());
          if (lectureAChange(lecture, releve)) {
            lecture = releve;
            change = true;
          }
          programmerFin(lecture);
        }

        if (change) pousserEtat();
      } catch {
        /* Spotify momentanement indisponible : on reessaiera au prochain tour */
      } finally {
        suiviEnCours = false;
      }
    }

    // Sans releve anticipe, l'overlay garderait jusqu'a 5 s le titre d'un
    // morceau fini, barre pleine, pendant que le suivant joue deja.
    function programmerFin(l) {
      if (!l || finSurveillee === l.uri) return;
      const reste = msAvantFin(l);
      if (reste > INTERVALLE_SUIVI) return; // le tour normal arrivera avant
      finSurveillee = l.uri;
      ctx.minuteur.delai(suivre, reste + 800);
    }

    // Apres un « suivant » : l'overlay montre le nouveau morceau sans attendre
    // le prochain tour.
    function rafraichirBientot() {
      if (c.afficherEnCours) ctx.minuteur.delai(suivre, 1200);
    }

    ctx.minuteur.intervalle(suivre, INTERVALLE_SUIVI);
    // Premier releve tout de suite : apres un changement de reglages, le module
    // redemarre, et l'overlay resterait sinon 5 s sans son morceau en cours.
    if (c.afficherEnCours) ctx.minuteur.delai(suivre, 0);

    // --- 4) Commandes de chat -------------------------------------------------

    if (c.skipCommand) {
      ctx.twitch.surCommande(
        c.skipCommand,
        async ({ user }) => {
          try {
            await spotify.next();
            persisterSpotify();
            rafraichirBientot();
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
          annoncer(
            cur ? '🎧 En cours : ' + cur.name + ' — ' + cur.artists : 'Rien en lecture pour le moment.'
          );
        } catch (err) {
          ctx.log.err('Lecture en cours indisponible : ' + err.message);
        }
      });
    }

    // --- Demarrage termine ----------------------------------------------------

    // Le titre et le cout viennent de Twitch : le journal dit ce que les
    // viewers voient vraiment, pas ce que le module a demande.
    ctx.log.ok(
      'Prêt. Récompense surveillée : « ' + principale.titre + ' » à ' + points(principale.cout) + '.'
    );
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
