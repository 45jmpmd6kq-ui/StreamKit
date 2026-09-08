// Clips — commande de chat qui enregistre les 30 dernières secondes du live.
//
// Extrait du bot musique, où il n'avait rien à faire : il s'y trouvait
// seulement parce que c'était le seul bot qui tournait à l'époque.
//
// Ce qu'il faut savoir sur le NOMMAGE, parce que ce n'est pas évident :
// l'API Twitch n'offre AUCUN moyen de nommer un clip. POST /helix/clips ne
// prend que l'identifiant de la chaîne, et aucun endpoint ne permet de le
// renommer ensuite. Un clip hérite du TITRE DU STREAM au moment de la capture.
// StreamKit bascule donc le titre de la chaîne juste avant, et le remet dès que
// Twitch a accepté le clip — moins d'une seconde de bascule.

import { creerClipper } from './clips.js';

export default {
  id: 'clips',
  nom: 'Clips',
  description:
    'Une commande de chat enregistre les 30 dernières secondes du live. Ce qui suit la commande devient le titre du clip.',
  icone: '✂️',
  categorie: 'twitch',

  scopes: [
    'chat:read',
    'chat:edit',
    'clips:edit',
    // Nommer un clip = basculer le titre du stream une fraction de seconde.
    // Sans ce droit la commande marche quand même, mais les clips gardent le
    // titre courant du stream.
    'channel:manage:broadcast',
  ],

  config: {
    version: 1,
    champs: [
      {
        cle: 'commande',
        type: 'commande',
        label: 'Commande de chat',
        aide: 'Laisse vide pour désactiver le module sans le décocher.',
        defaut: '!clip',
        requis: true,
      },
      {
        cle: 'nommage',
        type: 'bool',
        label: 'Ce qui suit la commande devient le titre du clip',
        aide:
          '« !clip pentakill » crée un clip intitulé « pentakill ». Sans texte, le clip garde le titre du stream. ' +
          'Twitch ne sait pas nommer un clip autrement : StreamKit bascule le titre de la chaîne moins d’une seconde, puis le remet.',
        defaut: true,
      },
      {
        cle: 'qui',
        type: 'choix',
        label: 'Qui peut clipper',
        aide: 'Ouvrir à tous les viewers expose au spam : le délai ci-dessous devient alors important.',
        defaut: 'mods',
        options: [
          { valeur: 'streamer', label: 'Toi seulement' },
          { valeur: 'mods', label: 'Toi et tes modérateurs' },
          { valeur: 'tous', label: 'Tout le chat' },
        ],
      },
      {
        cle: 'delaiSec',
        type: 'nombre',
        label: 'Délai entre deux clips (secondes)',
        defaut: 30,
        min: 0,
        max: 3600,
      },
      {
        cle: 'annoncerLien',
        type: 'bool',
        label: 'Envoyer le lien du clip dans le chat',
        defaut: true,
      },

      // --- Overlay ---
      {
        cle: 'overlayActif',
        type: 'bool',
        label: 'Annoncer le clip dans l’overlay OBS',
        aide: 'Une carte de 7 secondes à l’écran. Décoche si tu n’en veux pas.',
        defaut: true,
      },
      {
        cle: 'accent',
        type: 'couleur',
        label: 'Couleur de la carte',
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
    ],
  },

  // Compteurs remontes dans la vue d'ensemble.
  compteurs: {
    crees: 'Clips créés',
    refuses: 'Refusés (délai, hors live)',
  },

  migrations: {},

  overlays: [
    {
      chemin: 'annonce',
      nom: 'Annonce de clip',
      description: 'Carte de 7 secondes quand un clip est créé.',
      fichier: 'annonce.html',
    },
  ],

  async sante(ctx) {
    const peutClipper = ctx.twitch.aLeDroit('clips:edit');
    const peutNommer = ctx.twitch.aLeDroit('channel:manage:broadcast');

    if (!peutClipper) {
      return [
        {
          id: 'clips',
          nom: 'Clips Twitch',
          etat: 'ko',
          detail: 'droit de création manquant',
          aide: 'Reconnecte ta chaîne depuis l’indicateur Twitch : le droit « clips:edit » est nécessaire.',
        },
      ];
    }
    return [
      {
        id: 'clips',
        nom: 'Clips Twitch',
        etat: peutNommer ? 'ok' : 'attention',
        detail: peutNommer ? ctx.config.commande + ' — nommage actif' : ctx.config.commande + ' — sans nommage',
        aide: peutNommer ? '' : 'Reconnecte ta chaîne pour que « ' + ctx.config.commande + ' <nom> » puisse nommer le clip.',
      },
    ];
  },

  async demarrer(ctx) {
    const c = ctx.config;

    if (!c.commande) {
      ctx.log.warn('Aucune commande définie : le module ne fera rien.');
      return {};
    }

    const clipper = creerClipper({
      api: ctx.twitch.api,
      broadcasterId: ctx.twitch.broadcasterId,
      log: ctx.log,
    });

    const peutClipper = ctx.twitch.aLeDroit('clips:edit');
    const peutNommer = ctx.twitch.aLeDroit('channel:manage:broadcast');
    const delaiMs = Math.max(0, c.delaiSec * 1000);

    let dernierClip = 0;
    let enCours = false;

    if (!peutClipper) {
      ctx.log.warn(
        'Ton autorisation Twitch ne couvre pas la création de clips. ' +
          'Reconnecte ta chaîne depuis le dashboard.'
      );
    } else if (c.nommage && !peutNommer) {
      ctx.log.warn(
        '« ' + c.commande + ' <nom> » ne pourra pas nommer le clip : droit « channel:manage:broadcast » manquant.'
      );
    }

    const theme = { accent: c.accent, coin: c.coin };
    ctx.overlay.etat('annonce', { theme });

    ctx.twitch.surCommande(
      c.commande,
      async ({ user, argument }) => {
        if (!peutClipper) {
          ctx.twitch.dire('@' + user + ' le bot n’a pas le droit de créer des clips — reconnecte la chaîne dans StreamKit 🔑');
          return;
        }
        // Un clip est deja en cours de creation : deux appels simultanes
        // basculeraient le titre du stream l'un sur l'autre.
        if (enCours) return;

        const restant = delaiMs - (Date.now() - dernierClip);
        if (restant > 0) {
          ctx.twitch.dire('@' + user + ' encore ' + Math.ceil(restant / 1000) + ' s avant le prochain clip ⏳');
          ctx.compteur.incr('refuses');
          return;
        }

        enCours = true;
        try {
          const nommer = c.nommage && peutNommer;
          const clip = await clipper.creer({ nom: nommer ? argument : '' });
          dernierClip = Date.now();
          ctx.compteur.incr('crees');

          if (c.overlayActif) {
            ctx.overlay.diffuser('annonce', 'clip', {
              by: user,
              url: clip.url,
              title: clip.title,
              theme,
            });
          }

          const nom = clip.renamed ? ' « ' + clip.title + ' »' : '';
          let souci = '';
          if (argument && nommer && !clip.renamed) souci = ' (nom non appliqué cette fois)';

          if (c.annoncerLien) {
            ctx.twitch.dire('✂️ Clip' + nom + ' créé par @' + user + ' : ' + clip.url + souci);
          }
          ctx.log.ok('Clip créé par ' + user + nom + ' : ' + clip.url);
        } catch (err) {
          ctx.compteur.incr('refuses');
          if (err.reason === 'OFFLINE') {
            ctx.twitch.dire('@' + user + ' impossible de clipper : la chaîne n’est pas en live ❌');
          } else if (err.reason === 'RATE_LIMIT') {
            ctx.twitch.dire('@' + user + ' trop de clips d’un coup, laisse souffler Twitch ⏳');
          } else if (err.reason === 'NO_SCOPE') {
            ctx.twitch.dire('@' + user + ' le bot n’a pas le droit de créer des clips — reconnecte la chaîne 🔑');
            ctx.log.warn('Droit « clips:edit » manquant.');
          } else {
            ctx.twitch.dire('@' + user + ' le clip n’a pas pu être créé 🙏');
            ctx.log.err('Clip : ' + err.message);
          }
        } finally {
          enCours = false;
        }
      },
      { qui: c.qui }
    );

    const parQui =
      c.qui === 'tous' ? 'tout le chat' : c.qui === 'mods' ? 'toi et tes modérateurs' : 'toi seulement';
    ctx.log.ok('Prêt. ' + c.commande + ' — ' + parQui + '.');
    if (c.nommage && peutNommer) {
      ctx.log.info('« ' + c.commande + ' pentakill » créera un clip intitulé « pentakill ».');
    }

    return {
      async arreter() {
        // Si un clip etait en train d'etre nomme, on rend son vrai titre au stream.
        await clipper.restaurerTitre();
      },
    };
  },
};
