// Moments forts League of Legends : premier sang, multikills, ace, objectifs
// voles, legendaire -- a l'ecran, dans le chat, en clip.
//
// Source : l'API que le jeu ouvre lui-meme pendant une partie (voir api.js).
// Rien n'est injecte ni pilote : on lit ce que le jeu annonce deja a l'ecran.
//
// Twitch ne sert qu'aux messages et aux clips. Sans chaine connectee, l'overlay
// fonctionne quand meme.
//
// Deux aides sans etat viennent de modules voisins plutot que d'etre recopiees :
// la table des champions de Data Dragon (lol-session) et la creation de clips
// nommes (clips).

import { creerApi, PasDePartie } from './api.js';
import { creerRoster, normaliser } from './joueurs.js';
import { creerDetecteur } from './detection.js';
import {
  IMPORTANCE,
  NIVEAUX,
  REGLAGES,
  avecChat,
  cleReglage,
  horloge,
  messageChat,
  niveau,
  presenter,
  titreClip,
} from './moments.js';
import { sequenceDemo } from './demo.js';
import { charger as chargerChampions, initiales, VIDE as CHAMPIONS_VIDE } from '../lol-session/champions.js';
import { creerClipper } from '../clips/clips.js';

const DDRAGON = 'https://ddragon.leagueoflegends.com';

// Un tour par seconde : le kill s'affiche presque en meme temps que l'annonce
// du jeu. Hors partie, le port ferme repond en une milliseconde : rien a menager.
const TOUR_MS = 1000;
const RELECTURE_JOUEURS_MS = 5000;

// StreamKit lance en pleine partie : ce qui date de plus de 10 s n'est pas annonce.
const FRAICHEUR_S = 10;

// Le clip part 5 s apres le moment : le kill est dedans (Twitch garde les 30
// dernieres secondes), et l'image a eu le temps d'arriver chez Twitch.
const DELAI_CLIP_MS = 5000;
// Deux clips du meme combat : seul un moment plus fort en relance un.
const ECART_CLIPS_MS = 20_000;

const POSITIONS_ANNONCE = [
  { valeur: 'haut', label: 'Au centre, en haut (sous les annonces du jeu)' },
  { valeur: 'centre', label: 'Au centre de l’écran' },
  { valeur: 'bas', label: 'Au centre, en bas (au-dessus des sorts)' },
];

const POSITIONS_CARTES = [
  { valeur: 'sous-bandeau', label: 'En haut à gauche, sous le bandeau du suivi de session' },
  { valeur: 'top-left', label: 'En haut à gauche' },
  { valeur: 'top-right', label: 'En haut à droite, sous le score' },
  { valeur: 'left', label: 'À gauche, au milieu' },
  { valeur: 'bottom-left', label: 'En bas à gauche, au-dessus du chat du jeu' },
];

