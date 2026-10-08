// Soiree Clubs (EA SPORTS FC 27) : le bilan de la soiree en direct, une carte
// apres chaque match, les trophees de fin de soiree.
//
// Source : l'API Clubs d'EA (voir ea.js), celle du site des clubs. Rien n'est
// lu dans le jeu, et tout arrive APRES le coup de sifflet final, quand EA publie
// le match : il n'existe aucune donnee en direct (pas d'equivalent de l'API de
// Rocket League ou de celle du client LoL). EA oublie parfois de publier un
// match qu'il a pourtant compte : le bilan du club sert alors de filet (voir
// bilan-club.js), le match entre au bilan de la soiree sans carte.
//
// Trois sources OBS, chacune a la taille de son element, que le streamer place
// ou il veut : le bandeau (bilan et serie, tout le temps), la carte de fin de
// match (seule, a chaque match publie) et le tableau de fin de soiree (trophees
// et derniers matchs). Maquettes choisies par le user le 29/09/2026 : la
// variante B des trois, le bandeau sans sa ligne du bas.
//
// Rien sur l'equipe adverse a part son nom a cote du score, qu'un reglage
// eteint : les overlays ne parlent que du club du streamer.
//
// Aucun droit Twitch : le module tourne meme sans chaine connectee.

import { creerClientEA, moteurReseau, NOM_MAX } from './ea.js';
import { choisirClub, couleurDuMaillot, nomDivision } from './club.js';
import { analyserMatch } from './analyse.js';
import { lireBilan, matchDuBilan, nouveauxDuBilan, provisoireDe } from './bilan-club.js';
import { bilan, matchsDeLaSoiree } from './soiree.js';
import { vueBandeau, vueCarte, vueClub, vueTableau } from './vue.js';
import { CLUB_DEMO, SR_DEMO, soireeDemo } from './demo.js';
import {
  FORMATIONS,
  FORMATION_DEFAUT,
  NB_MAX,
  PSEUDO_MAX,
  libellePlace,
  nettoyer,
  probleme,
  tirer,
} from './formation.js';

// Un tour par minute : deux ou trois requetes (une par type de match). EA
// publie un match quelques minutes apres la fin ; lire plus souvent ne le ferait
// pas arriver plus tot.
const TOUR_MS = 60_000;
// Club introuvable (pas encore cree, nom mal tape) : on le recherche toutes les
// 2 minutes, pas a chaque tour.
const RECHERCHE_MS = 2 * 60_000;
// Division, couleurs et nom du club : relus toutes les 30 minutes, et apres
// chaque match de competition (une montee se voit aussitot).
const RAFRAICHIR_CLUB_MS = 30 * 60_000;
const DUREE_EXEMPLE_MS = 30_000;
// EA ne rend que les 10 derniers matchs de chaque type : le module garde les
// siens, trois semaines au plus.
const GARDER_MS = 21 * 24 * 3600_000;
const GARDER_MAX = 120;
// Sans nouveau match, le bilan lu n'est ecrit sur le disque que toutes les
// 10 minutes : assez pour reprendre apres un redemarrage.
const SAUVER_SUIVI_MS = 10 * 60_000;

const VUES = ['bandeau', 'carte', 'tableau'];
const COULEUR_DEFAUT = '#3b7bff';
const TYPES_LIBELLES = { championnat: 'championnat', playoffs: 'playoffs', amical: 'amical' };
const RESULTATS = { V: 'Victoire', N: 'Nul', D: 'Défaite' };
const COMPTEURS = { V: 'victoires', N: 'nuls', D: 'defaites' };

const heure = (ms) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

// La formation vit dans le meme fichier d'etat que la soiree, sous sa propre
// cle : la page l'ecrit module arrete comme demarre, et la soiree ne l'efface
// pas en sauvant.
const lireFormation = (ctx) =>
  ctx.etat.lire({}).formation ?? { code: FORMATION_DEFAUT, joueurs: [], tirage: null };
const sauverFormation = (ctx, f) => ctx.etat.sauver({ ...ctx.etat.lire({}), formation: f });

