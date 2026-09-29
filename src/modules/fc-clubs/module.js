// Soiree Clubs (EA SPORTS FC 27) : le bilan de la soiree en direct, une carte
// apres chaque match, les trophees de fin de soiree.
//
// Source : l'API Clubs d'EA (voir ea.js), celle du site des clubs. Rien n'est
// lu dans le jeu, et tout arrive APRES le coup de sifflet final, quand EA publie
// le match : il n'existe aucune donnee en direct (pas d'equivalent de l'API de
// Rocket League ou de celle du client LoL).
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
import { bilan, matchsDeLaSoiree } from './soiree.js';
import { vueBandeau, vueCarte, vueClub, vueTableau } from './vue.js';
import { CLUB_DEMO, SR_DEMO, soireeDemo } from './demo.js';

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

const VUES = ['bandeau', 'carte', 'tableau'];
const COULEUR_DEFAUT = '#3b7bff';
const TYPES_LIBELLES = { championnat: 'championnat', playoffs: 'playoffs', amical: 'amical' };
const RESULTATS = { V: 'Victoire', N: 'Nul', D: 'Défaite' };
const COMPTEURS = { V: 'victoires', N: 'nuls', D: 'defaites' };

const heure = (ms) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

const cleDuClub = (c) =>
  String(c.clubId ?? '').trim() +
  '|' +
  String(c.club ?? '')
    .trim()
    .toLocaleLowerCase('fr');

const libelleMatch = (m) =>
  RESULTATS[m.resultat] +
  ' ' +
  m.buts +
  '–' +
  m.encaisses +
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
        ? 'Dernier match publié par EA à ' + heure(e.dernierMatchA)
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
    const stocke = ctx.etat.lire({ cle, club: null, matchs: [], sr: [], reinitA: 0 });
    const memoire = stocke.cle === cle ? stocke : { club: null, matchs: [], sr: [], reinitA: 0 };
    let club = memoire.club ?? null;
    const matchs = Array.isArray(memoire.matchs) ? memoire.matchs : [];
    const srs = Array.isArray(memoire.sr) ? memoire.sr : [];
    let reinitA = Number(memoire.reinitA) || 0;
    const sauver = () => ctx.etat.sauver({ cle, club, matchs, sr: srs, reinitA });

    const pauseMs = c.pauseSoiree * 3600_000;
    const types =
      c.matchs === 'competition' ? ['championnat', 'playoffs'] : ['championnat', 'playoffs', 'amical'];
    const soiree = () => matchsDeLaSoiree(matchs, { pauseMs, reinitA });

    const etat = { statut: 'recherche', message: '', derniereLecture: 0 };
    let derniereRecherche = 0;
    let premierTour = true;

    // --- Overlays ------------------------------------------------------------

    let carte = { match: null, sr: null, jusqua: 0 };
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
            sr: carte.sr,
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

    const montrerCarte = (match, sr) => {
      carte = { match, sr, jusqua: Date.now() + c.dureeCarte * 1000 };
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
      }
      if (club && !autre && club.division !== r.club.division && r.club.division) {
        ctx.log.ok('Division : ' + nomDivision(r.club.division) + '.');
      }
      club = { ...r.club, luA: Date.now() };
      sauver();
      return true;
    };

    const lireSr = async () => {
      const stats = await ea.stats(club.id);
      const valeur = Number(stats?.[0]?.skillRating);
      if (!Number.isFinite(valeur) || valeur <= 0) return null;
      srs.push({ a: Date.now(), valeur });
      while (srs.length > 60) srs.shift();
      return valeur;
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

      const nouveaux = [];
      for (const type of types) {
        const liste = await ea.matchs(club.id, type);
        for (const brut of Array.isArray(liste) ? liste : []) {
          const m = analyserMatch(brut, club.id, type);
          if (m && !matchs.some((x) => x.id === m.id)) {
            matchs.push(m);
            nouveaux.push(m);
          }
        }
      }
      etat.statut = 'pret';
      etat.message = '';
      etat.derniereLecture = Date.now();

      // Le skill rating : au premier tour (celui d'avant la soiree, si elle n'a
      // pas commence), puis apres chaque match de competition. Il est en plus :
      // une lecture ratee ne fait pas perdre les matchs.
      const competition = nouveaux.filter((m) => m.type !== 'amical');
      let ecartSr = null;
      if (premierTour || competition.length) {
        const avant = srs.at(-1)?.valeur ?? null;
        const apres = await lireSr().catch(() => null);
        if (!premierTour && competition.length === 1 && avant != null && apres != null)
          ecartSr = apres - avant;
      }

      if (!nouveaux.length) {
        premierTour = false;
        return;
      }
      nouveaux.sort((x, y) => x.a - y.a);
      elaguer();
      sauver();

      // Premier tour : ce qu'EA avait deja (StreamKit lance en cours de soiree,
      // ou premiere installation). Repris sans carte ni compteur.
      if (premierTour) {
        premierTour = false;
        const deCeSoir = soiree().filter((m) => nouveaux.includes(m)).length;
        if (deCeSoir) ctx.log.info(deCeSoir + ' match(s) de la soirée en cours retrouvé(s) chez EA.');
        return;
      }

      for (const m of nouveaux) {
        ctx.compteur.incr(COMPTEURS[m.resultat]);
        ctx.log.ok(libelleMatch(m) + ' — compté.');
      }
      // Une montee de division se voit sur la carte de ce match.
      if (competition.length) await lireClub().catch(() => {});
      const dernier = nouveaux.at(-1);
      if (Date.now() - dernier.a <= pauseMs) montrerCarte(dernier, ecartSr);
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
        derniereLecture: etat.derniereLecture ? heure(etat.derniereLecture) : 'jamais',
        matchsRetenus: matchs.length,
      };
    };

    ctx._exemple = () => {
      exempleJusqua = Date.now() + DUREE_EXEMPLE_MS;
      pousser();
      ctx.minuteur.delai(pousser, DUREE_EXEMPLE_MS + 100);
    };

    ctx._revoirCarte = () => {
      const dernier = [...matchs].sort((x, y) => x.a - y.a).at(-1);
      if (!dernier) return false;
      montrerCarte(dernier, carte.match?.id === dernier.id ? carte.sr : null);
      return true;
    };

    ctx._nouvelleSoiree = () => {
      reinitA = Date.now();
      carte = { match: null, sr: null, jusqua: 0 };
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
