// Suivi de session League of Legends : un bandeau en partie, un tableau de bord
// entre les parties.
//
// Source : l'API locale du client League of Legends (voir client.js). Rien
// n'est injecte dans le jeu, rien n'est demande a Riot en ligne : pas de cle
// d'API a obtenir, pas de compte a relier. Seuls les noms et icones des
// champions viennent de Data Dragon, le CDN public de Riot (voir champions.js).
//
// Deux sources OBS, chacune a la taille de son element, que le streamer place
// ou il veut : le bandeau et le tableau de bord (une seule page, session.html,
// qui lit dans son adresse ce qu'elle doit montrer). Le reglage « Bandeau »
// decide s'il s'efface entre les parties (voir visibilite() dans session.js).
// Jusqu'a la 0.25, une source unique montrait les deux : son adresse marche
// toujours, mais n'est plus proposee.
//
// Aucun droit Twitch : le module tourne meme sans chaine connectee.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { creerClient, trouverDossier } from './client.js';
import { creerSuivi, PHASES_JEU } from './suivi.js';
import { debutSession } from './session.js';
import { construireVue } from './vue.js';
import { charger as chargerChampions, VIDE as CHAMPIONS_VIDE } from './champions.js';
import { FILES, nomRang } from './rang.js';
import { CHAMPIONS_DEMO, sessionDemo } from './demo.js';

const DUREE_EXEMPLE_MS = 30_000;

// Les sources qui recoivent l'etat : les deux d'aujourd'hui, et l'ancienne
// source unique, pour qui l'a encore dans OBS.
const VUES = ['bandeau', 'tableau', 'session'];

const heure = (ms) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

