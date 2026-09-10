// Historique des matchs classes et calcul de la session.
//
// Difference avec le projet d'origine : plus de SQLite. Les matchs vivent dans
// l'etat persistant du module (un JSON), plafonne a MAX_MATCHS. Un overlay de
// session n'a pas besoin d'un an d'historique, et ca evite une dependance
// native a compiler pour chaque version d'Electron.

const MAX_MATCHS = 200;
const ESSAIS_DETAIL_MAX = 5;

// Enregistre les matchs classes encore inconnus.
//
// Le resultat est d'abord deduit du SIGNE du RR : on ne gagne jamais de RR en
// perdant, ni l'inverse. Un gain nul, en revanche, ne veut rien dire — c'est le
// cas de tous les matchs de placement, ou Riot ne publie aucun RR avant
// l'attribution du rang. Ces matchs restent sans resultat ici, et c'est le
// detail du match qui tranchera ensuite (voir aConfirmer).
export function enregistrer(matchs, misesAJour) {
  const connus = new Set(matchs.map((m) => m.id));
  let nouveaux = 0;

  for (const m of misesAJour) {
    if (connus.has(m.MatchID)) continue;
    const gagne = Number(m.RankedRatingEarned || 0);
    matchs.push({
      id: m.MatchID,
      debutMs: Number(m.MatchStartTime || 0),
      carteId: (m.MapID || '').toLowerCase(),
      tierApres: Number(m.TierAfterUpdate || 0),
      tierAvant: Number(m.TierBeforeUpdate || 0),
      rrApres: Number(m.RankedRatingAfterUpdate || 0),
      rrAvant: Number(m.RankedRatingBeforeUpdate || 0),
      rrGagne: gagne,
      penaliteAfk: Number(m.AFKPenalty || 0),
      resultat: gagne > 0 ? 'W' : gagne < 0 ? 'L' : '',
      source: 'rr',
      essaisDetail: 0,
      ajouteA: new Date().toISOString(),
    });
    connus.add(m.MatchID);
    nouveaux++;
  }

  matchs.sort((a, b) => b.debutMs - a.debutMs);
  if (matchs.length > MAX_MATCHS) matchs.length = MAX_MATCHS;
  return nouveaux;
}

// Matchs a confirmer par le detail complet : ceux de la session (pour avoir le
// score en rounds et trancher les egalites) et ceux restes sans resultat (les
// placements). Ceux de la session passent en premier.
//
// Ces reponses pesent plusieurs Mo : on en resout quelques-uns par passage
// plutot que de tout rapatrier d'un coup.
export function aConfirmer(matchs, depuisMs, limite = 3) {
  return matchs
    .filter((m) => m.source !== 'details' && m.essaisDetail < ESSAIS_DETAIL_MAX)
    .filter((m) => m.debutMs >= depuisMs || m.resultat === '')
    .sort((a, b) => {
      const aDansSession = a.debutMs >= depuisMs ? 1 : 0;
      const bDansSession = b.debutMs >= depuisMs ? 1 : 0;
      return bDansSession - aDansSession || b.debutMs - a.debutMs;
    })
    .slice(0, limite)
    .map((m) => m.id);
}

export function appliquerDetail(matchs, matchId, resultat) {
  const m = matchs.find((x) => x.id === matchId);
  if (!m) return;
  if (!resultat) {
    // Detail illisible ou indisponible : on retentera, mais pas indefiniment.
    m.essaisDetail = (m.essaisDetail || 0) + 1;
    return;
  }
  m.resultat = resultat.resultat;
  m.roundsGagnes = resultat.gagnes;
  m.roundsPerdus = resultat.perdus;
  m.source = 'details';
}

// --- Blocs exposes a l'overlay ---------------------------------------------

export function blocRang(mmr, meta) {
  const acte = meta.act_id || '';
  const parSaison = mmr?.QueueSkills?.competitive?.SeasonalInfoBySeasonID || {};
  const courant = parSaison[acte] || {};

  let tier;
  let rr;
  let parties = 0;
  let victoires = 0;

  if (courant.CompetitiveTier || courant.RankedRating) {
    tier = Number(courant.CompetitiveTier || 0);
    rr = Number(courant.RankedRating || 0);
    parties = Number(courant.NumberOfGames || 0);
    victoires = Number(courant.NumberOfWins || 0);
  } else {
    // Acte inconnu du cache, ou aucun match dans l'acte en cours : on retombe
    // sur la derniere mise a jour connue plutot que d'afficher « non classé ».
    const dernier = mmr?.LatestCompetitiveUpdate || {};
    tier = Number(dernier.TierAfterUpdate || 0);
    rr = Number(dernier.RankedRatingAfterUpdate || 0);
  }

  const info = meta.tiers?.[String(tier)] || {};
  return {
    tier,
    name: info.name || (tier ? 'TIER ' + tier : 'NON CLASSÉ'),
    icon: info.icon || '',
    color: info.color || '#ECE8E1',
    rr,
    progress: Math.max(0, Math.min(1, rr / 100)),
    act_games: parties,
    act_wins: victoires,
  };
}

export function blocSession(matchs, departMs, mode) {
  const joues = matchs.filter((m) => m.debutMs >= departMs).sort((a, b) => a.debutMs - b.debutMs);

  const victoires = joues.filter((m) => m.resultat === 'W').length;
  const defaites = joues.filter((m) => m.resultat === 'L').length;
  const nuls = joues.filter((m) => m.resultat === 'D').length;

  // Serie en cours : on remonte depuis le dernier match tant que le resultat
  // ne change pas. Un match sans resultat (placement non resolu) coupe la serie.
  let type = '';
  let serie = 0;
  for (let i = joues.length - 1; i >= 0; i--) {
    const r = joues[i].resultat;
    if (r !== 'W' && r !== 'L') break;
    if (!type) type = r;
    if (r !== type) break;
    serie++;
  }

  const d = new Date(departMs);
  const deuxChiffres = (n) => String(n).padStart(2, '0');

  return {
    since_ms: departMs,
    since: deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes()),
    mode,
    rr: joues.reduce((t, m) => t + Number(m.rrGagne || 0), 0),
    wins: victoires,
    losses: defaites,
    draws: nuls,
    count: joues.length,
    streak_type: type,
    streak: serie,
    results: joues.map((m) => m.resultat).slice(-10),
  };
}

export function blocPartie(presence, meta) {
  const p = presence || {};
  return {
    state: p.sessionLoopState || '',
    map: (meta.maps || {})[(p.matchMap || '').toLowerCase()] || '',
    ally: p.partyOwnerMatchScoreAllyTeam,
    enemy: p.partyOwnerMatchScoreEnemyTeam,
    party_size: p.partySize,
    level: p.accountLevel,
  };
}
