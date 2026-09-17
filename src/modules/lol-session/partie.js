// Resultat d'une partie, lu dans l'historique du client League of Legends.
//
// Deux sources, pour deux raisons :
//   - la liste de l'historique (/lol-match-history/v1/products/lol/
//     current-summoner/matches) ne contient que TES statistiques. Elle suffit
//     pour le resultat, le KDA, les sbires, la duree et la vision ;
//   - le detail de la partie (/lol-match-history/v1/games/<id>) contient les
//     dix joueurs. Il sert a la participation aux eliminations : tes kills et
//     assists rapportes aux kills de ton equipe.
// Le detail est facultatif : sans lui, la participation reste inconnue et le
// reste s'affiche quand meme.

// Les parties d'une reponse de l'historique, quelle que soit sa forme exacte.
export function jeux(liste) {
  const g = liste?.games?.games ?? liste?.games;
  return Array.isArray(g) ? g : [];
}

// Duree en secondes. Le client la donne en secondes ; d'anciennes versions de
// l'API de Riot la donnaient en millisecondes, et une partie de 7 heures n'existe
// pas : au-dela, c'est forcement des millisecondes.
export function dureeSecondes(jeu) {
  const brut = Number(jeu?.gameDuration) || 0;
  return brut > 25_000 ? Math.round(brut / 1000) : brut;
}

// Le joueur du streamer dans une partie. On reconnait le compte par le puuid,
// puis par les anciens identifiants que les versions plus vieilles du client
// sont seules a fournir. Dans la liste de l'historique, il n'y a qu'un joueur :
// c'est forcement lui.
export function trouverMoi(jeu, moi) {
  const participants = Array.isArray(jeu?.participants) ? jeu.participants : [];
  const identites = Array.isArray(jeu?.participantIdentities) ? jeu.participantIdentities : [];

  const correspond = (joueur) =>
    !!joueur &&
    ((moi?.puuid && joueur.puuid === moi.puuid) ||
      (moi?.summonerId && Number(joueur.summonerId) === Number(moi.summonerId)) ||
      (moi?.accountId && Number(joueur.accountId) === Number(moi.accountId)));

  const identite = identites.find((i) => correspond(i?.player));
  if (identite) {
    const p = participants.find((x) => x?.participantId === identite.participantId);
    if (p) return p;
  }
  return participants.length === 1 ? participants[0] : null;
}

// Participation aux eliminations, en pourcentage entier, ou null si le detail
// ne permet pas de la calculer.
export function participation(detail, moi) {
  const participants = Array.isArray(detail?.participants) ? detail.participants : [];
  if (participants.length < 2) return null;
  const joueur = trouverMoi(detail, moi);
  if (!joueur) return null;

  const killsEquipe = participants
    .filter((p) => p?.teamId === joueur.teamId)
    .reduce((t, p) => t + (Number(p?.stats?.kills) || 0), 0);
  if (!killsEquipe) return null;

  const s = joueur.stats || {};
  const pct = Math.round((((Number(s.kills) || 0) + (Number(s.assists) || 0)) / killsEquipe) * 100);
  return Math.min(100, pct);
}

// -> { id, queueId, championId, victoire, remake, k, d, a, cs, dureeS, vision,
//      kp, finA } ou null si le joueur est introuvable dans la partie.
export function extraireResultat(jeu, moi, detail = null) {
  const joueur = trouverMoi(jeu, moi);
  if (!joueur) return null;
  const s = joueur.stats || {};
  const dureeS = dureeSecondes(jeu);
  const debut = Number(jeu.gameCreation) || 0;

  return {
    id: Number(jeu.gameId) || 0,
    queueId: Number(jeu.queueId) || 0,
    championId: Number(joueur.championId) || 0,
    victoire: s.win === true,
    // Une partie « refaite » (vote de remake en debut de partie) ne compte ni
    // en victoire ni en defaite, et ne coute aucun LP.
    remake: s.gameEndedInEarlySurrender === true,
    k: Number(s.kills) || 0,
    d: Number(s.deaths) || 0,
    a: Number(s.assists) || 0,
    cs: (Number(s.totalMinionsKilled) || 0) + (Number(s.neutralMinionsKilled) || 0),
    dureeS,
    vision: Number(s.visionScore) || 0,
    kp: detail ? participation(detail, moi) : null,
    finA: debut ? debut + dureeS * 1000 : 0,
  };
}
