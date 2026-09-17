// Suivi des parties, un tour toutes les 2 secondes.
//
// Le parcours d'une partie classee :
//   1. le client passe en jeu      -> on note la partie et le rang d'AVANT ;
//   2. le client quitte le jeu      -> on guette la partie dans l'historique ;
//   3. elle y apparait              -> elle est comptee tout de suite (bilan,
//                                      serie), ses LP marques « en attente » ;
//   4. le classement bouge          -> LP = rang d'apres - rang d'avant.
//
// Pourquoi deux temps (3 puis 4) : le resultat et les LP n'arrivent pas au meme
// moment, et le bilan n'a aucune raison d'attendre les LP. Surtout, une defaite
// a 0 LP protegee ne fait JAMAIS bouger le classement : attendre les LP pour
// compter la defaite la ferait apparaitre trois minutes trop tard.
//
// Les LP viennent d'une soustraction de rangs plutot que d'un champ « LP gagnés »
// du client : ce champ n'est pas documente, et la difference de rang donne le
// bon chiffre promotion comprise (voir rang.js).
//
// Une partie manquee (StreamKit lance apres coup, historique trop lent) est
// rattrapee dans l'historique au tour suivant, sans ses LP : on ne sait plus
// quel etait le rang avant.
//
// Rien ici ne lit l'horloge ni le reseau directement : client et horloge sont
// injectes, ce qui permet de rejouer une soiree entiere en test, a la seconde pres.

import { ErreurClient } from './client.js';
import { FILES, extraireRang, echelle } from './rang.js';
import { jeux, extraireResultat, participation } from './partie.js';
import { ajouter } from './session.js';

// Phases ou une partie est reellement lancee. La selection des champions n'en
// est pas : on peut encore y esquiver, et rien ne serait joue.
export const PHASES_JEU = new Set(['GameStart', 'InProgress', 'Reconnect']);

export const DELAIS = {
  classement: 30_000, // rang, en temps normal
  classementAttente: 5_000, // rang, quand on attend les LP d'une partie finie
  historique: 5_000, // recherche de la partie finie dans l'historique
  lpMax: 180_000, // passe ce delai, les LP ne viendront plus
  resultatMax: 300_000, // passe ce delai, la partie ne sera jamais dans l'historique
  synchro: 60_000, // rattrapage des parties manquees
};

const rangCompact = (r) => (r ? { palier: r.palier, division: r.division, lp: r.lp } : null);

// Ce qu'on garde d'un resultat dans l'historique du module.
const statsPartie = (r) => ({
  victoire: r.victoire,
  championId: r.championId,
  k: r.k,
  d: r.d,
  a: r.a,
  cs: r.cs,
  dureeS: r.dureeS,
  vision: r.vision,
  kp: r.kp,
});