export default {
  id: 'lol-moments',
  nom: 'Moments forts',
  description:
    'Premier sang, multikills, ace, objectifs volés : une carte ou une annonce à l’écran, un message dans le chat, un clip. Lit la partie en cours, sans toucher au jeu.',
  icone: '⚡',
  categorie: 'lol',

  // Messages et clips uniquement : l'overlay, lui, se passe de Twitch.
  scopes: ['chat:read', 'chat:edit', 'clips:edit'],

  config: {
    version: 1,
    champs: [
      {
        cle: 'positionAnnonce',
        type: 'choix',
        label: 'Position des annonces (pentakill, objectif volé, légendaire)',
        defaut: 'haut',
        options: POSITIONS_ANNONCE,
      },
      {
        cle: 'positionCartes',
        type: 'choix',
        label: 'Position des cartes (premier sang, double à quadra kill, ace)',
        defaut: 'sous-bandeau',
        options: POSITIONS_CARTES,
      },
      ...REGLAGES.map((r, i) => ({
        cle: r.cle,
        type: 'choix',
        label: r.label,
        defaut: r.defaut,
        options: NIVEAUX,
        ...(i === 0
          ? {
              aide: 'Messages et clips passent par ta chaîne Twitch. Un clip ne se crée que pendant un live.',
            }
          : {}),
      })),
    ],
  },

  migrations: {},

  compteurs: {
    moments: 'Moments affichés',
    clips: 'Clips créés',
  },

  overlays: [
    {
      chemin: 'moments',
      nom: 'Moments forts',
      description: 'Les cartes et les annonces des moments forts. Une seule source, à la taille de ta scène.',
      fichier: 'moments.html',
    },
  ],

  libellesActions: {
    exemple: 'Afficher un exemple',
  },

  actions: {
    async exemple(ctx) {
      if (!ctx._exemple) return { ok: false, erreur: 'Le module doit être démarré.' };
      ctx._exemple();
      return {
        message:
          'Exemple en cours (25 secondes) : premier sang, un combat jusqu’au pentakill, un Nashor volé, un ace. Rien ne part dans le chat.',
      };
    },
  },

  // Pas de partie = « inactif » : c'est l'etat normal quand on ne joue pas.
  async sante(ctx) {
    const e = ctx._etatMoments?.();
    const carte = (etat, detail, aide = '') => [
      { id: 'lol-partie', nom: 'Partie de League of Legends', etat, detail, aide },
    ];
    if (!e) return carte('inactif', 'module au repos');
    if (e.statut === 'erreur')
      return carte('ko', e.message, 'Si ça dure, relance StreamKit après la partie.');
    if (e.statut === 'en_partie') {
      const detail = ['en partie', e.champion, e.moments ? e.moments + ' moment(s) fort(s)' : ''];
      return carte('ok', detail.filter(Boolean).join(' · '));
    }
    if (e.statut === 'chargement') return carte('inactif', 'partie en cours de chargement');
    if (e.statut === 'spectateur') return carte('inactif', 'partie regardée en spectateur');
    return carte('inactif', 'pas de partie en cours', 'Les moments forts s’affichent pendant tes parties.');
  },

  async demarrer(ctx) {
    const c = ctx.config;
    // ctx.apiJeu : un faux jeu, injecte par les tests.
    const api = ctx.apiJeu ?? creerApi();

    // --- Champions : nom francais et icone (Data Dragon) --------------------

    const stocke = ctx.etat.lire({ champions: null });
    let champions = stocke.champions?.version ? stocke.champions : CHAMPIONS_VIDE;
    let parCle = new Map();
    const indexer = () => {
      // La cle du jeu et celle de Data Dragon different parfois par la casse
      // (« FiddleSticks » / « Fiddlesticks ») : on compare en minuscules.
      parCle = new Map(Object.values(champions.parId ?? {}).map((ch) => [normaliser(ch.cle), ch]));
    };
    indexer();

    // A defaut de Data Dragon (hors ligne), le nom que donne le jeu et les initiales.
    function champion(joueur, nomSecours = '') {
      const dd = joueur?.cle ? parCle.get(normaliser(joueur.cle)) : null;
      const nom = dd?.nom || joueur?.champion || nomSecours || 'Champion';
      const icone =
        dd && champions.version
          ? DDRAGON + '/cdn/' + champions.version + '/img/champion/' + dd.cle + '.png'
          : '';
      return { nom, icone, initiales: initiales(nom) };
    }

    const rafraichirChampions = async () => {
      const r = await chargerChampions({ cache: champions });
      if (r.erreur) ctx.log.debug('Data Dragon indisponible : ' + r.erreur);
      if (!r.rafraichi) return;
      champions = r.donnees;
      indexer();
      ctx.etat.sauver({ champions });
    };
    rafraichirChampions();
    ctx.minuteur.intervalle(rafraichirChampions, 30 * 60_000);

    // --- Overlay -------------------------------------------------------------

    ctx.overlay.etat('moments', {
      theme: { positionAnnonce: c.positionAnnonce, positionCartes: c.positionCartes },
    });

    // --- Clips ---------------------------------------------------------------

    let clipEnAttente = null;
    let dernierClip = { a: 0, importance: 0 };
    let droitSignale = false;

    async function creerClip(moment, vue, importance) {
      let apiTwitch;
      try {
        apiTwitch = ctx.twitch.api;
      } catch {
        ctx.log.info('Pas de clip : Twitch n’est pas connecté.');
        return;
      }
      if (!ctx.twitch.aLeDroit('clips:edit')) {
        if (!droitSignale) {
          droitSignale = true;
          ctx.log.warn(
            'Pas de clip : ton autorisation Twitch ne couvre pas les clips. Reconnecte ta chaîne depuis l’indicateur Twitch.'
          );
        }
        return;
      }
      dernierClip = { a: Date.now(), importance };
      const clipper = creerClipper({
        api: apiTwitch,
        broadcasterId: ctx.twitch.broadcasterId,
        log: ctx.log,
        // ctx.attenteLectureClipMs : les tests n'attendent pas l'encodage de Twitch.
        ...(ctx.attenteLectureClipMs != null ? { delaiMs: ctx.attenteLectureClipMs } : {}),
      });
      const titre = titreClip(moment, vue);
      try {
        const clip = await clipper.creer({ nom: titre });
        ctx.compteur.incr('clips');
        ctx.log.ok('Clip « ' + clip.title + ' » : ' + clip.url);
        ctx.twitch.dire('✂️ Le clip « ' + titre + ' » : ' + clip.url);
      } catch (err) {
        if (err.reason === 'OFFLINE') ctx.log.info('Pas de clip : la chaîne n’est pas en live.');
        else if (err.reason === 'RATE_LIMIT')
          ctx.log.warn('Pas de clip : Twitch refuse, trop de clips d’un coup.');
        else if (err.reason === 'NO_SCOPE')
          ctx.log.warn('Pas de clip : autorisation « clips:edit » absente.');
        else ctx.log.warn('Clip non créé : ' + (err?.message || err));
      }
    }

    function programmerClip(moment, cle, vue) {
      const importance = IMPORTANCE[cle] ?? 0;
      // Un clip deja prevu pour un moment au moins aussi fort couvre celui-ci.
      if (clipEnAttente && importance <= clipEnAttente.importance) return;
      if (Date.now() - dernierClip.a < ECART_CLIPS_MS && importance <= dernierClip.importance) return;
      // Le pentakill arrive avant le clip du quadra : un seul clip, le sien.
      if (clipEnAttente) clipEnAttente.annule = true;
      const attente = { importance, annule: false };
      clipEnAttente = attente;
      ctx.minuteur.delai(async () => {
        if (attente.annule) return;
        clipEnAttente = null;
        await creerClip(moment, vue, importance);
      }, DELAI_CLIP_MS);
    }

    // --- Partie --------------------------------------------------------------

    let partie = null; // { detecteur, roster, rosterA, ignorerAvant, moments }
    let statut = 'hors_partie'; // hors_partie | chargement | spectateur | en_partie | erreur
    let message = '';

    function jouer(moment) {
      const cle = cleReglage(moment);
      const n = niveau(c, cle);
      if (n === 'off') return;
      const vue = presenter(moment, { moi: partie.roster.moi, champion });
      if (!vue) return;
      partie.moments++;
      ctx.compteur.incr('moments');
      ctx.overlay.diffuser('moments', 'moment', vue);
      ctx.log.ok(vue.titre + ' — ' + vue.detail + '.');
      if (avecChat(n)) ctx.twitch.dire(messageChat(moment, vue));
      if (n === 'clip') programmerClip(moment, cle, vue);
    }

    async function debutPartie() {
      let temps = 0;
      try {
        temps = Number((await api.stats())?.gameTime) || 0;
      } catch {
        /* encore en chargement : la partie commence */
      }
      partie = {
        detecteur: creerDetecteur(),
        roster: null,
        rosterA: 0,
        ignorerAvant: temps - FRAICHEUR_S,
        moments: 0,
      };
      ctx.log.info(
        temps > 60
          ? 'Partie déjà commencée (' + horloge(temps) + ') : seuls les nouveaux moments seront annoncés.'
          : 'Partie détectée.'
      );
    }

    function finPartie() {
      if (!partie) return;
      ctx.log.info(
        'Partie terminée' + (partie.moments ? ' : ' + partie.moments + ' moment(s) fort(s).' : '.')
      );
      partie = null;
      ctx.overlay.diffuser('moments', 'effacer', {});
    }

    async function chargerJoueurs() {
      partie.rosterA = Date.now();
      const [liste, nom] = await Promise.all([api.joueurs(), api.nomJoueurActif()]);
      partie.roster = creerRoster(liste, nom);
      if (partie.roster.moi) ctx.log.info('Tu joues ' + champion(partie.roster.moi).nom + '.');
    }

    async function tour() {
      const evenements = await api.evenements();

      // Les numeros repartent de zero : une autre partie a commence sans que le
      // jeu ferme son port entre les deux.
      const maxId = evenements.reduce(
        (m, e) => (Number.isInteger(e?.EventID) ? Math.max(m, e.EventID) : m),
        -1
      );
      if (partie && maxId < partie.detecteur.derniereId) finPartie();
      if (!partie) await debutPartie();

      if (!partie.roster?.moi) {
        if (Date.now() - partie.rosterA < RELECTURE_JOUEURS_MS) return;
        await chargerJoueurs();
        if (!partie.roster.moi) {
          // Liste vide pendant le chargement ; pleine, c'est une partie regardee.
          statut = partie.roster.joueurs.length ? 'spectateur' : 'chargement';
          return;
        }
      }

      statut = 'en_partie';
      message = '';
      const moments = partie.detecteur.traiter(evenements, partie.roster, {
        ignorerAvant: partie.ignorerAvant,
      });
      for (const m of moments) jouer(m);
    }

    let derniereErreur = '';
    ctx.minuteur.intervalle(async () => {
      try {
        await tour();
        derniereErreur = '';
      } catch (e) {
        // Port ferme, a n'importe quel appel du tour : la partie est finie.
        if (e instanceof PasDePartie) {
          finPartie();
          statut = 'hors_partie';
          return;
        }
        // Ecran de chargement : le service repond deja, mais pas encore la partie.
        if (e.status === 404 || e.status === 503) {
          statut = 'chargement';
          return;
        }
        message = e?.message || String(e);
        statut = 'erreur';
        // Une erreur qui se repete chaque seconde noierait le journal.
        if (message !== derniereErreur) {
          derniereErreur = message;
          ctx.log.warn('Partie League of Legends : ' + message);
        }
      }
    }, TOUR_MS);

    // --- Pour la vue d'ensemble et les actions -------------------------------

    ctx._etatMoments = () => ({
      statut,
      message,
      champion: partie?.roster?.moi ? champion(partie.roster.moi).nom : '',
      moments: partie?.moments ?? 0,
    });

    ctx._exemple = () => {
      for (const { apresMs, vue } of sequenceDemo(champion)) {
        ctx.minuteur.delai(() => ctx.overlay.diffuser('moments', 'moment', vue), apresMs);
      }
    };

    ctx.log.ok('Prêt. Les moments forts s’affichent pendant tes parties de League of Legends.');
    ctx.log.info('Overlay : ' + ctx.overlay.url('moments'));

    return {
      async arreter() {
        if (clipEnAttente) clipEnAttente.annule = true;
      },
    };
  },
};
