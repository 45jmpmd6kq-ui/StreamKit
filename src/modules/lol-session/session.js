// Ce que la session raconte : bilan, serie, LP, moyennes, courbe.
//
// Les parties comptees vivent dans l'etat persistant du module, horodatees a
// leur fin : la session est simplement « celles terminees depuis le debut de
// session ». Changer de mode, redemarrer StreamKit ou reinitialiser ne perd donc
// jamais l'historique, seulement la fenetre qu'on regarde.
//
// Tout est pur ici : ni horloge ni reseau. C'est ce qui permet de tester chaque
// regle d'affichage sans lancer League of Legends.

import { echelle, evolution, seuilsEntre, nomRang, depuisEchelle } from './rang.js';

export const MAX_PARTIES = 200;

// Phases du client pendant lesquelles on est « en partie » pour l'overlay. La
// selection des champions en fait partie : le tableau de bord doit s'effacer
// pour laisser voir les choix, le bandeau prend le relais.
export const PHASES_EN_PARTIE = new Set(['ChampSelect', 'GameStart', 'InProgress', 'Reconnect']);

// Debut de la session : lancement de StreamKit, ou minuit ; une remise a zero
// manuelle l'emporte si elle est plus recente.
export function debutSession({ mode = 'launch', lanceA, reinitA = 0, maintenant = Date.now() }) {
  let depart = lanceA;
  if (mode === 'day') {
    const minuit = new Date(maintenant);
    minuit.setHours(0, 0, 0, 0);
    depart = minuit.getTime();
  }
  return Math.max(depart, reinitA || 0);
}

// Une partie : { id, finA, victoire, championId, k, d, a, cs, dureeS, vision,
// kp, lp, lpEnAttente, rangAvant, rangApres }. `a` compte les assists : l'heure
// de fin s'appelle finA.
export function ajouter(parties, partie) {
  if (parties.some((p) => p.id === partie.id)) return false;
  parties.push(partie);
  parties.sort((x, y) => x.finA - y.finA);
  if (parties.length > MAX_PARTIES) parties.splice(0, parties.length - MAX_PARTIES);
  return true;
}

export function dansLaSession(parties, depuis) {
  return parties.filter((p) => p.finA >= depuis).sort((x, y) => x.finA - y.finA);
}

// -> { victoires, defaites, parties, winrate, lp, lpConnu, serie }
//   winrate : entier 0-100, ou null sans partie
//   lp      : somme des LP connus ; lpConnu dit s'il y en a au moins un
//   serie   : { victoire, n } sur les dernieres parties, ou null
export function bilan(joues) {
  const victoires = joues.filter((p) => p.victoire).length;
  const connus = joues.filter((p) => typeof p.lp === 'number');

  let serie = null;
  const derniere = joues[joues.length - 1];
  if (derniere) {
    let n = 0;
    for (let i = joues.length - 1; i >= 0 && joues[i].victoire === derniere.victoire; i--) n++;
    serie = { victoire: derniere.victoire, n };
  }

  return {
    victoires,
    defaites: joues.length - victoires,
    parties: joues.length,
    winrate: joues.length ? Math.round((victoires / joues.length) * 100) : null,
    lp: connus.reduce((t, p) => t + p.lp, 0),
    lpConnu: connus.length > 0,
    serie,
  };
}

// Moyennes de la session, ponderees par la duree pour ce qui se compte par
// minute : une partie de 40 minutes pese plus qu'une capitulation a 15.
export function moyennes(joues) {
  if (!joues.length) return null;
  const somme = (cle) => joues.reduce((t, p) => t + (Number(p[cle]) || 0), 0);
  const minutes = somme('dureeS') / 60;
  const avecKp = joues.filter((p) => typeof p.kp === 'number');

  return {
    kda: (somme('k') + somme('a')) / Math.max(1, somme('d')),
    csMin: minutes > 0 ? somme('cs') / minutes : null,
    visionMin: minutes > 0 ? somme('vision') / minutes : null,
    kp: avecKp.length ? Math.round(avecKp.reduce((t, p) => t + p.kp, 0) / avecKp.length) : null,
  };
}

export function ratioKda(p) {
  return ((Number(p.k) || 0) + (Number(p.a) || 0)) / Math.max(1, Number(p.d) || 0);
}

// La partie au meilleur KDA ; a egalite, celle qui a fait le plus de kills.
export function meilleurePartie(joues) {
  let meilleure = null;
  for (const p of joues) {
    if (
      !meilleure ||
      ratioKda(p) > ratioKda(meilleure) ||
      (ratioKda(p) === ratioKda(meilleure) && p.k > meilleure.k)
    ) {
      meilleure = p;
    }
  }
  return meilleure;
}

// Les champions joues, le plus joue d'abord ; a egalite, le plus gagnant.
export function championsJoues(joues) {
  const parId = new Map();
  for (const p of joues) {
    const c = parId.get(p.championId) ?? { championId: p.championId, parties: 0, victoires: 0 };
    c.parties++;
    if (p.victoire) c.victoires++;
    parId.set(p.championId, c);
  }
  return [...parId.values()]
    .map((c) => ({ ...c, defaites: c.parties - c.victoires }))
    .sort((a, b) => b.parties - a.parties || b.victoires - a.victoires);
}

// Promotion ou relegation sur l'ensemble de la session : premier rang connu
// avant une partie, dernier rang connu apres.
export function evolutionSession(joues) {
  const avant = joues.find((p) => echelle(p.rangAvant) != null)?.rangAvant;
  const apres = [...joues].reverse().find((p) => echelle(p.rangApres) != null)?.rangApres;
  return avant && apres ? evolution(avant, apres) : null;
}

// Points de la courbe des LP, sur l'echelle continue. Le premier point est le
// rang d'avant la premiere partie connue ; ensuite un point par partie. Une
// partie sans rang (rattrapee dans l'historique, placements) est sautee : la
// courbe relie simplement ses voisines.
export function courbe(joues) {
  const points = [];
  for (const p of joues) {
    const apres = echelle(p.rangApres);
    if (apres == null) continue;
    const avant = echelle(p.rangAvant);
    if (!points.length && avant != null) points.push({ valeur: avant, victoire: null });
    points.push({ valeur: apres, victoire: !!p.victoire });
  }
  if (points.length < 2) return null;

  const valeurs = points.map((p) => p.valeur);
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  return {
    points,
    min,
    max,
    // Trois seuils au plus : au-dela, la courbe devient illisible a cette taille.
    seuils: seuilsEntre(min, max).slice(-3),
    zone: nomRang(depuisEchelle(min)),
    fin: points[points.length - 1].valeur,
  };
}

// Qui s'affiche, selon le reglage « Affichage » et la phase du client :
//   deux     le bandeau en partie, le tableau de bord entre les parties
//   bandeau  le bandeau tout le temps, jamais le tableau de bord
//   tableau  le tableau de bord entre les parties, rien pendant la partie
//
// Client ferme : rien. Le streamer est passe a autre chose, un recap LoL fige
// par-dessus un autre jeu n'aurait pas de sens. Le tableau de bord attend aussi
// une premiere partie : vide, il n'aurait rien a raconter.
export function visibilite({ affichage = 'deux', phase = '', clientOuvert = false, nbParties = 0 }) {
  if (!clientOuvert) return { bandeau: false, tableau: false };
  const enPartie = PHASES_EN_PARTIE.has(phase);
  const tableau = !enPartie && nbParties > 0;

  if (affichage === 'bandeau') return { bandeau: true, tableau: false };
  if (affichage === 'tableau') return { bandeau: false, tableau };
  return { bandeau: !tableau, tableau };
}
