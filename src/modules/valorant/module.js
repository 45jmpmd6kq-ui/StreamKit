// Overlay Valorant — portage du projet Valorant-Overlay dans StreamKit.
//
// Bandeau de session pour OBS : rang, RR, RR gagné/perdu sur la session, bilan
// V/D et série en cours.
//
// Le projet d'origine etait en Python : c'est donc une reecriture, pas un
// deplacement. La logique metier est conservee a l'identique (detection de
// region, choix de l'acte, deduction du resultat par le signe du RR), y compris
// ses pieges — voir riot.js et session.js.
//
// Aucun droit Twitch : tout est local. Le module tourne meme si la chaine n'est
// pas connectee.

import { ClientRiot, ErreurClient, resultatDepuisDetail } from './riot.js';
import * as meta from './meta.js';
import * as session from './session.js';

export default {
  id: 'valorant',
  nom: 'Bandeau de session',
  description:
    'Rang, RR gagné sur la session, bilan V/D et série en cours, dans un bandeau OBS. Lit le Riot Client, sans toucher au jeu.',
  icone: '📊',
  categorie: 'valorant',

  // Volontairement vide : ce module ne parle qu'au Riot Client, en local.
  scopes: [],

  config: {
    version: 1,
    champs: [
      {
        cle: 'sessionMode',
        type: 'choix',
        label: 'Début de la session',
        aide: 'Ce qui remet le compteur V/D et le RR de session à zéro.',
        defaut: 'launch',
        options: [
          { valeur: 'launch', label: 'Au lancement de StreamKit' },
          { valeur: 'day', label: 'À minuit (journée en cours)' },
        ],
      },
      {
        cle: 'langue',
        type: 'choix',
        label: 'Langue des rangs et des cartes',
        defaut: 'fr-FR',
        options: [
          { valeur: 'fr-FR', label: 'Français' },
          { valeur: 'en-US', label: 'English' },
          { valeur: 'es-ES', label: 'Español' },
          { valeur: 'de-DE', label: 'Deutsch' },
        ],
      },
      {
        cle: 'region',
        type: 'texte',
        label: 'Région (si la détection échoue)',
        aide: 'Laisse vide : détectée depuis le journal du jeu. Sinon eu, na, ap, kr, br, latam.',
        defaut: '',
      },
      {
        cle: 'shard',
        type: 'texte',
        label: 'Shard (si la détection échoue)',
        aide: 'Généralement identique à la région. Exceptions : latam et br sont sur le shard « na ».',
        defaut: '',
      },
      {
        cle: 'pollPresenceSec',
        type: 'nombre',
        label: 'Rythme de lecture du client (secondes)',
        aide: 'Lecture 100 % locale : peut être rapide sans risque.',
        defaut: 2,
        min: 1,
        max: 30,
      },
      {
        cle: 'pollMmrSec',
        type: 'nombre',
        label: 'Rythme d’interrogation du classement (secondes)',
        aide: 'Appels chez Riot : inutile de descendre trop bas. Accéléré automatiquement à la sortie d’un match.',
        defaut: 30,
        min: 10,
        max: 300,
      },
    ],
  },

  migrations: {},

  overlays: [
    {
      chemin: 'bandeau',
      nom: 'Bandeau de session',
      description: 'Rang, RR de session, bilan V/D et série.',
      fichier: 'bandeau.html',
    },
  ],

  pages: [
    {
      chemin: 'suivi',
      nom: 'Suivi de session',
      description: 'État en direct, historique des matchs classés.',
      fichier: 'suivi.html',
    },
  ],

  libellesActions: {
    reinitialiserSession: 'Réinitialiser la session',
    rafraichirMeta: 'Rafraîchir les données de rangs',
  },

  actions: {
    async reinitialiserSession(ctx) {
      if (!ctx._reinitialiser) return { ok: false, erreur: 'Le module doit être démarré.' };
      const heure = ctx._reinitialiser();
      return { message: 'Session repartie de ' + heure + '.' };
    },

    // Utilise apres un patch Valorant : la version du client change, et les
    // appels a Riot echouent tant que le cache n'est pas rafraichi.
    async rafraichirMeta(ctx) {
      const etat = ctx.etat.lire({ meta: null, matchs: [] });
      const { meta: neuf } = await meta.charger({
        cache: null, // on force le telechargement
        langue: ctx.config.langue,
        log: ctx.log,
      });
      ctx.etat.sauver({ ...etat, meta: neuf });
      ctx._meta && Object.assign(ctx._meta, neuf);
      return { message: 'Données à jour (client Valorant ' + (neuf.version || '?') + ').' };
    },

    // Alimente la page « Suivi de session ».
    async suivi(ctx) {
      return { etat: ctx._construireEtat ? ctx._construireEtat() : null };
    },
  },

  // Ce que ce module apporte a la vue d'ensemble : l'etat du Riot Client.
  // Client ferme est l'etat NORMAL entre deux sessions de jeu -- « inactif »,
  // pas « en erreur » : un bandeau qui clignote en rouge quand on ne joue pas
  // n'apprend rien a personne.
  async sante(ctx) {
    const e = ctx._construireEtat?.();
    if (!e) return [{ id: 'riot', nom: 'Riot Client', etat: 'inactif', detail: 'module au repos' }];

    const p = e.player || {};
    const qui = p.name ? p.name + '#' + p.tag : '';
    const ou = p.region ? p.region.toUpperCase() : '';

    if (e.status === 'pret') {
      return [
        {
          id: 'riot',
          nom: 'Riot Client',
          etat: 'ok',
          detail: [qui, ou, e.rank?.name].filter(Boolean).join(' · '),
          aide: e.game?.state ? 'En jeu : ' + e.game.state : '',
        },
      ];
    }
    return [
      {
        id: 'riot',
        nom: 'Riot Client',
        etat: e.status === 'erreur' ? 'ko' : 'inactif',
        detail: e.message || 'fermé',
        aide: e.status === 'client_ferme' ? 'Lance Valorant : le bandeau se remplit tout seul.' : '',
      },
    ];
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const stocke = ctx.etat.lire({ meta: null, matchs: [] });

    const { meta: donnees, rafraichi } = await meta.charger({
      cache: stocke.meta,
      langue: c.langue,
      log: ctx.log,
    });
    ctx._meta = donnees;

    const matchs = Array.isArray(stocke.matchs) ? stocke.matchs : [];
    const sauver = () => ctx.etat.sauver({ meta: donnees, matchs });
    if (rafraichi) sauver();

    const client = new ClientRiot({
      meta: donnees,
      regionForcee: c.region,
      shardForce: c.shard,
    });

    // --- Session ------------------------------------------------------------

    const lanceA = Date.now();
    let reinitA = 0;

    function departSession() {
      if (reinitA) return reinitA;
      if (c.sessionMode === 'day') {
        const minuit = new Date();
        minuit.setHours(0, 0, 0, 0);
        return minuit.getTime();
      }
      return lanceA;
    }

    ctx._reinitialiser = () => {
      reinitA = Date.now();
      pousser();
      const d = new Date(reinitA);
      const p = (n) => String(n).padStart(2, '0');
      ctx.log.ok('Session réinitialisée.');
      return p(d.getHours()) + ':' + p(d.getMinutes());
    };

    // --- Etat expose --------------------------------------------------------

    let statut = 'demarrage';
    let message = 'Démarrage';
    let presence = {};
    let mmr = {};

    function construireEtat() {
      return {
        status: statut,
        message,
        player: { name: client.nom, tag: client.tag, region: client.region, shard: client.shard },
        rank: session.blocRang(mmr, donnees),
        session: session.blocSession(matchs, departSession(), c.sessionMode),
        game: session.blocPartie(presence, donnees),
        matches: matchs.slice(0, 20).map((m) => ({
          ...m,
          carte: (donnees.maps || {})[m.carteId] || '',
        })),
        meta: { version: donnees.version || '', fetched_at: donnees.fetched_at || '' },
      };
    }
    ctx._construireEtat = construireEtat;

    const pousser = () => ctx.overlay.etat('bandeau', construireEtat());
    pousser();

    // --- Collecte -----------------------------------------------------------

    let dernierMmr = 0;
    let boucleAvant = '';
    let rapideJusqua = 0;

    async function rafraichirClassement() {
      mmr = (await client.mmr()) || {};
      const nouveaux = session.enregistrer(matchs, await client.misesAJourClassees());

      let detailsResolus = 0;
      for (const id of session.aConfirmer(matchs, departSession())) {
        let resultat = null;
        try {
          resultat = resultatDepuisDetail(await client.detailMatch(id), client.puuid);
        } catch {
          /* detail indisponible : appliquerDetail comptera l'essai */
        }
        session.appliquerDetail(matchs, id, resultat);
        detailsResolus++;
      }

      if (nouveaux || detailsResolus) sauver();
      if (nouveaux) ctx.log.info(nouveaux + ' match(s) classé(s) ajouté(s).');
      dernierMmr = Date.now();
    }

    async function tour() {
      await client.preparer();
      presence = (await client.presence()) || {};

      const boucle = presence.sessionLoopState || '';
      if (boucleAvant === 'INGAME' && boucle !== 'INGAME') {
        // Le classement met quelques secondes a etre publie apres un match :
        // on repasse en cadence rapide pendant une minute et demie.
        rapideJusqua = Date.now() + 90_000;
      }
      boucleAvant = boucle;

      const intervalle = Date.now() < rapideJusqua ? 10_000 : c.pollMmrSec * 1000;
      if (Date.now() - dernierMmr >= intervalle) await rafraichirClassement();

      statut = 'pret';
      message = '';
    }

    let derniereErreur = '';
    function signaler(nouveauStatut, texte) {
      statut = nouveauStatut;
      message = texte;
      // Le Riot Client ferme est l'etat NORMAL entre deux sessions de jeu : le
      // repeter toutes les 2 secondes noierait le journal. On ne trace qu'au
      // changement.
      if (texte !== derniereErreur) {
        derniereErreur = texte;
        if (nouveauStatut === 'client_ferme') ctx.log.debug(texte);
        else ctx.log.warn(texte);
      }
    }

    ctx.minuteur.intervalle(async () => {
      try {
        await tour();
        derniereErreur = '';
      } catch (e) {
        if (e instanceof ErreurClient) {
          signaler('client_ferme', e.message);
        } else if (e?.status === 403) {
          signaler(
            'erreur',
            'accès refusé par Cloudflare (403) — clique sur « Rafraîchir les données de rangs »'
          );
        } else if (e?.status === 429) {
          signaler('erreur', 'trop de requêtes (429) — reprise automatique dans quelques minutes');
        } else {
          signaler('erreur', e?.message || String(e));
        }
      }
      pousser();
    }, Math.max(1, c.pollPresenceSec) * 1000);

    ctx.log.ok('Prêt. Lance Valorant : le bandeau se remplit tout seul.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('bandeau'));

    return {
      async arreter() {
        sauver();
      },
    };
  },
};