const cleDuClub = (c) =>
  String(c.clubId ?? '').trim() +
  '|' +
  String(c.club ?? '')
    .trim()
    .toLocaleLowerCase('fr');

const libelleMatch = (m) =>
  RESULTATS[m.resultat] +
  (m.provisoire ? '' : ' ' + m.buts + '–' + m.encaisses) +
  (m.adversaire ? ' contre ' + m.adversaire : '') +
  ' (' +
  TYPES_LIBELLES[m.type] +
  ')';

// Hors de l'application, EA ne repond pas : autant le dire que laisser croire
// a une panne d'EA.
function messageErreur(e, moteur) {
  if (moteur.nom !== 'electron' && e?.reseau) {
    return 'EA ne répond pas hors de l’application StreamKit (lance-la normalement)';
  }
  return e?.message || String(e);
}

async function chercher(config) {
  const nom = String(config.club ?? '').trim();
  const moteur = await moteurReseau();
  const ea = creerClientEA({ fetch: moteur.fetch });
  try {
    return { moteur, ...choisirClub(await ea.rechercher(nom.slice(0, NOM_MAX)), { nom, id: config.clubId }) };
  } catch (e) {
    return { moteur, statut: 'erreur', message: messageErreur(e, moteur) };
  }
}

export default {
  id: 'fc-clubs',
  nom: 'Soirée Clubs',
  description:
    'Bilan de la soirée, carte de fin de match et trophées de fin de soirée pour les Clubs de FC 27. Lit le site des clubs d’EA, sans toucher au jeu.',
  icone: '🏆',
  categorie: 'ea-fc',

  // Volontairement vide : ce module ne parle qu'a EA.
  scopes: [],

  config: {
    version: 1,
    champs: [
      {
        cle: 'club',
        type: 'texte',
        label: 'Nom du club',
        aide: 'Exactement comme dans le jeu (les majuscules ne comptent pas). Clubs sur PS5, Xbox Series et PC. « Chercher le club chez EA » vérifie que StreamKit le trouve.',
        defaut: '',
        max: NOM_MAX,
        requis: true,
      },
      {
        cle: 'matchs',
        type: 'choix',
        label: 'Matchs comptés',
        defaut: 'tous',
        options: [
          { valeur: 'tous', label: 'Championnat, playoffs et amicaux' },
          { valeur: 'competition', label: 'Championnat et playoffs seulement' },
        ],
      },
      {
        cle: 'dureeCarte',
        type: 'nombre',
        label: 'Carte de fin de match : durée à l’écran (secondes)',
        aide: 'Elle apparaît toute seule quand EA publie le match, quelques minutes après le coup de sifflet.',
        defaut: 30,
        min: 10,
        max: 300,
      },
      {
        cle: 'adversaire',
        type: 'bool',
        label: 'Nom de l’adversaire à côté du score',
        aide: 'Seulement son nom, en petit. Rien d’autre de l’équipe adverse n’est affiché.',
        defaut: true,
      },
      {
        cle: 'couleurMaillot',
        type: 'bool',
        label: 'Couleur du maillot du club',
        aide: 'Les overlays prennent la couleur du maillot domicile. Éteint, ou maillot blanc, gris ou noir : la couleur ci-dessous.',
        defaut: true,
      },
      {
        cle: 'couleur',
        type: 'couleur',
        label: 'Couleur des overlays',
        defaut: COULEUR_DEFAUT,
      },
      {
        cle: 'pauseSoiree',
        type: 'nombre',
        label: 'Nouvelle soirée après (heures sans match)',
        aide: 'Le bilan repart de zéro au premier match qui suit une telle pause. « Commencer une nouvelle soirée » le fait à la main.',
        defaut: 3,
        min: 1,
        max: 12,
        groupe: 'Avancé',
      },
      {
        cle: 'clubId',
        type: 'texte',
        label: 'Identifiant EA du club (si plusieurs clubs ont ce nom)',
        aide: 'Laisse vide. « Chercher le club chez EA » te le donne si le nom ne suffit pas.',
        defaut: '',
        max: 20,
        groupe: 'Avancé',
      },
    ],
  },

  migrations: {},

  compteurs: {
    victoires: 'Victoires',
    nuls: 'Nuls',
    defaites: 'Défaites',
  },

  // Chaque element est a 24 px du haut et de la gauche de sa source (comme le
  // suivi de session LoL), avec de quoi loger l'ombre a droite et en bas. La
  // carte est prevue pour 11 joueurs humains (lignes resserrees au-dela de 8).
  overlays: [
    {
      chemin: 'bandeau',
      nom: 'Bandeau de soirée',
      description: 'Victoires, nuls, défaites et série de la soirée. Tout le temps à l’écran.',
      fichier: 'bandeau.html',
      taille: { largeur: 348, hauteur: 232 },
    },
    {
      chemin: 'carte',
      nom: 'Carte de fin de match',
      description:
        'Score, notes, buts et passes décisives de chaque joueur du club. Apparaît seule à chaque match publié par EA.',
      fichier: 'carte.html',
      taille: { largeur: 488, hauteur: 720 },
    },
    {
      chemin: 'tableau',
      nom: 'Tableau de fin de soirée',
      description: 'Les trophées de la soirée (MVP, buteur, passeur, le mur) et les derniers matchs.',
      fichier: 'tableau.html',
      taille: { largeur: 868, hauteur: 400 },
    },
  ],

  // Pas un overlay : un ecran dans StreamKit, que le streamer montre ou non.
  pages: [
    {
      chemin: 'formation',
      nom: 'Formation du club',
      description: 'Inscris tes joueurs, tire leurs postes au sort, puis retourne les cartes sur le terrain.',
      fichier: 'formation.html',
    },
  ],

  libellesActions: {
    exemple: 'Afficher un exemple',
    chercherClub: 'Chercher le club chez EA',
    revoirCarte: 'Revoir la dernière carte',
    nouvelleSoiree: 'Commencer une nouvelle soirée',
  },

  actions: {
    async exemple(ctx) {
      if (!ctx._exemple) return { ok: false, erreur: 'Le module doit être démarré.' };
      ctx._exemple();
      return {
        message:
          'Exemple affiché pendant 30 secondes dans les trois sources (bandeau, carte, tableau), pour les placer dans OBS.',
      };
    },

    // Marche aussi module arrete : c'est ce qu'on clique en creant le club.
    async chercherClub(ctx) {
      if (!String(ctx.config.club ?? '').trim()) {
        return { ok: false, erreur: 'Indique d’abord le nom du club, puis Enregistrer.' };
      }
      const r = await chercher(ctx.config);
      if (r.statut === 'erreur') return { ok: false, erreur: r.message };
      if (r.statut === 'ambigu') {
        return {
          ok: false,
          erreur:
            'Plusieurs clubs portent ce nom : ' +
            r.candidats
              .map((c) => c.nom + ' (identifiant ' + c.id + ', ' + c.matchsJoues + ' matchs)')
              .join(', ') +
            '. Indique le tien dans « Identifiant EA du club », puis Enregistrer.',
        };
      }
      if (r.statut === 'introuvable') {
        const proches = r.proches.map((c) => c.nom).join(', ');
        return {
          ok: false,
          erreur:
            'Aucun club « ' +
            String(ctx.config.club).trim() +
            ' » chez EA' +
            (proches ? ' (noms proches : ' + proches + ')' : '') +
            '. Un club tout juste créé peut mettre quelques minutes à apparaître.',
        };
      }
      ctx._relancer?.();
      const division = nomDivision(r.club.division);
      return {
        message:
          'Club trouvé : ' +
          r.club.nom +
          ' (identifiant ' +
          r.club.id +
          (division ? ', ' + division : '') +
          ', ' +
          r.club.matchsJoues +
          ' matchs de championnat).',
      };
    },

    async revoirCarte(ctx) {
      if (!ctx._revoirCarte) return { ok: false, erreur: 'Le module doit être démarré.' };
      return ctx._revoirCarte()
        ? { message: 'La carte du dernier match est de nouveau à l’écran.' }
        : { ok: false, erreur: 'Aucun match du club n’est encore connu.' };
    },

    // Les trois suivantes servent la page « Formation du club » : pas de bouton
    // (un clic sans donnees viderait la liste des joueurs). Elles marchent
    // module arrete : rien ne passe par EA.
    async formation(ctx) {
      const c = ctx.config;
      const club = ctx.etat.lire({}).club;
      return {
        club: club?.nom || String(c.club ?? '').trim(),
        couleur: (c.couleurMaillot && couleurDuMaillot(club?.kit)) || c.couleur || COULEUR_DEFAUT,
        nbMax: NB_MAX,
        pseudoMax: PSEUDO_MAX,
        formations: FORMATIONS.map((f) => ({
          code: f.code,
          places: f.places.map((pl) => ({ ...pl, libelle: libellePlace(f, pl) })),
        })),
        ...lireFormation(ctx),
      };
    },

    async enregistrerFormation(ctx, corps) {
      const propre = nettoyer(corps);
      sauverFormation(ctx, { ...lireFormation(ctx), ...propre });
      return { message: propre.joueurs.length + ' joueur(s) enregistré(s).', ...propre };
    },

    async tirerFormation(ctx, corps) {
      const propre = nettoyer(corps);
      const souci = probleme(propre);
      if (souci) return { ok: false, erreur: souci };
      const tirage = { a: Date.now(), code: propre.code, places: tirer(propre) };
      sauverFormation(ctx, { ...propre, tirage });
      ctx.log.ok(
        'Formation tirée (' +
          propre.code +
          ') : ' +
          tirage.places
            .filter((pl) => !pl.ia)
            .map((pl) => pl.poste + ' ' + pl.nom)
            .join(', ') +
          '.'
      );
      return { message: 'Formation tirée.', ...propre, tirage };
    },

    async nouvelleSoiree(ctx) {
      if (!ctx._nouvelleSoiree) return { ok: false, erreur: 'Le module doit être démarré.' };
      return {
        message: 'Nouvelle soirée commencée à ' + ctx._nouvelleSoiree() + ' : le bilan repart de zéro.',
      };
    },
  },

  async sante(ctx) {
    const e = ctx._etatFC?.();
    const carte = (etat, detail, aide = '') => [{ id: 'ea', nom: 'EA FC', etat, detail, aide }];
    if (!e) return carte('inactif', 'module au repos');

    if (e.statut === 'introuvable') {
      return carte(
        'attention',
        'club « ' + e.nom + ' » introuvable chez EA',
        'Vérifie le nom exact, celui du jeu. Un club tout juste créé peut mettre quelques minutes à apparaître : StreamKit le recherche toutes les 2 minutes.'
      );
    }
    if (e.statut === 'ambigu') {
      return carte(
        'attention',
        'plusieurs clubs s’appellent « ' + e.nom + ' »',
        'Clique « Chercher le club chez EA » : il donne leurs identifiants. Indique le tien dans les réglages.'
      );
    }
    if (e.statut === 'erreur') {
      return carte(
        'ko',
        e.message,
        'EA coupe parfois l’accès aux données des clubs. Les overlays gardent la soirée en cours et reprennent tout seuls quand EA répond.'
      );
    }
    if (e.statut !== 'pret') return carte('inactif', 'recherche du club « ' + e.nom + ' » chez EA');

    return carte(
      'ok',
      [e.club, e.division, e.v + ' V · ' + e.n + ' N · ' + e.d + ' D'].filter(Boolean).join(' · '),
      e.dernierMatchA
        ? e.dernierSansDetail
          ? 'Dernier match compté à ' +
            heure(e.dernierMatchA) +
            ' d’après le bilan du club : EA n’a pas publié son détail, il n’a donc pas de carte'
          : 'Dernier match publié par EA à ' + heure(e.dernierMatchA)
        : 'Pas encore de match ce soir'
    );
  },

  // Rapport de bug : la pile reseau utilisee (EA ne repond qu'a celle de
  // l'application) et ce que le module sait du club.
  async diagnostic(ctx) {
    const moteur = await moteurReseau();
    return {
      enMarche: ctx._etatFC?.() ?? 'module arrêté',
      reseau:
        moteur.nom === 'electron'
          ? 'Chromium (application)'
          : 'Node — EA ne répond pas hors de l’application',
      club: ctx.config.club,
      identifiantDemande: ctx.config.clubId || '(aucun)',
      matchsComptes: ctx.config.matchs,
    };
  },

  async demarrer(ctx) {
    const c = ctx.config;
    const moteur = await moteurReseau();
    const ea = creerClientEA({ fetch: moteur.fetch });
    if (moteur.nom !== 'electron') {
      ctx.log.warn('Hors de l’application StreamKit : EA ne répondra sans doute pas.');
    }

    // Un autre nom de club dans les reglages : les matchs retenus ne sont plus
    // les siens.
    const cle = cleDuClub(c);
    const stocke = ctx.etat.lire({ cle, club: null, matchs: [], sr: [], reinitA: 0, suivi: null });
    const memoire = stocke.cle === cle ? stocke : { club: null, matchs: [], sr: [], reinitA: 0, suivi: null };
    let club = memoire.club ?? null;
    const matchs = Array.isArray(memoire.matchs) ? memoire.matchs : [];
    const srs = Array.isArray(memoire.sr) ? memoire.sr : [];
    let reinitA = Number(memoire.reinitA) || 0;
    // La derniere lecture du bilan du club : { joues, v, n, d, sr, a }.
    let suivi = memoire.suivi ?? null;
    let sauveA = 0;
    const sauver = () => {
      sauveA = Date.now();
      ctx.etat.sauver({ ...ctx.etat.lire({}), cle, club, matchs, sr: srs, reinitA, suivi });
    };

    const pauseMs = c.pauseSoiree * 3600_000;
    const types =
      c.matchs === 'competition' ? ['championnat', 'playoffs'] : ['championnat', 'playoffs', 'amical'];
    const soiree = () => matchsDeLaSoiree(matchs, { pauseMs, reinitA });

    const etat = { statut: 'recherche', message: '', derniereLecture: 0 };
    let derniereRecherche = 0;
    let premierTour = true;

    // --- Overlays ------------------------------------------------------------

    // L'ecart de skill rating du match est range sur le match (`ecartSr`) : il
    // peut arriver apres lui, avec le bilan du club.
    let carte = { match: null, jusqua: 0 };
    let exempleJusqua = 0;
    const envoyes = {};

    const couleur = (kit) => (c.couleurMaillot && couleurDuMaillot(kit)) || c.couleur || COULEUR_DEFAUT;

    // Le skill rating maintenant, et celui lu avant la fin du premier match de
    // la soiree -- s'il l'a ete dans les heures qui precedent : plus ancien, des
    // matchs joues hors stream fausseraient l'ecart.
    const srSoiree = (s) => {
      const actuel = srs.at(-1)?.valeur ?? null;
      if (actuel == null) return null;
      if (!s.length) return { actuel, debut: null };
      const avant = srs.filter((x) => x.a <= s[0].a && x.a >= s[0].a - pauseMs).at(-1);
      return { actuel, debut: avant ? avant.valeur : null };
    };

    const pousser = () => {
      let vues;
      if (Date.now() < exempleJusqua) {
        const s = soireeDemo();
        const clubVue = vueClub({ club: CLUB_DEMO, couleur: couleur(club?.kit) });
        vues = {
          bandeau: vueBandeau({ club: clubVue, soiree: s }),
          carte: vueCarte({
            club: clubVue,
            match: s.at(-1),
            visible: true,
            sr: SR_DEMO.dernierMatch,
            adversaire: c.adversaire,
          }),
          tableau: vueTableau({ club: clubVue, soiree: s, sr: SR_DEMO, adversaire: c.adversaire }),
        };
      } else {
        // Avant qu'EA connaisse le club (il se cree ce soir, par exemple), le
        // bandeau et le tableau sont deja la, au nom des reglages, a zero.
        const s = soiree();
        const clubVue = vueClub({
          club: club ?? { nom: String(c.club).trim() },
          couleur: couleur(club?.kit),
        });
        vues = {
          bandeau: vueBandeau({ club: clubVue, soiree: s }),
          carte: vueCarte({
            club: clubVue,
            match: carte.match,
            visible: Date.now() < carte.jusqua,
            sr: carte.match?.ecartSr ?? null,
            adversaire: c.adversaire,
          }),
          tableau: vueTableau({ club: clubVue, soiree: s, sr: srSoiree(s), adversaire: c.adversaire }),
        };
      }
      // Seulement ce qui a change : une source OBS n'a pas a recevoir cent fois
      // le meme etat.
      for (const v of VUES) {
        const texte = JSON.stringify(vues[v]);
        if (texte === envoyes[v]) continue;
        envoyes[v] = texte;
        ctx.overlay.etat(v, vues[v]);
      }
    };

    const montrerCarte = (match) => {
      carte = { match, jusqua: Date.now() + c.dureeCarte * 1000 };
      pousser();
      ctx.minuteur.delai(pousser, c.dureeCarte * 1000 + 100);
    };

    // --- Lecture chez EA ------------------------------------------------------

    const lireClub = async () => {
      derniereRecherche = Date.now();
      const nom = String(c.club).trim();
      const r = choisirClub(await ea.rechercher(nom.slice(0, NOM_MAX)), { nom, id: c.clubId });
      if (r.statut !== 'trouve') {
        if (!club && etat.statut !== r.statut) {
          ctx.log.warn(
            r.statut === 'ambigu'
              ? 'Plusieurs clubs s’appellent « ' + nom + ' » : clique « Chercher le club chez EA ».'
              : 'Club « ' + nom + ' » introuvable chez EA. Nouvel essai toutes les 2 minutes.'
          );
        }
        if (!club) etat.statut = r.statut;
        return false;
      }
      const autre = club && club.id !== r.club.id;
      if (!club || autre) {
        ctx.log.ok(
          'Club trouvé chez EA : ' +
            r.club.nom +
            ' (identifiant ' +
            r.club.id +
            (nomDivision(r.club.division) ? ', ' + nomDivision(r.club.division) : '') +
            ').'
        );
      }
      if (autre) {
        // Meme nom, autre club (recree ?) : les matchs retenus etaient ceux de l'ancien.
        matchs.length = 0;
        srs.length = 0;
        suivi = null;
      }
      if (club && !autre && club.division !== r.club.division && r.club.division) {
        ctx.log.ok('Division : ' + nomDivision(r.club.division) + '.');
      }
      club = { ...r.club, luA: Date.now() };
      sauver();
      return true;
    };

    // Le nom d'un adversaire connu par son seul identifiant (match compte
    // d'apres le bilan). Sans lui, le match compte quand meme.
    const nomDuClub = async (id) => {
      try {
        const r = await ea.info(id);
        return String(r?.[id]?.name ?? '').trim();
      } catch {
        return '';
      }
    };

    const elaguer = () => {
      const limite = Date.now() - GARDER_MS;
      const gardes = matchs
        .filter((m) => m.a >= limite)
        .sort((x, y) => x.a - y.a)
        .slice(-GARDER_MAX);
      matchs.splice(0, matchs.length, ...gardes);
    };

    const tour = async () => {
      if (!club) {
        if (derniereRecherche && Date.now() - derniereRecherche < RECHERCHE_MS) return;
        if (!(await lireClub())) return;
      } else if (Date.now() - club.luA > RAFRAICHIR_CLUB_MS) {
        // En plus : une recherche ratee n'empeche pas de lire les matchs.
        await lireClub().catch(() => {});
      }

      // L'historique : le detail des matchs, quand EA le publie.
      const publies = [];
      for (const type of types) {
        const liste = await ea.matchs(club.id, type);
        for (const brut of Array.isArray(liste) ? liste : []) {
          const m = analyserMatch(brut, club.id, type);
          if (m && !matchs.some((x) => x.id === m.id) && !publies.some((x) => x.id === m.id)) {
            publies.push(m);
          }
        }
      }
      etat.statut = 'pret';
      etat.message = '';
      etat.derniereLecture = Date.now();

      // Le bilan du club, a chaque tour. Il est en plus : une lecture ratee ne
      // fait pas perdre les matchs.
      const lu = lireBilan(await ea.stats(club.id).catch(() => null));
      const maintenant = Date.now();

      // Les matchs qui entrent dans le bilan de la soiree (compteurs, journal)
      // et ceux dont le detail vient d'arriver (de quoi faire une carte).
      const comptes = [];
      const detailles = [];

      publies.sort((x, y) => x.a - y.a);
      for (const m of publies) {
        const p = provisoireDe(matchs, m);
        if (p) {
          // Deja compte d'apres le bilan : son detail arrive enfin, il prend
          // sa place sans compter deux fois.
          matchs.splice(matchs.indexOf(p), 1);
          m.auBilan = true;
          m.ecartSr = p.ecartSr ?? null;
          if (!premierTour) ctx.log.info('Détail publié par EA : ' + libelleMatch(m) + '.');
        } else {
          comptes.push(m);
        }
        matchs.push(m);
        detailles.push(m);
      }

      // Le bilan : les matchs joues depuis sa lecture precedente. Chacun est
      // rattache a son match de l'historique ; celui qu'EA n'a pas publie est
      // compte quand meme, sans score ni joueurs. Une lecture trop ancienne
      // (StreamKit ferme, EA en panne) ne dit plus quand ils ont ete joues :
      // on repart de celle-ci.
      if (lu) {
        const avant = suivi && maintenant - suivi.a <= pauseMs ? suivi : null;
        const lignes = avant ? nouveauxDuBilan(avant, lu) : [];
        // Un seul match entre deux lectures : l'ecart de skill rating est le sien.
        const ecart = lignes.length === 1 && avant.sr && lu.sr ? lu.sr - avant.sr : null;
        for (const [i, ligne] of lignes.entries()) {
          const publie = matchDuBilan(matchs, ligne, { depuis: avant.a, jusqua: maintenant });
          if (publie) {
            publie.auBilan = true;
            if (ecart != null) publie.ecartSr = ecart;
            continue;
          }
          const p = {
            id: 'bilan-' + maintenant + '-' + i,
            provisoire: true,
            auBilan: true,
            // Son heure de fin est inconnue : entre les deux lectures du bilan.
            a: maintenant - (lignes.length - i) * 1000,
            depuis: avant.a,
            type: 'championnat',
            resultat: ligne.resultat,
            buts: null,
            encaisses: null,
            abandon: false,
            adversaireId: ligne.adversaireId,
            adversaire: await nomDuClub(ligne.adversaireId),
            dureeS: 0,
            joueurs: [],
            ecartSr: ecart,
          };
          matchs.push(p);
          comptes.push(p);
        }
        // Le skill rating : celui d'avant la soiree (premier tour), puis a
        // chaque changement.
        if (lu.sr && (premierTour || lu.sr !== srs.at(-1)?.valeur)) {
          srs.push({ a: Date.now(), valeur: lu.sr });
          while (srs.length > 60) srs.shift();
        }
        if (lu.joues != null)
          suivi = { joues: lu.joues, v: lu.v, n: lu.n, d: lu.d, sr: lu.sr, a: maintenant };
      }

      if (!comptes.length && !detailles.length) {
        premierTour = false;
        // Le bilan lu doit survivre a un redemarrage, sans ecrire a chaque minute.
        if (Date.now() - sauveA > SAUVER_SUIVI_MS) sauver();
        return;
      }
      comptes.sort((x, y) => x.a - y.a);
      detailles.sort((x, y) => x.a - y.a);
      elaguer();
      sauver();

      // Premier tour : ce qu'EA avait deja (StreamKit lance en cours de soiree,
      // ou premiere installation). Repris sans carte ni compteur.
      if (premierTour) {
        premierTour = false;
        const deCeSoir = soiree().filter((m) => comptes.includes(m)).length;
        if (deCeSoir) ctx.log.info(deCeSoir + ' match(s) de la soirée en cours retrouvé(s) chez EA.');
        return;
      }

      for (const m of comptes) {
        ctx.compteur.incr(COMPTEURS[m.resultat]);
        ctx.log.ok(
          libelleMatch(m) +
            (m.provisoire
              ? ' — compté d’après le bilan du club : EA n’a pas publié le détail du match.'
              : ' — compté.')
        );
      }
      // Une montee de division se voit sur la carte de ce match.
      if (comptes.some((m) => m.type !== 'amical')) await lireClub().catch(() => {});
      // La carte du dernier match detaille, s'il est toujours le plus recent : un
      // detail publie tres en retard, apres d'autres matchs, ne repasse pas a
      // l'ecran.
      const dernier = detailles.at(-1);
      const plusRecent = [...matchs].sort((x, y) => x.a - y.a).at(-1);
      if (dernier && dernier === plusRecent && Date.now() - dernier.a <= pauseMs) montrerCarte(dernier);
    };

    let enCours = false;
    let derniereErreur = '';
    const tourProtege = async () => {
      if (enCours) return;
      enCours = true;
      try {
        await tour();
        derniereErreur = '';
      } catch (e) {
        const message = messageErreur(e, moteur);
        etat.statut = 'erreur';
        etat.message = message;
        // Une erreur qui se repete chaque minute noierait le journal.
        if (message !== derniereErreur) {
          derniereErreur = message;
          ctx.log.warn('EA : ' + message);
        }
      } finally {
        enCours = false;
        pousser();
      }
    };

    // --- Pour la vue d'ensemble et les actions -------------------------------

    ctx._etatFC = () => {
      const s = soiree();
      const b = bilan(s);
      return {
        statut: etat.statut,
        message: etat.message,
        nom: String(c.club).trim(),
        club: club?.nom ?? '',
        division: nomDivision(club?.division),
        v: b.v,
        n: b.n,
        d: b.d,
        matchsDeLaSoiree: s.length,
        dernierMatchA: s.at(-1)?.a ?? null,
        dernierSansDetail: !!s.at(-1)?.provisoire,
        sansDetail: s.filter((m) => m.provisoire).length,
        bilanEA: suivi ? suivi.joues + ' matchs de championnat, lu à ' + heure(suivi.a) : 'jamais lu',
        derniereLecture: etat.derniereLecture ? heure(etat.derniereLecture) : 'jamais',
        matchsRetenus: matchs.length,
      };
    };

    ctx._exemple = () => {
      exempleJusqua = Date.now() + DUREE_EXEMPLE_MS;
      pousser();
      ctx.minuteur.delai(pousser, DUREE_EXEMPLE_MS + 100);
    };

    // Le dernier match dont EA a publie le detail : les autres n'ont pas de carte.
    ctx._revoirCarte = () => {
      const dernier = matchs
        .filter((m) => !m.provisoire)
        .sort((x, y) => x.a - y.a)
        .at(-1);
      if (!dernier) return false;
      montrerCarte(dernier);
      return true;
    };

    ctx._nouvelleSoiree = () => {
      reinitA = Date.now();
      carte = { match: null, jusqua: 0 };
      sauver();
      pousser();
      ctx.log.ok('Nouvelle soirée : le bilan repart de zéro.');
      return heure(reinitA);
    };

    // « Chercher le club chez EA » vient de le trouver : pas la peine
    // d'attendre la prochaine recherche programmee.
    ctx._relancer = () => {
      if (club) return;
      derniereRecherche = 0;
      tourProtege();
    };

    pousser();
    ctx.minuteur.intervalle(tourProtege, TOUR_MS);
    // Le premier tour tout de suite, sans attendre une minute.
    tourProtege();

    ctx.log.ok('Prêt. Les matchs du club « ' + String(c.club).trim() + ' » arrivent quand EA les publie.');
    ctx.log.info('Overlays : ' + VUES.map((v) => ctx.overlay.url(v)).join(', '));

    return {
      async arreter() {
        sauver();
      },
    };
  },
};
