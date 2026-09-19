// Ce que le dashboard montre de l'etat des connexions : la vue d'ensemble
// (sante) et l'ecran Connecteurs (etatConnecteurs).
//
// Sorti de noyau.js (audit U3). Ces deux vues ne font que LIRE -- Twitch, les
// modules, les connecteurs, les sources OBS branchees -- et c'est pourtant la
// qu'etait la logique la plus fine du noyau : quel etat afficher, quelle aide
// proposer, quelle carte d'un module remplace celle du socle. Elle n'avait aucun
// test, parce qu'on ne pouvait l'atteindre qu'en demarrant un noyau entier.
//
// Tout ce qui bouge est donc INJECTE par le noyau : registre, twitch,
// connecteurs, diffusion, compteurs, les contextes de modules et l'etat du
// live. Un test fournit les siens, sans Twitch ni OBS. Ce qui ne fait que lire
// un fichier ou calculer (store, auth, maj) est importe normalement.

import * as categories from './categories.js';
import * as store from './store.js';
import * as auth from './auth.js';
import * as maj from './maj.js';

// Duree pendant laquelle on reutilise la sante declaree par un module (voir
// plus bas pourquoi).
export const FRAICHEUR_SANTE_MS = 20000;

// Du plus grave au plus calme. Sert a resumer plusieurs lignes en un seul etat
// de carte. « inactif » est le plus bas : ce n'est pas une panne, juste un
// module qu'on n'a pas encore lance.
const GRAVITE = { ko: 3, attention: 2, ok: 1, inactif: 0 };

// Ce que le streamer lit du lien avec Twitch. Les deux canaux sont
// INDEPENDANTS : le chat peut tourner pendant qu'EventSub se reconnecte (les
// points de chaine ne repondent plus, mais les commandes si). Un « tout va
// bien » global l'aurait envoye chercher ailleurs.
export function canauxTwitch(t) {
  if (t.chatConnecte && t.eventsubConnecte) return 'chat et EventSub connectés';
  if (!t.chatConnecte && !t.eventsubConnecte) return 'connexion en cours…';
  return t.chatConnecte ? 'chat connecté, EventSub en attente' : 'EventSub connecté, chat en reconnexion';
}

// Decompte des modules pour les bandeaux du dashboard.
//
// Un module de developpement ne compte que s'il est active : sinon le dashboard
// annoncerait « 5 modules » en n'en affichant que 4.
export function resumeModules(registre) {
  const vus = registre.liste().filter((m) => !m.manifeste.developpement || m.actif);
  return {
    total: vus.length,
    actifs: vus.filter((m) => m.actif).length,
    demarres: vus.filter((m) => m.etat === 'demarre').length,
    enErreur: vus.filter((m) => m.etat === 'erreur' || m.etat === 'incomplet').length,
  };
}

// Les modules qui declarent avoir besoin d'un connecteur.
const modulesDuConnecteur = (registre, id) =>
  registre.liste().filter((m) => (m.manifeste.connecteurs ?? []).includes(id));

