// Sub Goal — une barre de progression vers un objectif de subs OFFERTS.
//
// Seuls les subgifts comptent (channel.subscription.gift) : les subs classiques
// T1, T2, T3 et les resubs n'avancent pas la barre. Un gift compte 1 quel que
// soit son palier. Le streamer saisit l'objectif (« Arc Qiyana ») et la cible ;
// le compteur est garde d'un lancement a l'autre, et ne se remet a zero que par
// le bouton.
//
// Visuel : carte compacte (maquette C, choix du user le 18/10/2026), meme
// famille que le bloc musique compact. Couleurs reglables comme la musique.
//
// Subs = chaines Affiliees et Partenaires. Ailleurs, « Simuler un subgift » et
// les boutons ➕ / ➖ suffisent a regler l'overlay.

import { ajouter, corriger, depuisEvenement, vue } from './subgoal.js';

const DROIT = 'channel:read:subscriptions';
const MEMOIRE = { compte: 0, dernier: null };

// Les boutons marchent module arrete aussi : ils ne touchent qu'a la memoire,
// et l'overlay suit si le module tourne.
function modifier(ctx, f) {
  const m = f({ ...MEMOIRE, ...ctx.etat.lire(MEMOIRE) });
  ctx.etat.sauver(m);
  ctx._publier?.();
  return m;
}

