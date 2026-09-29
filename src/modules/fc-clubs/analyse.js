// Un match tel qu'EA le rend -> ce que le module en garde : le score, le
// resultat et les joueurs HUMAINS du club du streamer.
//
// Rien sur l'equipe adverse, a part son nom : les overlays ne parlent que du
// club du streamer (choix du user, 29/09/2026). EA donne pourtant ses joueurs.
//
// Deux particularites des vraies reponses :
//   - seuls les joueurs humains y figurent. Un but d'un coequipier IA (ou un
//     contre son camp) n'est attribue a personne : la somme des buts des
//     joueurs peut etre inferieure au score ;
//   - l'homme du match (mom) peut etre un adversaire, ou un joueur IA : aucun
//     joueur du club n'a alors l'etoile.

const POSTES = { goalkeeper: 'G', defender: 'DEF', midfielder: 'MIL', forward: 'ATT' };

const nombre = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Codes de resultat d'EA : 1 victoire, 2 defaite, 4 nul, 16385 victoire par
// abandon adverse, 10 defaite par abandon. Les amicaux mettent 0 partout : le
// score tranche.
function resultatDe(code, buts, encaisses) {
  if (code === 1 || code === 16385) return 'V';
  if (code === 2 || code === 10) return 'D';
  if (code === 4) return 'N';
  if (buts > encaisses) return 'V';
  return buts < encaisses ? 'D' : 'N';
}

export function analyserMatch(brut, clubId, type) {
  const cle = String(clubId);
  const id = String(brut?.matchId ?? '');
  const nous = brut?.clubs?.[cle];
  if (!id || !nous) return null;
  const autre = Object.keys(brut.clubs).find((k) => k !== cle);
  const eux = autre ? brut.clubs[autre] : null;

  const buts = nombre(nous.goals);
  const encaisses = eux ? nombre(eux.goals) : nombre(nous.goalsAgainst);
  const code = nombre(nous.result);
  const bruts = Object.values(brut.players?.[cle] ?? {});

  return {
    id,
    // L'heure de fin du match chez EA, en secondes.
    a: nombre(brut.timestamp) * 1000,
    type,
    buts,
    encaisses,
    resultat: resultatDe(code, buts, encaisses),
    abandon: code === 16385 || code === 10,
    adversaire: String(eux?.details?.name ?? '').trim(),
    // Duree reelle du match : EA la donne par joueur (realtimegame).
    dureeS: bruts.reduce((max, j) => Math.max(max, nombre(j.realtimegame)), 0),
    joueurs: bruts.map((j) => ({
      nom: String(j.playername ?? '').trim() || 'Joueur',
      poste: POSTES[j.pos] ?? '',
      // "7.40" : EA donne deux decimales, le jeu en montre une.
      note: Math.round(nombre(j.rating) * 10) / 10,
      buts: nombre(j.goals),
      pd: nombre(j.assists),
      tirs: nombre(j.shots),
      passes: nombre(j.passesmade),
      passesTentees: nombre(j.passattempts),
      tacles: nombre(j.tacklesmade),
      taclesTentes: nombre(j.tackleattempts),
      arrets: nombre(j.saves),
      hdm: String(j.mom) === '1',
      rouge: nombre(j.redcards),
    })),
  };
}