export function creerSuivi({
  client,
  file = 'solo',
  parties,
  depuis,
  maintenant = Date.now,
  delais = DELAIS,
  surClient = () => {},
  surPartie = () => {},
  surLp = () => {},
  surIgnoree = () => {},
  surDemarrage = () => {},
}) {
  const q = FILES[file] ?? FILES.solo;

  const etat = {
    clientOuvert: false,
    statut: 'demarrage', // 'demarrage' | 'client_ferme' | 'pret' | 'erreur'
    message: '',
    phase: '',
    moi: null,
    rang: null,
    enCours: null,
  };

  let signature = '';
  let classementA = 0;
  let synchroA = 0;

  function fermer(message) {
    if (etat.clientOuvert) surClient(false);
    etat.clientOuvert = false;
    etat.statut = 'client_ferme';
    etat.message = message;
    etat.phase = '';
    etat.moi = null;
  }

  async function identifier() {
    const inv = await client.invocateur();
    if (!inv?.puuid && !inv?.summonerId) return false;
    etat.moi = {
      puuid: String(inv.puuid || ''),
      summonerId: Number(inv.summonerId) || 0,
      accountId: Number(inv.accountId) || 0,
      nom: String(inv.gameName || inv.displayName || ''),
      tag: String(inv.tagLine || ''),
    };
    return true;
  }

  // --- 1. Debut de partie --------------------------------------------------

  async function debutPartie(t) {
    const s = await client.session();
    const gameId = Number(s?.gameData?.gameId) || 0;
    if (!gameId) return; // pas encore attribue (lancement) : tour suivant
    if (etat.enCours?.gameId === gameId) {
      // Reconnexion apres un plantage du jeu : la partie n'etait pas finie.
      if (!etat.enCours.partie) etat.enCours.finA = 0;
      return;
    }

    // Une nouvelle partie alors que la precedente n'est pas soldee : on garde
    // ce qu'on sait de la precedente, le rattrapage fera le reste.
    if (etat.enCours) solder(etat.enCours, t);
    if (parties.some((p) => p.id === gameId)) return; // StreamKit relance en pleine partie

    const queueId = Number(s?.gameData?.queue?.id) || 0;
    etat.enCours = {
      gameId,
      queueId,
      horsFile: queueId > 0 && queueId !== q.id,
      rangAvant: rangCompact(etat.rang),
      finA: 0,
      historiqueA: 0,
      partie: null,
    };
  }

  // --- 2 et 3. Fin de partie : le resultat ---------------------------------

  async function chercherResultat(e, t) {
    if (t - e.historiqueA < delais.historique) return;
    e.historiqueA = t;

    const jeu = jeux(await client.historique(10)).find((g) => Number(g?.gameId) === e.gameId);
    if (!jeu) {
      if (t - e.finA >= delais.resultatMax) {
        surIgnoree('partie introuvable dans l’historique du client');
        etat.enCours = null;
      }
      return;
    }

    let detail = null;
    try {
      detail = await client.partie(e.gameId);
    } catch {
      /* sans le detail, la participation reste inconnue : le reste compte */
    }
    const r = extraireResultat(jeu, etat.moi, detail);
    if (!r) {
      surIgnoree('joueur introuvable dans la partie');
      etat.enCours = null;
      return;
    }
    if (r.remake) {
      surIgnoree('partie refaite (remake)');
      etat.enCours = null;
      return;
    }
    if (r.queueId && r.queueId !== q.id) {
      surIgnoree('hors ' + q.nom);
      etat.enCours = null;
      return;
    }

    e.partie = {
      ...statsPartie(r),
      id: e.gameId,
      finA: e.finA,
      lp: null,
      lpEnAttente: echelle(e.rangAvant) != null,
      rangAvant: e.rangAvant,
      rangApres: null,
    };
    if (ajouter(parties, e.partie)) surPartie(e.partie);
  }

  // --- 4. Les LP --------------------------------------------------------------

  // forcer : on n'attendra pas plus (nouvelle partie, delai depasse).
  function completerLp(e, t, forcer = false) {
    const p = e.partie;
    const avant = echelle(e.rangAvant);
    const apres = echelle(etat.rang);

    if (avant == null) {
      // Placements ou non classe : aucun LP a attendre.
      p.rangApres = rangCompact(etat.rang);
    } else if (apres != null && apres !== avant) {
      p.lp = apres - avant;
      p.rangApres = rangCompact(etat.rang);
    } else if (forcer || t - e.finA >= delais.lpMax) {
      // Rien n'a bouge. Une defaite a 0 LP protegee coute 0 ; une victoire
      // rapporte toujours quelque chose, donc ses LP ne sont simplement jamais
      // arrives : inconnus plutot qu'un faux zero.
      p.lp = p.victoire ? null : 0;
      p.rangApres = p.victoire ? null : rangCompact(etat.rang);
    } else {
      return;
    }

    p.lpEnAttente = false;
    if (etat.enCours === e) etat.enCours = null;
    surLp(p);
  }

  function solder(e, t) {
    if (e.partie) completerLp(e, t, true);
    else if (etat.enCours === e) etat.enCours = null;
  }

  async function resoudre(t) {
    const e = etat.enCours;
    if (e.horsFile) {
      surIgnoree('hors ' + q.nom);
      etat.enCours = null;
      return;
    }
    if (!e.partie) await chercherResultat(e, t);
    if (etat.enCours === e && e.partie) completerLp(e, t);
  }

  // --- Rattrapage ------------------------------------------------------------

  async function synchroniser(t) {
    synchroA = t;
    const debut = depuis();
    for (const jeu of jeux(await client.historique(10))) {
      const id = Number(jeu?.gameId) || 0;
      if (!id || Number(jeu.queueId) !== q.id || parties.some((p) => p.id === id)) continue;

      const r = extraireResultat(jeu, etat.moi);
      if (!r || r.remake || !r.finA || r.finA < debut) continue;

      let kp = null;
      try {
        kp = participation(await client.partie(id), etat.moi);
      } catch {
        /* participation inconnue */
      }
      const partie = {
        ...statsPartie(r),
        id,
        finA: r.finA,
        kp,
        lp: null,
        lpEnAttente: false,
        rangAvant: null,
        rangApres: null,
        rattrapee: true,
      };
      if (ajouter(parties, partie)) surPartie(partie);
    }
  }

  // --- Le tour ---------------------------------------------------------------

  // Client ferme a n'importe quelle etape du tour (y compris entre deux appels) :
  // c'est un etat normal, pas une erreur. La partie en cours, elle, est gardee :
  // le client peut se rouvrir apres la fin du match.
  async function tour() {
    try {
      await tourOuvert();
    } catch (e) {
      if (e instanceof ErreurClient) return fermer(e.message);
      // Juste apres son lancement, le client repond deja mais ses services ne
      // sont pas charges : 404 ou 503 pendant quelques secondes. Ce n'est pas
      // une panne a signaler en rouge sur la vue d'ensemble.
      if (e?.status === 404 || e?.status === 503) {
        etat.statut = 'demarrage';
        etat.message = 'client en cours de démarrage';
        surDemarrage(e.message);
        return;
      }
      throw e;
    }
  }

  async function tourOuvert() {
    client.rafraichir();

    // Client relance : nouveau port, nouveau mot de passe, peut-etre un autre compte.
    if (client.signature() !== signature) {
      signature = client.signature();
      etat.moi = null;
      classementA = 0;
      synchroA = 0;
    }

    const phase = await client.phase();
    if (!etat.clientOuvert) {
      etat.clientOuvert = true;
      surClient(true);
    }
    etat.phase = typeof phase === 'string' ? phase : '';

    if (!etat.moi && !(await identifier())) {
      etat.statut = 'demarrage';
      etat.message = 'connexion au compte en cours';
      return;
    }

    const t = maintenant();
    const attente = !!etat.enCours?.finA;
    if (t - classementA >= (attente ? delais.classementAttente : delais.classement)) {
      etat.rang = extraireRang(await client.classement(), q.type);
      classementA = t;
    }

    if (PHASES_JEU.has(etat.phase)) await debutPartie(t);
    else if (etat.enCours && !etat.enCours.finA) etat.enCours.finA = t;

    if (etat.enCours?.finA) await resoudre(t);
    else if (!etat.enCours && t - synchroA >= delais.synchro) await synchroniser(t);

    etat.statut = 'pret';
    etat.message = '';
  }

  return { etat, tour };
}
