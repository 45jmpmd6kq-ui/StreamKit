// Ce qui merite une animation, d'apres le flux de l'API de stats.
//
// Deux moments, style C (choisi par le user sur maquettes) : une annonce, puis
// une pastille qui reste.
//   - GAME DE CHAUFFE : au premier coup d'envoi de la premiere partie d'une
//     session de jeu. La pastille reste jusqu'a la fin de cette partie.
//   - OVERTIME : des que la prolongation commence. La pastille reste jusqu'au
//     but en or (ou la fin de la partie).
//
// « Session de jeu » = la premiere partie apres TROIS HEURES sans jouer. Pas le
// lancement de StreamKit : une mise a jour le relance en plein live, et la
// partie suivante serait annoncee comme une chauffe. Le bouton « Rearmer »
// couvre le reste (deux lives le meme apres-midi).
//
// Une partie ne compte qu'avec au moins deux joueurs : l'entrainement libre
// n'a pas d'adversaire, et une chauffe consommee a l'entrainement priverait le
// premier vrai match de son annonce.
//
// Pur : ni horloge ni reseau, pour rejouer une soiree en test.

export const PAUSE_SESSION_MS = 3 * 3600 * 1000;

// Le jeu envoie les deux a chaque engagement ; le premier des deux suffit.
const COUPS_ENVOI = new Set(['CountdownBegin', 'RoundStarted']);

// memoire : { derniereActiviteA, rearme }, gardee d'un lancement a l'autre.
// recevoir(message) -> [{ type }] : 'chauffe' | 'finChauffe' | 'overtime' | 'finOvertime'
export function creerDetecteur({ memoire = {}, maintenant = Date.now, pauseMs = PAUSE_SESSION_MS } = {}) {
  const m = {
    derniereActiviteA: Number(memoire.derniereActiviteA) || 0,
    rearme: memoire.rearme === true,
  };
  let enReplay = false;
  let partie = null;

  const arme = () => m.rearme || maintenant() - m.derniereActiviteA >= pauseMs;

  function ouvrir() {
    partie = {
      joueurs: 0,
      coupEnvoi: false,
      chauffeAttendue: false,
      chauffe: false,
      overtime: false,
      overtimeFini: false,
      finie: false,
    };
  }

  function fermer(sorties) {
    if (!partie || partie.finie) return;
    partie.finie = true;
    if (partie.chauffe) sorties.push({ type: 'finChauffe' });
    if (partie.overtime && !partie.overtimeFini) sorties.push({ type: 'finOvertime' });
    // Seule une vraie partie repousse la prochaine chauffe.
    if (partie.coupEnvoi && partie.joueurs >= 2) m.derniereActiviteA = maintenant();
  }

  function recevoir({ evenement, data } = {}) {
    const sorties = [];

    // Un replay ouvert depuis l'historique rejoue toute une partie : rien ne
    // compte jusqu'a sa fermeture. (Les ralentis de but ne passent pas par la.)
    if (evenement === 'ReplayCreated') {
      fermer(sorties);
      partie = null;
      enReplay = true;
      return sorties;
    }
    if (evenement === 'MatchDestroyed') {
      if (!enReplay) fermer(sorties);
      partie = null;
      enReplay = false;
      return sorties;
    }
    if (enReplay) return sorties;

    if (evenement === 'MatchCreated' || evenement === 'MatchInitialized') {
      if (!partie || partie.finie) ouvrir();
      return sorties;
    }
    if (evenement === 'MatchEnded') {
      fermer(sorties);
      return sorties;
    }

    if (!partie) {
      // StreamKit lance en pleine partie : elle s'ouvre a la volee. Le podium
      // d'une partie qu'on n'a pas vue commencer, lui, n'ouvre rien.
      if (evenement !== 'UpdateState' || data?.Game?.bHasWinner) return sorties;
      ouvrir();
    }
    if (partie.finie) return sorties; // podium : les UpdateState continuent

    if (evenement === 'UpdateState' && Array.isArray(data?.Players)) {
      partie.joueurs = Math.max(partie.joueurs, data.Players.length);
    }

    // Le premier engagement vu. En prolongation (StreamKit lance en pleine
    // partie), il est trop tard pour une chauffe.
    if (COUPS_ENVOI.has(evenement) && !partie.coupEnvoi) {
      partie.coupEnvoi = true;
      partie.chauffeAttendue = !partie.overtime && arme();
    }

    // Game.bOvertime dans UpdateState, bOvertime dans ClockUpdatedSeconds.
    const overtime =
      data?.Game?.bOvertime === true || (evenement === 'ClockUpdatedSeconds' && data?.bOvertime === true);
    if (overtime && !partie.overtime) {
      partie.overtime = true;
      // Une chauffe pas encore annoncee n'a plus de sens en prolongation.
      partie.chauffeAttendue = false;
      sorties.push({ type: 'overtime' });
    }

    // Decidee au coup d'envoi, annoncee des qu'on sait qu'il y a un adversaire.
    if (partie.chauffeAttendue && partie.joueurs >= 2) {
      partie.chauffeAttendue = false;
      partie.chauffe = true;
      m.rearme = false;
      m.derniereActiviteA = maintenant();
      sorties.push({ type: 'chauffe' });
    }

    if (evenement === 'GoalScored' && partie.overtime && !partie.overtimeFini) {
      partie.overtimeFini = true;
      sorties.push({ type: 'finOvertime' });
    }
    return sorties;
  }

  return {
    recevoir,
    rearmer() {
      m.rearme = true;
    },
    arme,
    enChauffe: () => !!partie && partie.chauffe && !partie.finie,
    enOvertime: () => !!partie && partie.overtime && !partie.overtimeFini && !partie.finie,
    memoire: () => ({ ...m }),
  };
}
