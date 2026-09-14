// Annonce de pub — prevenir avant la coupure, patienter pendant.
//
// Avant : « Pause pub dans 0:45 », d'apres le planning des pubs automatiques.
// Pendant : « Pub en cours, on revient dans 1:23 », des que Twitch signale le
// debut d'une pub (automatique ou lancee a la main). Le chat est prevenu aussi :
// lui reste visible pendant la pub, contrairement au stream.
//
// Twitch reserve les pubs aux chaines Affiliees et Partenaires. Sur une autre
// chaine, le module demarre mais n'aura rien a annoncer ; « Simuler une pub »
// reste utilisable pour placer le bandeau.

import { creerSuiviPub, formaterDuree } from './pub.js';

const DROITS = ['channel:read:ads', 'channel:manage:ads'];
const peutLire = (ctx) => DROITS.some((d) => ctx.twitch.aLeDroit(d));

// Le planning bouge rarement, mais une pub repoussee doit se voir vite.
const RELECTURE_PLANNING_MS = 15_000;

const MESSAGE_AVANT = '📺 Pause pub dans {delai} — profitez-en pour boire un verre 🥤';
const MESSAGE_PENDANT = '⏸️ Pub en cours ({duree}), on revient vite ! Les abonnés ne voient pas les pubs 💜';