export function creerSante({
  registre,
  twitch,
  connecteurs,
  diffusion,
  compteurs,
  port,
  // Le contexte d'un module demarre : sa fonction sante() le recoit.
  contexteDe = () => undefined,
  // Tenu a jour par le noyau, qui suit les debuts et fins de live.
  etatDirect = { enCours: false, depuis: null },
}) {
  // Derniere sante connue de chaque module : id -> { a: horodatage, cartes }
  const santeModules = new Map();

  // --- Ecran Connecteurs ----------------------------------------------------
  // Identifiants d'application ET autorisation de compte, au meme endroit pour
  // tous les services. Twitch y figure aussi, meme si son flux reste dans
  // core/auth.js.
  function etatConnecteurs() {
    const t = twitch.getEtat();
    const appTwitch = store.lireTokens().twitchApp ?? {};
    const manquants = twitch.droitsManquants(registre.scopesRequis({ tousLesModules: true }));

    const liste = [
      {
        id: 'twitch',
        nom: 'Twitch',
        icone: '🟣',
        description: 'Chat, points de chaîne, clips. Nécessaire à la plupart des modules.',
        consoleUrl: 'https://dev.twitch.tv/console/apps/create',
        urlDeRetour: auth.urlDeRetour(port),
        configure: !!(appTwitch.clientId && appTwitch.clientSecret),
        connecte: t.pret,
        compte: t.channel || '',
        detail: t.pret
          ? canauxTwitch(t) + (manquants.length ? ' — ' + manquants.length + ' droit(s) à renouveler' : '')
          : t.raison || 'non connecté',
        etat: !t.pret ? (appTwitch.clientId ? 'ko' : 'inactif') : manquants.length ? 'attention' : 'ok',
        etapes: [
          'Ouvre la console développeur Twitch et connecte-toi.',
          // Twitch refuse un nom d'application deja pris, tous comptes
          // confondus : « StreamKit » tout court ne passe qu'une fois.
          'Nom : StreamKit-tonpseudo (Twitch refuse un nom déjà pris) — Catégorie : Chat Bot.',
          'URL de redirection OAuth : colle l’adresse ci-dessous, exactement.',
          'Valide, puis récupère l’ID client et génère un secret client.',
        ],
        // Le nom de chaîne fait partie de la configuration Twitch, pas d'une
        // application : c'est le seul connecteur qui en demande un.
        champChaine: store.getConfig().twitch.channel || '',
      },
    ];

    for (const c of connecteurs.catalogue()) {
      const e = connecteurs.pour(c.id);
      liste.push({
        id: c.id,
        nom: c.nom,
        icone: c.icone,
        description: c.description,
        consoleUrl: c.consoleUrl,
        urlDeRetour: connecteurs.urlDeRetour(c.id, port),
        // Le dashboard en a besoin pour ne PAS reclamer de secret client a un
        // connecteur qui n'en utilise plus.
        pkce: connecteurs.estPkce(c),
        configure: e.configure,
        connecte: e.connecte,
        compte: e.compte,
        detail: e.connecte
          ? e.compte || 'connecté'
          : e.configure
            ? 'application enregistrée, compte non autorisé'
            : 'non configuré',
        etat: e.connecte ? 'ok' : e.configure ? 'attention' : 'inactif',
        etapes: c.etapes,
        // Un connecteur n'est réclamé que si un module le demande : inutile de
        // faire configurer Spotify à quelqu'un qui ne veut que la roue.
        demandePar: modulesDuConnecteur(registre, c.id).map((m) => m.manifeste.nom),
      });
    }

    return liste;
  }

  // --- Vue d'ensemble des connexions ----------------------------------------
  // Ce qu'on regarde avant de partir en live. Le socle sait deja beaucoup :
  // Twitch, les sources OBS branchees sur nos overlays, les mises a jour.
  // Chaque module ajoute les siennes via sante() dans son manifeste -- Spotify
  // pour le bot musique, le Riot Client pour Valorant.
  async function sante() {
    const connexions = [];

    // --- Twitch ---
    const t = twitch.getEtat();
    const manquants = twitch.droitsManquants(registre.scopesRequis());
    if (!t.pret) {
      connexions.push({
        id: 'twitch',
        nom: 'Twitch',
        etat: store.lireTokens().twitchApp?.clientId ? 'ko' : 'inactif',
        detail: t.raison || 'non connecté',
        // Twitch sait parfois quoi faire : reseau a verifier (il retente seul),
        // chaine a reconnecter...
        aide: t.conseil || 'Clique sur l’indicateur Twitch en haut de la fenêtre.',
      });
    } else if (manquants.length) {
      connexions.push({
        id: 'twitch',
        nom: 'Twitch',
        etat: 'attention',
        detail: t.channel + ' — ' + manquants.length + ' droit(s) manquant(s)',
        aide: 'Reconnecte ta chaîne : ' + manquants.join(', '),
      });
    } else {
      connexions.push({
        id: 'twitch',
        nom: 'Twitch',
        etat: t.chatConnecte ? 'ok' : 'attention',
        detail: t.channel + ' — ' + canauxTwitch(t),
      });
    }

    // --- OBS : combien de sources ecoutent nos overlays ---
    // On ne parle pas a OBS, mais un overlay branche PROUVE qu'il tourne. C'est
    // la vraie question du streamer : « ma source est-elle en place ? »
    const vues = [];
    let total = 0;
    for (const m of registre.liste()) {
      for (const o of m.manifeste.overlays ?? []) {
        const n = diffusion.nbClients('overlay:' + m.id + ':' + o.chemin);
        total += n;
        if (n) vues.push(m.manifeste.nom + ' › ' + o.nom + ' (' + n + ')');
      }
    }
    connexions.push({
      id: 'obs',
      nom: 'OBS',
      etat: total ? 'ok' : 'inactif',
      detail: total ? total + ' source(s) connectée(s)' : 'aucune source connectée',
      aide: total ? vues.join(' · ') : 'Ajoute les overlays de tes modules en source Navigateur.',
    });

    // --- Connecteurs : Spotify & co, meme quand aucun module ne tourne ---
    // Un connecteur se configure au niveau du socle : son etat ne depend pas
    // d'un module demarre. Sans cette boucle, « est-ce que Spotify est branche ? »
    // n'avait de reponse qu'une fois le bot musique allume -- exactement
    // l'inverse de ce qu'on vient verifier avant un live.
    for (const c of connecteurs.catalogue()) {
      const requis = modulesDuConnecteur(registre, c.id);
      // Personne ne s'en sert : pas la peine d'encombrer l'ecran.
      if (!requis.length) continue;

      const e = connecteurs.pour(c.id);
      connexions.push({
        id: c.id,
        nom: c.nom,
        // Pas connecte n'est pas une panne : un streamer qui n'utilise pas le
        // bot musique n'a aucune raison d'avoir Spotify branche.
        etat: e.connecte ? 'ok' : 'inactif',
        detail: e.connecte
          ? e.compte || 'connecté'
          : e.configure
            ? 'application enregistrée, autorisation à donner'
            : 'non configuré',
        aide: e.connecte
          ? 'Utilisé par : ' + requis.map((m) => m.manifeste.nom).join(', ')
          : e.configure
            ? 'Écran Connecteurs → carte ' + c.nom + ' → Connecter.'
            : 'Écran Connecteurs : renseigne ton application ' + c.nom + '.',
      });
    }

    // Cartes fusionnees des categories `carteUnique` : id de categorie -> carte
    // deja posee dans `connexions`, que la boucle ci-dessous remplit ligne a
    // ligne.
    const groupes = new Map();

    // --- Modules : chacun declare ses propres connexions ---
    //
    // Ces sante() parlent au RESEAU : celle du bot musique demande a Spotify
    // quel appareil joue. Le dashboard, lui, rafraichit toutes les 5 s --
    // dashboard ouvert, ca faisait douze appels Spotify par minute pour une
    // information qui ne bouge pas si vite, et qui compte surtout au moment ou
    // on verifie son installation avant un live. On garde donc la derniere
    // reponse quelques secondes.
    for (const m of registre.liste()) {
      if (typeof m.manifeste.sante !== 'function') continue;
      // Un module arrete n'a pas de contexte : inutile de l'interroger.
      if (m.etat !== 'demarre') continue;

      const connu = santeModules.get(m.id);
      let cartes;
      if (connu && Date.now() - connu.a < FRAICHEUR_SANTE_MS) {
        cartes = connu.cartes;
      } else {
        try {
          cartes = (await m.manifeste.sante(contexteDe(m.id))) ?? [];
        } catch (e) {
          // Un module qui repond mal ne doit pas etre reinterroge en boucle : on
          // met son echec en cache comme le reste.
          cartes = [
            {
              id: m.id + ':sante',
              nom: m.manifeste.nom,
              etat: 'ko',
              detail: 'état illisible',
              aide: e?.message || String(e),
            },
          ];
        }
        santeModules.set(m.id, { a: Date.now(), cartes });
      }

      const categorie = categories.resoudre(m.manifeste.categorie);

      for (const c of cartes) {
        const enrichi = { ...c, module: m.manifeste.nom };

        // Un jeu est un sujet, pas deux : les categories `carteUnique` fondent
        // les cartes de leurs modules en une seule, une ligne par module. Sans
        // ca, League of Legends occupait deux cartes voisines -- « suivi de
        // session » et « partie en cours » -- que le streamer devait rapprocher
        // du regard pour savoir ou en etait son jeu.
        if (categorie.carteUnique) {
          const groupe = groupes.get(categorie.id);
          // Le nom de la ligne est celui du MODULE : sous le titre « League of
          // Legends », « Suivi de session » dit ce que la ligne raconte. Un
          // module qui declare plusieurs cartes garde les noms de ses cartes,
          // sinon elles seraient indiscernables.
          const ligne = {
            nom: cartes.length > 1 ? c.nom : m.manifeste.nom,
            etat: c.etat,
            detail: c.detail || '',
            aide: c.aide || '',
          };
          if (groupe) groupe.lignes.push(ligne);
          else {
            const carte = {
              id: 'categorie:' + categorie.id,
              nom: categorie.label,
              etat: c.etat,
              lignes: [ligne],
            };
            groupes.set(categorie.id, carte);
            // A la place de la premiere carte du groupe : l'ordre de l'ecran ne
            // depend pas de l'ordre d'allumage des modules.
            connexions.push(carte);
          }
          continue;
        }

        // Un module qui tourne en sait plus que le socle sur son connecteur --
        // l'appareil Spotify actif, par exemple. Sa version remplace la carte
        // generique, a la meme place, au lieu de doubler avec elle.
        const i = connexions.findIndex((x) => x.id === enrichi.id);
        if (i >= 0) connexions[i] = enrichi;
        else connexions.push(enrichi);
      }
    }

    // Une carte de groupe porte le PIRE etat de ses lignes : une panne ne se
    // cache pas derriere un module qui va bien. L'aide montree est celle de
    // cette ligne -- c'est elle qu'il faut lire en premier.
    for (const groupe of groupes.values()) {
      const pire = groupe.lignes.reduce((a, l) => (GRAVITE[l.etat] > GRAVITE[a.etat] ? l : a));
      groupe.etat = pire.etat;
      groupe.aide = pire.aide || groupe.lignes.find((l) => l.aide)?.aide || '';
      // Un seul module allume : une liste d'une ligne n'apprend rien de plus
      // qu'une carte ordinaire, et en dit meme moins (pas de pastille de
      // provenance). On revient donc a la carte ordinaire.
      if (groupe.lignes.length === 1) {
        groupe.detail = groupe.lignes[0].detail;
        groupe.module = groupe.lignes[0].nom;
        delete groupe.lignes;
      }
    }

    // --- Compteurs d'usage ---
    // Un module qui declare `compteurs: { cle: 'Libelle' }` voit ses chiffres
    // remonter ici. On les expose meme module arrete : « 0 clip ce live » reste
    // une information, et l'historique ne disparait pas parce qu'on a decoche
    // une case.
    const kpis = [];
    for (const m of registre.liste()) {
      const libelles = m.manifeste.compteurs;
      if (!libelles) continue;
      const { total: totaux, session } = compteurs.pour(m.id);
      kpis.push({
        module: m.manifeste.nom,
        icone: m.manifeste.icone ?? '🧩',
        actif: m.etat === 'demarre',
        valeurs: Object.entries(libelles).map(([cle, label]) => ({
          cle,
          label,
          session: session[cle] || 0,
          total: totaux[cle] || 0,
        })),
      });
    }

    const { total: modulesVus, demarres, enErreur } = resumeModules(registre);
    return {
      connexions,
      kpis,
      depuis: compteurs.debutSession(),
      causeSession: compteurs.causeSession(),
      enDirect: etatDirect.enCours,
      directDepuis: etatDirect.depuis,
      version: maj.versionActuelle(),
      modules: { total: modulesVus, demarres, enErreur },
    };
  }

  return {
    sante,
    etatConnecteurs,
    // Un module arrete : ce qu'on savait de sa sante ne vaut plus rien.
    oublier: (id) => santeModules.delete(id),
  };
}