export default {
  id: 'subgoal',
  nom: 'Sub Goal',
  description:
    'Barre de progression vers un objectif de subs offerts (« Arc Qiyana »…). Seuls les subgifts comptent, pas les subs classiques.',
  icone: '🎁',
  categorie: 'twitch',

  scopes: [DROIT],

  config: {
    version: 1,
    champs: [
      {
        cle: 'objectif',
        type: 'texte',
        label: 'Objectif',
        aide: 'Ce que débloquent les subs offerts, affiché sur l’overlay. Ex. : Arc Qiyana, Arc 1v1.',
        defaut: '',
        max: 40,
        requis: true,
      },
      {
        cle: 'cible',
        type: 'nombre',
        label: 'Nombre de subs offerts à atteindre',
        aide: 'Un sub offert compte 1, quel que soit son palier. Le compteur continue au-delà.',
        defaut: 50,
        min: 1,
        max: 10000,
      },
      {
        cle: 'style',
        type: 'choix',
        label: 'Style de l’overlay',
        aide: 'Carte : compacte, avec le dernier viewer qui a offert. Barre : une seule ligne, l’objectif dans la jauge et le compteur à droite.',
        defaut: 'carte',
        options: [
          { valeur: 'carte', label: 'Carte' },
          { valeur: 'barre', label: 'Barre' },
        ],
      },
      {
        cle: 'afficherDernier',
        type: 'bool',
        label: 'Afficher le dernier viewer qui a offert (style Carte)',
        aide: 'Sous la barre : « Pseudo vient d’offrir 5 subs ». Coupé : « Plus que N subs offerts ».',
        defaut: true,
      },
      {
        cle: 'accent1',
        type: 'couleur',
        label: 'Couleur principale',
        aide: 'Barre de progression et liseré de la carte.',
        defaut: '#9146ff',
      },
      {
        cle: 'accent2',
        type: 'couleur',
        label: 'Couleur secondaire',
        aide: 'Compteur, et toute la carte quand l’objectif est atteint.',
        defaut: '#ffb400',
      },
      {
        cle: 'opaciteFond',
        type: 'nombre',
        label: 'Opacité du fond (%)',
        aide: '100 : fond sombre plein. 0 : plus de fond, seuls les textes et la barre restent.',
        defaut: 92,
        min: 0,
        max: 100,
      },
      {
        cle: 'coin',
        type: 'choix',
        label: 'Position dans OBS',
        defaut: 'bottom-right',
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
    subgifts: 'Subs offerts',
  },

  overlays: [
    {
      chemin: 'carte',
      nom: 'Objectif de subs offerts',
      description: 'Carte compacte : objectif, compteur, barre et dernier viewer qui a offert.',
      fichier: 'carte.html',
    },
  ],

  libellesActions: {
    simuler: 'Simuler un subgift',
    ajouter: '➕ 1 sub offert',
    retirer: '➖ 1 sub offert',
    remettreAZero: 'Remettre à zéro',
  },

  actions: {
    async simuler(ctx) {
      if (!ctx._simuler) {
        return { ok: false, erreur: 'Le module doit être démarré pour lancer une simulation.' };
      }
      return ctx._simuler();
    },
    // Correction a la main : un gift rate (StreamKit ferme) ou compte a tort.
    async ajouter(ctx) {
      const m = modifier(ctx, (x) => corriger(x, +1));
      return { message: 'Compteur : ' + m.compte + '.' };
    },
    async retirer(ctx) {
      const m = modifier(ctx, (x) => corriger(x, -1));
      return { message: 'Compteur : ' + m.compte + '.' };
    },
    async remettreAZero(ctx) {
      modifier(ctx, () => ({ ...MEMOIRE }));
      ctx.log.info('Compteur remis à zéro.');
      return { message: 'Compteur remis à zéro.' };
    },
  },

  async sante(ctx) {
    if (!ctx.twitch.aLeDroit(DROIT)) {
      return [
        {
          id: 'subgoal',
          nom: 'Sub Goal',
          etat: 'ko',
          detail: 'droit de lecture des subs manquant',
          aide: 'Reconnecte ta chaîne dans Connecteurs → Twitch : le droit « channel:read:subscriptions » est nécessaire.',
        },
      ];
    }
    const v = vue(ctx.config, { ...MEMOIRE, ...ctx.etat.lire(MEMOIRE) });
    return [
      {
        id: 'subgoal',
        nom: 'Sub Goal',
        etat: 'ok',
        detail: v.objectif + ' — ' + v.compte + ' / ' + v.cible + (v.atteint ? ' (atteint)' : ''),
        aide: '',
      },
    ];
  },

  async diagnostic(ctx) {
    return { memoire: ctx.etat.lire(MEMOIRE), cible: ctx.config.cible };
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const theme = {
      style: c.style,
      coin: c.coin,
      accent1: c.accent1,
      accent2: c.accent2,
      opacite: c.opaciteFond,
    };
    const lire = () => ({ ...MEMOIRE, ...ctx.etat.lire(MEMOIRE) });

    // `simulation` : un etat d'apercu, jamais sauve.
    let simulation = null;
    const publier = () => ctx.overlay.etat('carte', { theme, goal: vue(c, simulation ?? lire()) });
    ctx._publier = publier;
    publier();

    let finSimulation = null;
    ctx._simuler = () => {
      clearTimeout(finSimulation);
      simulation = ajouter(lire(), { nombre: 5, gifteur: 'Viewer_Test' });
      publier();
      finSimulation = ctx.minuteur.delai(() => {
        simulation = null;
        publier();
      }, 8000);
      ctx.log.info('Simulation : +5 subs offerts pendant 8 s, le vrai compteur ne bouge pas.');
      return { message: 'Simulation lancée — regarde l’overlay (8 s, le compteur n’est pas modifié).' };
    };

    const arreter = {
      async arreter() {
        clearTimeout(finSimulation);
        delete ctx._publier;
        delete ctx._simuler;
        // Module coupe : la carte disparait de l'ecran.
        ctx.overlay.etat('carte', { theme, goal: null });
      },
    };

    if (!ctx.twitch.aLeDroit(DROIT)) {
      ctx.log.warn(
        'Ton autorisation Twitch ne couvre pas la lecture des subs. Reconnecte ta chaîne dans Connecteurs → Twitch.'
      );
      return arreter;
    }

    // Seul channel.subscription.gift : un sub classique n'arrive jamais ici.
    ctx.twitch.surSubgifts((e) => {
      const lot = depuisEvenement(e);
      if (!lot.nombre) return;
      const avant = lire();
      const m = ajouter(avant, lot);
      ctx.etat.sauver(m);
      publier();
      ctx.compteur.incr('subgifts', lot.nombre, lot.gifteur ? { par: lot.gifteur } : undefined);
      const qui = lot.gifteur ?? 'Un viewer anonyme';
      const texte =
        qui +
        ' offre ' +
        lot.nombre +
        ' sub' +
        (lot.nombre > 1 ? 's' : '') +
        ' — ' +
        m.compte +
        ' / ' +
        c.cible;
      ctx.log.ok(texte);
      ctx.activite('🎁 ' + texte);
      if (avant.compte < c.cible && m.compte >= c.cible) {
        ctx.log.ok('Objectif atteint : « ' + c.objectif + ' » !');
        ctx.activite('🎉 Objectif de subs atteint : « ' + c.objectif + ' »');
      }
    });

    const v = vue(c, lire());
    ctx.log.ok('Prêt : « ' + v.objectif + ' », ' + v.compte + ' / ' + v.cible + ' subs offerts.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('carte'));
    return arreter;
  },
};