export default {
  id: 'lol-session',
  nom: 'Suivi de session',
  description:
    'Rang, LP gagnés, bilan et série en partie ; récap complet de la session entre les parties. Lit le client League of Legends, sans toucher au jeu.',
  icone: '📈',
  categorie: 'lol',

  // Volontairement vide : ce module ne parle qu'au client LoL, en local.
  scopes: [],

  config: {
    version: 2,
    champs: [
      {
        cle: 'bandeau',
        type: 'choix',
        label: 'Bandeau',
        aide: 'Le tableau de bord, lui, s’affiche entre les parties, et se cache pendant la sélection des champions pour laisser voir les choix.',
        defaut: 'partie',
        options: [
          {
            valeur: 'partie',
            label: 'Seulement en partie : entre les parties, il laisse la place au tableau de bord',
          },
          { valeur: 'toujours', label: 'Tout le temps, dès que le client est ouvert' },
        ],
      },
      {
        cle: 'file',
        type: 'choix',
        label: 'Parties comptées',
        defaut: 'solo',
        options: [
          { valeur: 'solo', label: 'Classée Solo/Duo' },
          { valeur: 'flex', label: 'Classée Flexible' },
        ],
      },
      {
        cle: 'sessionMode',
        type: 'choix',
        label: 'Début de la session',
        aide: 'Ce qui remet le suivi à zéro. Le bouton « Réinitialiser la session » le fait à la main.',
        defaut: 'launch',
        options: [
          { valeur: 'launch', label: 'Au lancement de StreamKit' },
          { valeur: 'day', label: 'À minuit (journée en cours)' },
        ],
      },
      {
        cle: 'dossierJeu',
        type: 'texte',
        label: 'Dossier de League of Legends (si non trouvé)',
        aide: 'Laisse vide : StreamKit le trouve tout seul. Sinon, par exemple : C:\\Riot Games\\League of Legends',
        defaut: '',
        groupe: 'Avancé',
      },
    ],
  },

  migrations: {
    // v2 : deux sources OBS au lieu d'une. « Affichage » devient le reglage du
    // bandeau (le tableau de bord n'a plus besoin de reglage : on ajoute sa
    // source ou pas) ; les positions disparaissent, chaque source se place dans
    // OBS.
    2: (r) => {
      r.bandeau = r.affichage === 'bandeau' ? 'toujours' : 'partie';
      delete r.affichage;
      delete r.coinBandeau;
      delete r.coinTableau;
      return r;
    },
  },

  compteurs: {
    victoires: 'Victoires',
    defaites: 'Défaites',
  },

  // Tailles mesurees au banc (bandeau 760 x 76 au plus long, tableau de bord
  // 860 x 532), plus 24 px de marge en haut et a gauche -- l'ecart au bord
  // qu'avaient les coins -- et de quoi loger l'ombre a droite et en bas.
  overlays: [
    {
      chemin: 'bandeau',
      nom: 'Bandeau',
      description:
        'Rang, LP de la session, bilan et série. En partie seulement, ou tout le temps : réglage « Bandeau ».',
      fichier: 'session.html',
      taille: { largeur: 840, hauteur: 150 },
    },
    {
      chemin: 'tableau',
      nom: 'Tableau de bord',
      description:
        'Le récap de la session entre les parties : courbe des LP, dernières parties, champions joués, moyennes.',
      fichier: 'session.html',
      taille: { largeur: 920, hauteur: 620 },
    },
    {
      // L'ancienne source unique : gardee pour ne rien casser chez qui l'a deja
      // dans OBS (bandeau en haut a gauche, tableau de bord au centre), mais
      // plus proposee.
      chemin: 'session',
      nom: 'Ancienne source unique',
      fichier: 'session.html',
      masque: true,
    },
  ],

  libellesActions: {
    exemple: 'Afficher un exemple',
    reinitialiserSession: 'Réinitialiser la session',
  },

  actions: {
    async exemple(ctx) {
      if (!ctx._exemple) return { ok: false, erreur: 'Le module doit être démarré.' };
      ctx._exemple();
      return {
        message:
          'Exemple affiché pendant 30 secondes dans les deux sources, le bandeau et le tableau de bord, pour les placer dans OBS.',
      };
    },

    async reinitialiserSession(ctx) {
      if (!ctx._reinitialiser) return { ok: false, erreur: 'Le module doit être démarré.' };
      return { message: 'Session repartie de ' + ctx._reinitialiser() + '.' };
    },
  },

  // Client ferme = « inactif » : c'est l'etat normal quand on ne joue pas.
  async sante(ctx) {
    const e = ctx._etatLoL?.();
    const carte = (etat, detail, aide = '') => [{ id: 'lol', nom: 'League of Legends', etat, detail, aide }];
    if (!e) return carte('inactif', 'module au repos');

    if (e.statut === 'client_ferme') {
      return e.dossierTrouve
        ? carte('inactif', 'client fermé', 'Lance League of Legends : le suivi démarre tout seul.')
        : carte(
            'attention',
            'League of Legends introuvable',
            'Indique le dossier du jeu tout en bas des réglages du module.'
          );
    }
    if (e.statut === 'erreur') {
      return carte('ko', e.message, 'Si ça dure, relance le client League of Legends.');
    }
    if (e.statut !== 'pret') return carte('inactif', e.message || 'démarrage');

    const qui = e.moi?.nom ? e.moi.nom + (e.moi.tag ? '#' + e.moi.tag : '') : '';
    return carte(
      'ok',
      [qui, nomRang(e.rang), e.victoires + ' V / ' + e.defaites + ' D'].filter(Boolean).join(' · '),
      e.enPartie ? 'En partie' : ''
    );
  },

  // Rapport de bug : ou StreamKit cherche le jeu, et si le client y tourne.
  async diagnostic(ctx) {
    const dossier = trouverDossier(ctx.config.dossierJeu);
    return {
      enMarche: ctx._etatLoL?.() ?? 'module arrêté',
      dossierDuJeu: dossier,
      dossierTrouve: existsSync(dossier),
      // Le lockfile n'existe que client ouvert. Son CONTENU porte le mot de
      // passe de l'API locale : il ne sort jamais d'ici.
      clientOuvert: existsSync(join(dossier, 'lockfile')),
    };
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const stocke = ctx.etat.lire({ parties: [], reinitA: 0, champions: null });
    const parties = Array.isArray(stocke.parties) ? stocke.parties : [];
    let reinitA = Number(stocke.reinitA) || 0;
    let champions = stocke.champions || CHAMPIONS_VIDE;

    // Des LP encore attendus quand StreamKit s'est arrete ne viendront plus : le
    // rang d'avant la partie n'a plus de sens apres un redemarrage.
    for (const p of parties) {
      if (p.lpEnAttente) {
        p.lpEnAttente = false;
        p.lp = null;
      }
    }

    const lanceA = Date.now();
    const sauver = () => ctx.etat.sauver({ parties, reinitA, champions });
    const depuis = () => debutSession({ mode: c.sessionMode, lanceA, reinitA });
    const file = FILES[c.file] ?? FILES.solo;

    // Le dossier du jeu ne change qu'a une reinstallation : on le recherche une
    // fois par minute, pas a chaque tour de 2 secondes.
    let dossier = { chemin: '', a: 0 };
    const dossierJeu = () => {
      if (Date.now() - dossier.a > 60_000) dossier = { chemin: trouverDossier(c.dossierJeu), a: Date.now() };
      return dossier.chemin;
    };
    const client = creerClient({ dossier: dossierJeu });

    // --- Overlay -------------------------------------------------------------

    let exempleJusqua = 0;
    let dernierEnvoi = '';
    let suivi = null;

    const pousser = () => {
      let vue;
      if (Date.now() < exempleJusqua) {
        const demo = sessionDemo();
        vue = construireVue({
          config: c,
          suivi: demo.suivi,
          parties: demo.parties,
          depuis: 0,
          champions: { ...champions, parId: { ...CHAMPIONS_DEMO, ...champions.parId } },
        });
        vue.visible = { bandeau: true, tableau: true };
      } else {
        vue = construireVue({ config: c, suivi: suivi.etat, parties, depuis: depuis(), champions });
      }
      // Toutes les 2 secondes, mais seulement ce qui a change : une source OBS
      // n'a pas a recevoir cent fois le meme etat.
      const texte = JSON.stringify(vue);
      if (texte === dernierEnvoi) return;
      dernierEnvoi = texte;
      for (const v of VUES) ctx.overlay.etat(v, vue);
    };

    // --- Suivi ---------------------------------------------------------------

    const libelle = (p) => (p.victoire ? 'Victoire' : 'Défaite') + ' (' + p.k + '/' + p.d + '/' + p.a + ')';

    suivi = creerSuivi({
      client,
      file: c.file,
      parties,
      depuis,
      surClient: (ouvert) => {
        if (ouvert) ctx.log.ok('Client League of Legends détecté.');
        else ctx.log.info('Client League of Legends fermé.');
      },
      surPartie: (p) => {
        ctx.compteur.incr(p.victoire ? 'victoires' : 'defaites');
        sauver();
        ctx.log.ok(
          libelle(p) + (p.rattrapee ? ' — retrouvée dans l’historique, sans ses LP.' : ' — comptée.')
        );
        pousser();
      },
      surLp: (p) => {
        sauver();
        if (typeof p.lp === 'number') ctx.log.info('LP de la partie : ' + (p.lp > 0 ? '+' : '') + p.lp + '.');
        pousser();
      },
      surIgnoree: (raison) => ctx.log.info('Partie non comptée : ' + raison + '.'),
      surDemarrage: (detail) => ctx.log.debug('Client League of Legends pas encore prêt : ' + detail),
    });

    pousser();

    let derniereErreur = '';
    ctx.minuteur.intervalle(async () => {
      try {
        await suivi.tour();
        derniereErreur = '';
      } catch (e) {
        const message = e?.message || String(e);
        suivi.etat.statut = 'erreur';
        suivi.etat.message = message;
        // Une erreur qui se repete toutes les 2 secondes noierait le journal.
        if (message !== derniereErreur) {
          derniereErreur = message;
          ctx.log.warn('Client League of Legends : ' + message);
        }
      }
      pousser();
    }, 2000);

    // --- Noms et icones des champions (Data Dragon) -------------------------

    const rafraichirChampions = async () => {
      const r = await chargerChampions({ cache: champions });
      if (r.erreur) ctx.log.debug('Data Dragon indisponible : ' + r.erreur);
      if (!r.rafraichi) return;
      champions = r.donnees;
      sauver();
      pousser();
    };
    rafraichirChampions();
    ctx.minuteur.intervalle(rafraichirChampions, 30 * 60_000);

    // --- Pour la vue d'ensemble et les actions -------------------------------

    ctx._etatLoL = () => {
      const e = suivi.etat;
      const joues = parties.filter((p) => p.finA >= depuis());
      const victoires = joues.filter((p) => p.victoire).length;
      return {
        statut: e.statut,
        message: e.message,
        moi: e.moi,
        rang: e.rang,
        enPartie: PHASES_JEU.has(e.phase),
        victoires,
        defaites: joues.length - victoires,
        dossierTrouve: existsSync(client.dossier()),
      };
    };

    ctx._exemple = () => {
      exempleJusqua = Date.now() + DUREE_EXEMPLE_MS;
      pousser();
      ctx.minuteur.delai(pousser, DUREE_EXEMPLE_MS + 100);
    };

    ctx._reinitialiser = () => {
      reinitA = Date.now();
      sauver();
      pousser();
      ctx.log.ok('Session réinitialisée.');
      return heure(reinitA);
    };

    ctx.log.ok('Prêt (' + file.nom + '). Lance League of Legends : le suivi démarre tout seul.');
    ctx.log.info('Overlays : ' + ctx.overlay.url('bandeau') + ' et ' + ctx.overlay.url('tableau'));

    return {
      async arreter() {
        sauver();
      },
    };
  },
};
