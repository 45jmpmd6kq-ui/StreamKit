// Rangs League of Legends : noms, couleurs, et une echelle continue de LP.
//
// L'echelle est ce qui permet de soustraire deux rangs. « Émeraude III 76 LP »
// puis « Émeraude II 2 LP » ne se comparent pas tels quels ; sur l'echelle, ce
// sont 2176 et 2202, soit +26 -- exactement ce que le client annonce en fin de
// partie, promotion comprise. Chaque division vaut 100 LP. A partir de Maitre
// il n'y a plus de division : les LP s'accumulent, et Grand Maitre comme
// Challenger ne sont que des seuils sur cette meme echelle.

export const PALIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
];

const NOMS = {
  IRON: 'Fer',
  BRONZE: 'Bronze',
  SILVER: 'Argent',
  GOLD: 'Or',
  PLATINUM: 'Platine',
  EMERALD: 'Émeraude',
  DIAMOND: 'Diamant',
  MASTER: 'Maître',
  GRANDMASTER: 'Grand Maître',
  CHALLENGER: 'Challenger',
};

// Teinte dominante de chaque embleme : barre de progression et embleme de
// secours si l'image ne charge pas.
const COULEURS = {
  IRON: '#A19D94',
  BRONZE: '#C28A5A',
  SILVER: '#B8C4CC',
  GOLD: '#E6B85C',
  PLATINUM: '#4FC7C0',
  EMERALD: '#2EC4A0',
  DIAMOND: '#7C9BFF',
  MASTER: '#C678F0',
  GRANDMASTER: '#F0555D',
  CHALLENGER: '#F5CF6A',
};

// Du plus bas au plus haut : l'indice est la position sur l'echelle.
const DIVISIONS = ['IV', 'III', 'II', 'I'];
const INDEX_MAITRE = PALIERS.indexOf('MASTER');
export const BASE_MAITRE = INDEX_MAITRE * 400;

// Les deux files classees de la Faille de l'invocateur. L'id est celui des
// parties (historique, session de jeu), le type celui du classement.
export const FILES = {
  solo: { id: 420, type: 'RANKED_SOLO_5x5', nom: 'Classée Solo/Duo' },
  flex: { id: 440, type: 'RANKED_FLEX_SR', nom: 'Classée Flexible' },
};

// Rang d'une file, lu dans /lol-ranked/v1/current-ranked-stats. null si le
// client ne dit rien de cette file.
//
// Un palier inconnu (« NONE », vide, ou un palier ajoute par Riot apres cette
// version) donne un rang sans palier : « non classé » plutot qu'un plantage.
// C'est deja arrive -- Émeraude n'existait pas avant 2023.
export function extraireRang(stats, typeFile) {
  const entree =
    stats?.queueMap?.[typeFile] ??
    (Array.isArray(stats?.queues) ? stats.queues.find((q) => q?.queueType === typeFile) : null);
  if (!entree) return null;

  const palier = String(entree.tier || '').toUpperCase();
  const connu = PALIERS.includes(palier);
  const division = String(entree.division || '').toUpperCase();
  return {
    palier: connu ? palier : '',
    division: connu && PALIERS.indexOf(palier) < INDEX_MAITRE && DIVISIONS.includes(division) ? division : '',
    lp: Number(entree.leaguePoints) || 0,
    provisoire: !!entree.isProvisional,
    placementsRestants: Number(entree.provisionalGamesRemaining) || 0,
    placementsTotal: Number(entree.provisionalGameThreshold) || 0,
  };
}

// Position sur l'echelle, ou null si le rang n'en a pas (non classe, placements).
export function echelle(rang) {
  if (!rang?.palier) return null;
  const i = PALIERS.indexOf(rang.palier);
  if (i < 0) return null;
  const lp = Number(rang.lp) || 0;
  if (i >= INDEX_MAITRE) return BASE_MAITRE + lp;
  const d = DIVISIONS.indexOf(rang.division);
  return d < 0 ? null : i * 400 + d * 100 + lp;
}

// Le rang qui correspond a une valeur de l'echelle (LP compris).
export function depuisEchelle(valeur) {
  const v = Math.max(0, Math.floor(Number(valeur) || 0));
  if (v >= BASE_MAITRE) return { palier: 'MASTER', division: '', lp: v - BASE_MAITRE };
  return {
    palier: PALIERS[Math.floor(v / 400)],
    division: DIVISIONS[Math.floor((v % 400) / 100)],
    lp: v % 100,
  };
}

export function nomRang(rang) {
  if (!rang) return '';
  if (!rang.palier) return rang.provisoire ? 'Placements' : 'Non classé';
  return NOMS[rang.palier] + (rang.division ? ' ' + rang.division : '');
}

export function couleur(palier) {
  return COULEURS[palier] || '#C8AA6E';
}

// Division par division, pour savoir si on est monte ou descendu. Les LP ne
// comptent pas : gagner 20 LP dans la meme division n'est pas une promotion.
function marche(rang) {
  if (!rang?.palier) return null;
  const i = PALIERS.indexOf(rang.palier);
  if (i < 0) return null;
  if (i >= INDEX_MAITRE) return i * 4;
  const d = DIVISIONS.indexOf(rang.division);
  return d < 0 ? null : i * 4 + d;
}

export function evolution(avant, apres) {
  const a = marche(avant);
  const b = marche(apres);
  if (a == null || b == null || a === b) return null;
  return b > a ? 'promu' : 'retrograde';
}

// Les debuts de division franchis entre deux valeurs de l'echelle, pour tracer
// les seuils sur la courbe. Au-dela de Maitre, plus de division a marquer.
export function seuilsEntre(min, max) {
  const seuils = [];
  const haut = Math.min(Number(max), BASE_MAITRE);
  for (let v = Math.floor(Number(min) / 100) * 100 + 100; v <= haut; v += 100) {
    seuils.push({ valeur: v, nom: nomRang(depuisEchelle(v)) });
  }
  return seuils;
}