export default {
  id: 'pub',
  nom: 'Annonce de pub',
  description:
    'Prévient ton chat et ton stream avant chaque pub (« Pause pub dans 0:45 »), puis affiche le temps restant pendant la coupure.',
  icone: '📺',
  categorie: 'twitch',

  scopes: ['channel:read:ads', 'chat:read', 'chat:edit'],

  config: {
    version: 2,
    champs: [
      {
        cle: 'avertirSec',
        type: 'nombre',
        label: 'Prévenir combien de temps avant la pub (secondes)',
        aide: 'Seules les pubs automatiques sont connues à l’avance. Une pub lancée à la main s’affiche dès son début.',
        defaut: 60,
        min: 10,
        max: 600,
      },
      {
        cle: 'phraseAvant',
        type: 'texte',
        label: 'Phrase du bandeau avant la pub',
        defaut: 'Profitez-en pour boire un verre 🥤',
        max: 60,
      },
      {
        cle: 'phrasePendant',
        type: 'texte',
        label: 'Phrase du bandeau pendant la pub',
        defaut: 'Les abonnés ne voient pas les pubs 💜',
        max: 60,
      },
      {
        cle: 'chatAvantActif',
        type: 'bool',
        label: 'Prévenir le chat avant la pub',
        defaut: true,
      },
      {
        cle: 'chatAvant',
        type: 'texte',
        label: 'Message dans le chat avant la pub',
        aide: '{delai} devient « 1 min », « 45 s »…',
        defaut: MESSAGE_AVANT,
        max: 300,
      },
      {
        cle: 'chatPendantActif',
        type: 'bool',
        label: 'Prévenir le chat au début de la pub',
        defaut: true,
      },
      {
        cle: 'chatPendant',
        type: 'texte',
        label: 'Message dans le chat au début de la pub',
        aide: '{duree} devient « 1 min 30 », « 30 s »…',
        defaut: MESSAGE_PENDANT,
        max: 300,
      },
      {
        cle: 'coin',
        type: 'choix',
        label: 'Position dans OBS',
        defaut: 'bottom-left',
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

  migrations: {
    // v2 : un interrupteur par message de chat. Avant, on coupait un message en
    // videant son texte : on le traduit en interrupteur éteint, et le texte
    // reprend sa valeur d'origine pour le jour où on le rallume.
    2: (r) => {
      if (r.chatAvant === '') Object.assign(r, { chatAvantActif: false, chatAvant: MESSAGE_AVANT });
      if (r.chatPendant === '') Object.assign(r, { chatPendantActif: false, chatPendant: MESSAGE_PENDANT });
      return r;
    },
  },

  compteurs: {
    pubs: 'Pubs',
    minutes: 'Minutes de pub',
  },

  overlays: [
    {
      chemin: 'bandeau',
      nom: 'Annonce de pub',
      description: 'Invisible au repos : apparaît avant la pub, puis pendant.',
      fichier: 'bandeau.html',
    },
  ],

  libellesActions: {
    simuler: 'Simuler une pub',
  },

  actions: {
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
          id: 'pub',
          nom: 'Pubs Twitch',
          etat: 'ko',
          detail: 'droit de lecture des pubs manquant',
          aide: 'Reconnecte ta chaîne dans Connecteurs → Twitch : le droit « channel:read:ads » est nécessaire.',
        },
      ];
    }
    if (ctx._refus) {
      return [
        {
          id: 'pub',
          nom: 'Pubs Twitch',
          etat: 'attention',
          detail: 'Twitch refuse la lecture des pubs',
          aide: ctx._refus,
        },
      ];
    }
    const { planning, pub } = ctx._suivi?.etat() ?? {};
    const maintenant = Date.now();
    let detail = 'aucune pub automatique prévue';
    if (pub && maintenant < pub.debutA + pub.duree * 1000) detail = 'pub en cours';
    else if (planning?.prochaineA > maintenant)
      detail = 'prochaine pub dans ' + formaterDuree(planning.prochaineA - maintenant);
    return [{ id: 'pub', nom: 'Pubs Twitch', etat: 'ok', detail, aide: '' }];
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const theme = { coin: c.coin, phraseAvant: c.phraseAvant, phrasePendant: c.phrasePendant };
    const publier = (annonce) => ctx.overlay.etat('bandeau', { theme, annonce });
    publier(null);

    const suivi = creerSuiviPub({
      publier,
      dire: (message) => ctx.twitch.dire(message),
      avertirMs: Math.max(10, c.avertirSec) * 1000,
      messages: {
        avant: c.chatAvantActif ? c.chatAvant : '',
        pendant: c.chatPendantActif ? c.chatPendant : '',
      },
    });
    ctx._suivi = suivi;
    ctx.minuteur.intervalle(() => suivi.tic(), 1000);

    ctx._simuler = () => {
      const { planning, pub } = suivi.etat();
      const maintenant = Date.now();
      const enCours = pub && maintenant < pub.debutA + pub.duree * 1000;
      const bientot = planning?.prochaineA && Math.abs(planning.prochaineA - maintenant) < 60_000;
      if (enCours || bientot) {
        return { ok: false, erreur: 'Une vraie pub arrive ou tourne : la simulation attendra.' };
      }
      const { pubA, duree } = suivi.simuler({ dansMs: 15_000, duree: 30 });
      suivi.tic();
      ctx.minuteur.delai(() => suivi.demarrerSimulee({ debutA: pubA, duree }), pubA - Date.now());
      ctx.log.info('Simulation : avertissement 15 s, puis 30 s de pub. Rien n’est envoyé dans le chat.');
      return { message: 'Simulation lancée — regarde l’overlay (pub dans 15 s, 30 s de coupure).' };
    };

    if (!peutLire(ctx)) {
      ctx.log.warn(
        'Ton autorisation Twitch ne couvre pas la lecture des pubs. Reconnecte ta chaîne dans Connecteurs → Twitch.'
      );
      return {
        async arreter() {
          publier(null);
        },
      };
    }

    // --- Pubs qui demarrent ---------------------------------------------------
    ctx.twitch.surPub((e) => {
      const duree = Number(e.durationSeconds) || 0;
      if (duree <= 0) return;
      const debutA = e.startDate instanceof Date ? e.startDate.getTime() : Date.now();
      suivi.pub({ debutA, duree });
      ctx.compteur.incr('pubs');
      ctx.compteur.incr('minutes', Math.round(duree / 60));
      ctx.log.info(
        'Pub ' +
          (e.isAutomatic ? 'automatique' : 'lancée à la main') +
          ' : ' +
          formaterDuree(duree * 1000) +
          '.'
      );
    });

    // --- Planning des pubs automatiques ----------------------------------------
    const lirePlanning = async () => {
      try {
        const p = await ctx.twitch.api.channels.getAdSchedule(ctx.twitch.broadcasterId);
        const prochaineA = p?.nextAdDate instanceof Date ? p.nextAdDate.getTime() : null;
        suivi.planning({ prochaineA, duree: Number(p?.duration) || 0 });
        ctx._refus = null;
      } catch (e) {
        if (e?.statusCode === 403 || e?.statusCode === 401) {
          if (!ctx._refus) {
            ctx.log.warn(
              'Twitch refuse la lecture du planning des pubs : la chaîne n’est probablement ni Affiliée ni Partenaire.'
            );
          }
          ctx._refus =
            'Twitch réserve les pubs aux chaînes Affiliées et Partenaires. « Simuler une pub » reste utilisable pour régler l’overlay.';
        } else {
          ctx.log.debug('Planning des pubs illisible : ' + (e?.message || e));
        }
      }
    };
    await lirePlanning();
    ctx.minuteur.intervalle(lirePlanning, RELECTURE_PLANNING_MS);

    ctx.log.ok('Prêt. Le bandeau apparaîtra ' + c.avertirSec + ' s avant chaque pub automatique.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('bandeau'));

    return {
      async arreter() {
        publier(null);
      },
    };
  },
};
