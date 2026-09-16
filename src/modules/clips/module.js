// Clips — commande de chat qui enregistre les 30 dernières secondes du live.
//
// Extrait du bot musique, où il n'avait rien à faire : il s'y trouvait
// seulement parce que c'était le seul bot qui tournait à l'époque.
//
// NOMMAGE : le titre part avec la demande de clip (Twitch l'accepte depuis
// décembre 2025). Le titre du stream n'est jamais touché — voir clips.js.

import { creerClipper } from './clips.js';

export default {
  id: 'clips',
  nom: 'Clips',
  description:
    'Une commande de chat enregistre les 30 dernières secondes du live. Ce qui suit la commande devient le titre du clip.',
  icone: '✂️',
  categorie: 'twitch',

  // Nommer un clip ne demande rien de plus que de le créer : plus besoin de
  // channel:manage:broadcast (qui servait à basculer le titre du stream).
  scopes: ['chat:read', 'chat:edit', 'clips:edit'],

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
        aide: '« !clip pentakill » crée un clip intitulé « pentakill ». Sans texte, le clip prend le titre du stream.',
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
        etat: 'ok',
        detail: ctx.config.commande + (ctx.config.nommage ? ' — nommage actif' : ' — sans nommage'),
        aide: '',
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
    const delaiMs = Math.max(0, c.delaiSec * 1000);

    let dernierClip = 0;
    let enCours = false;

    if (!peutClipper) {
      ctx.log.warn(
        'Ton autorisation Twitch ne couvre pas la création de clips. ' +
          'Reconnecte ta chaîne depuis le dashboard.'
      );
    }

    const theme = { accent: c.accent, coin: c.coin };
    ctx.overlay.etat('annonce', { theme });

    ctx.twitch.surCommande(
      c.commande,
      async ({ user, argument }) => {
        if (!peutClipper) {
          ctx.twitch.dire(
            '@' +
              user +
              ' le bot n’a pas le droit de créer des clips — reconnecte la chaîne dans StreamKit 🔑'
          );
          return;
        }
        // Un clip est deja en cours de creation : le second doublonnerait le
        // meme moment du live.
        if (enCours) return;

        const restant = delaiMs - (Date.now() - dernierClip);
        if (restant > 0) {
          ctx.twitch.dire(
            '@' + user + ' encore ' + Math.ceil(restant / 1000) + ' s avant le prochain clip ⏳'
          );
          ctx.compteur.incr('refuses');
          return;
        }

        enCours = true;
        try {
          const clip = await clipper.creer({ nom: c.nommage ? argument : '' });
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
          if (argument && c.nommage && !clip.renamed) souci = ' (nom non appliqué cette fois)';

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
            ctx.twitch.dire(
              '@' + user + ' le bot n’a pas le droit de créer des clips — reconnecte la chaîne 🔑'
            );
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
    if (c.nommage) {
      ctx.log.info('« ' + c.commande + ' pentakill » créera un clip intitulé « pentakill ».');
    }

    return {};
  },
};
