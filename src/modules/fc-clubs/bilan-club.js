// Le bilan du club chez EA (/clubs/overallStats), pour les matchs que son
// historique (/clubs/matches) ne publie pas.
//
// Vu chez un streamer le 30/09/2026 : son historique s'arretait a 22 h 40,
// alors que son bilan comptait 4 victoires de plus. Ces 4 matchs manquaient
// aussi dans l'historique des 4 adversaires, qui avaient pourtant leurs autres
// matchs publies jusqu'a minuit passe. EA les a donc comptes sans jamais
// publier leur detail. Le bilan, lui, suit : il sert de filet.
//
// Ce qu'il donne (verifie sur de vraies reponses le 01/10/2026) :
//   - gamesPlayed = wins + losses + ties, en championnat ;
//   - lastOpponentN : l'identifiant du club adverse des 10 derniers matchs,
//     N = 0 le plus recent ;
//   - lastMatchN : le resultat des 5 derniers seulement (1 victoire, 2 defaite,
//     3 nul), -1 au-dela.
// Ni score, ni joueurs : un match compte depuis le bilan n'a que son resultat.

const RESULTATS = { 1: 'V', 2: 'D', 3: 'N' };
const DERNIERS = 10;

// Un match du bilan et un match de l'historique sont le meme s'ils opposent
// les memes clubs a quelques minutes pres. La marge couvre le cache d'EA (ses
// reponses valent 5 minutes) et le tour d'une minute du module.
export const MARGE_MS = 15 * 60_000;

const entier = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

// La reponse d'EA -> { joues, v, n, d, sr, derniers }. `joues` est null si le
// bilan est illisible : le skill rating reste utilisable, le reste non.
export function lireBilan(reponse) {
  const s = Array.isArray(reponse) ? reponse[0] : null;
  if (!s || typeof s !== 'object') return null;
  const sr = Number(s.skillRating);
  const joues = entier(s.gamesPlayed);
  const v = entier(s.wins);
  const n = entier(s.ties);
  const d = entier(s.losses);
  const lisible = joues != null && joues >= 0 && v != null && n != null && d != null;
  const derniers = [];
  for (let i = 0; i < DERNIERS; i++) {
    const id = String(s['lastOpponent' + i] ?? '').trim();
    if (!id || id === '-1') break;
    derniers.push({ adversaireId: id, resultat: RESULTATS[entier(s['lastMatch' + i])] ?? null });
  }
  return {
    joues: lisible ? joues : null,
    v: lisible ? v : null,
    n: lisible ? n : null,
    d: lisible ? d : null,
    sr: Number.isFinite(sr) && sr > 0 ? sr : null,
    derniers,
  };
}

// Les matchs joues entre deux lectures du bilan, du plus ancien au plus recent :
// [{ adversaireId, resultat }]. Au-dela des 5 derniers, EA ne donne plus le
// resultat : les totaux le donnent, sans l'ordre -- victoires, puis nuls, puis
// defaites. Sans ecart lisible (premiere lecture, compteurs remis a zero par
// EA), rien.
export function nouveauxDuBilan(avant, apres) {
  if (avant?.joues == null || apres?.joues == null) return [];
  const nombre = apres.joues - avant.joues;
  if (nombre <= 0) return [];
  const entrees = apres.derniers.slice(0, Math.min(nombre, DERNIERS));

  const reste = { V: apres.v - avant.v, N: apres.n - avant.n, D: apres.d - avant.d };
  for (const e of entrees) if (e.resultat) reste[e.resultat]--;
  const suivant = () => ['V', 'N', 'D'].find((r) => reste[r] > 0) ?? null;

  const liste = [];
  for (const e of entrees) {
    let resultat = e.resultat;
    if (!resultat) {
      resultat = suivant();
      if (!resultat) continue;
      reste[resultat]--;
    }
    liste.push({ adversaireId: e.adversaireId, resultat });
  }
  return liste.reverse();
}

// Le match de l'historique qui correspond a une ligne du bilan apparue entre
// `depuis` (lecture precedente) et `jusqua` : meme adversaire, fini dans cet
// intervalle, pas deja rattache a une autre ligne. Un amical n'entre pas dans
// le bilan.
export function matchDuBilan(matchs, entree, { depuis, jusqua }) {
  return (
    matchs
      .filter(
        (m) =>
          !m.provisoire &&
          !m.auBilan &&
          m.type !== 'amical' &&
          m.adversaireId === entree.adversaireId &&
          m.a >= depuis - MARGE_MS &&
          m.a <= jusqua + MARGE_MS
      )
      .sort((x, y) => x.a - y.a)[0] ?? null
  );
}

// Le match compte depuis le bilan qu'un match tout juste publie vient
// completer : meme adversaire, et une fin qui tombe dans l'intervalle ou le
// bilan l'a vu passer.
export function provisoireDe(matchs, publie) {
  if (publie.type === 'amical') return null;
  return (
    matchs
      .filter(
        (m) =>
          m.provisoire &&
          m.adversaireId === publie.adversaireId &&
          publie.a >= m.depuis - MARGE_MS &&
          publie.a <= m.a + MARGE_MS
      )
      .sort((x, y) => x.a - y.a)[0] ?? null
  );
}
