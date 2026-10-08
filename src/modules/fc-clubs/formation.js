// La formation du club : le streamer donne les pseudos de ses joueurs (1 a 11),
// choisit un schema, et une roulette tire le poste de chacun. Un poste peut etre
// impose a un joueur ; les autres se partagent au hasard les places restantes.
// Moins de 11 joueurs : les places non tirees sont tenues par l'IA du jeu,
// chacune avec sa carte « IA » (demande du user le 08/10/2026).
//
// Rien ne vient d'EA ici : l'API des clubs ne publie ni formation ni tactique
// (verifie le 08/10/2026), seulement la ligne des joueurs humains apres le match.
//
// Coordonnees en pourcentage du terrain, vu de haut : x de gauche a droite,
// y de l'attaque (0) au but du club (100). Abreviations de FC en francais.

export const NB_MAX = 11;
export const PSEUDO_MAX = 24;

const G = () => ({ poste: 'GB', ligne: 'G', x: 50, y: 90 });
const p = (poste, ligne, x, y) => ({ poste, ligne, x, y });

// Une defense a quatre, commune a la plupart des schemas.
const QUATRE = [
  p('DG', 'DEF', 12, 70),
  p('DC', 'DEF', 37, 75),
  p('DC', 'DEF', 63, 75),
  p('DD', 'DEF', 88, 70),
];
const TROIS = [p('DC', 'DEF', 25, 74), p('DC', 'DEF', 50, 76), p('DC', 'DEF', 75, 74)];

const SCHEMAS = [
  {
    code: '4-3-3',
    places: [
      G(),
      ...QUATRE,
      p('MC', 'MIL', 28, 52),
      p('MC', 'MIL', 50, 56),
      p('MC', 'MIL', 72, 52),
      p('AG', 'ATT', 16, 22),
      p('BU', 'ATT', 50, 15),
      p('AD', 'ATT', 84, 22),
    ],
  },
  {
    code: '4-3-3 (MDC)',
    places: [
      G(),
      ...QUATRE,
      p('MDC', 'MIL', 50, 60),
      p('MC', 'MIL', 30, 46),
      p('MC', 'MIL', 70, 46),
      p('AG', 'ATT', 16, 22),
      p('BU', 'ATT', 50, 15),
      p('AD', 'ATT', 84, 22),
    ],
  },
  {
    code: '4-2-3-1',
    places: [
      G(),
      ...QUATRE,
      p('MDC', 'MIL', 35, 60),
      p('MDC', 'MIL', 65, 60),
      p('MG', 'MIL', 16, 38),
      p('MOC', 'MIL', 50, 38),
      p('MD', 'MIL', 84, 38),
      p('BU', 'ATT', 50, 15),
    ],
  },
  {
    code: '4-4-2',
    places: [
      G(),
      ...QUATRE,
      p('MG', 'MIL', 12, 48),
      p('MC', 'MIL', 37, 52),
      p('MC', 'MIL', 63, 52),
      p('MD', 'MIL', 88, 48),
      p('BU', 'ATT', 35, 18),
      p('BU', 'ATT', 65, 18),
    ],
  },
  {
    code: '4-1-2-1-2',
    places: [
      G(),
      ...QUATRE,
      p('MDC', 'MIL', 50, 59),
      p('MC', 'MIL', 25, 48),
      p('MC', 'MIL', 75, 48),
      p('MOC', 'MIL', 50, 36),
      p('BU', 'ATT', 35, 16),
      p('BU', 'ATT', 65, 16),
    ],
  },
  // Le losange « large » de FC : un MG et un MD a la place des deux MC.
  {
    code: '4-1-2-1-2 (2)',
    places: [
      G(),
      ...QUATRE,
      p('MDC', 'MIL', 50, 59),
      p('MG', 'MIL', 13, 46),
      p('MD', 'MIL', 87, 46),
      p('MOC', 'MIL', 50, 36),
      p('BU', 'ATT', 35, 16),
      p('BU', 'ATT', 65, 16),
    ],
  },
  {
    code: '3-5-2',
    places: [
      G(),
      ...TROIS,
      p('MDC', 'MIL', 37, 60),
      p('MDC', 'MIL', 63, 60),
      p('MG', 'MIL', 10, 44),
      p('MOC', 'MIL', 50, 38),
      p('MD', 'MIL', 90, 44),
      p('BU', 'ATT', 35, 16),
      p('BU', 'ATT', 65, 16),
    ],
  },
  {
    code: '3-4-3',
    places: [
      G(),
      ...TROIS,
      p('MG', 'MIL', 12, 50),
      p('MC', 'MIL', 37, 54),
      p('MC', 'MIL', 63, 54),
      p('MD', 'MIL', 88, 50),
      p('AG', 'ATT', 18, 22),
      p('BU', 'ATT', 50, 15),
      p('AD', 'ATT', 82, 22),
    ],
  },
  {
    code: '5-3-2',
    places: [
      G(),
      p('DLG', 'DEF', 9, 62),
      p('DC', 'DEF', 29, 74),
      p('DC', 'DEF', 50, 76),
      p('DC', 'DEF', 71, 74),
      p('DLD', 'DEF', 91, 62),
      p('MC', 'MIL', 28, 48),
      p('MC', 'MIL', 50, 52),
      p('MC', 'MIL', 72, 48),
      p('BU', 'ATT', 35, 18),
      p('BU', 'ATT', 65, 18),
    ],
  },
];

// Chaque place recoit un identifiant stable dans son schema (« DC2 » = le
// deuxieme DC en partant de la gauche) : c'est lui qu'un poste impose retient.
export const FORMATIONS = SCHEMAS.map((s) => {
  const vus = {};
  return {
    code: s.code,
    places: s.places.map((pl) => {
      vus[pl.poste] = (vus[pl.poste] ?? 0) + 1;
      const double = s.places.filter((x) => x.poste === pl.poste).length > 1;
      return { id: pl.poste + (double ? vus[pl.poste] : ''), ...pl };
    }),
  };
});

export const FORMATION_DEFAUT = '4-3-3';

export const formation = (code) => FORMATIONS.find((f) => f.code === code) ?? null;

// Libelle d'une place dans les menus : « DC (gauche) » pour departager deux DC.
export function libellePlace(f, place) {
  const memes = f.places.filter((x) => x.poste === place.poste);
  if (memes.length < 2) return place.poste;
  const rang = memes.indexOf(place);
  const cotes =
    memes.length === 2 ? ['gauche', 'droite'] : memes.length === 3 ? ['gauche', 'axe', 'droite'] : null;
  return place.poste + ' (' + (cotes ? cotes[rang] : rang + 1) + ')';
}

// Ce que la page envoie, remis au propre : pseudos coupes, lignes vides
// retirees, poste impose oublie s'il n'existe pas dans ce schema.
export function nettoyer({ code, joueurs } = {}) {
  const f = formation(code) ?? formation(FORMATION_DEFAUT);
  const liste = (Array.isArray(joueurs) ? joueurs : [])
    .map((j) => ({
      nom: String(j?.nom ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PSEUDO_MAX),
      force: f.places.some((pl) => pl.id === j?.force) ? j.force : '',
    }))
    .filter((j) => j.nom)
    .slice(0, NB_MAX);
  return { code: f.code, joueurs: liste };
}

// Ce qui empeche de tirer, en une phrase pour le streamer ; null si rien.
export function probleme({ joueurs }) {
  if (!joueurs.length) return 'Indique au moins un joueur.';
  const noms = new Set();
  for (const j of joueurs) {
    const cle = j.nom.toLocaleLowerCase('fr');
    if (noms.has(cle)) return '« ' + j.nom + ' » est inscrit deux fois.';
    noms.add(cle);
  }
  const places = new Map();
  for (const j of joueurs.filter((x) => x.force)) {
    if (places.has(j.force)) {
      return j.force + ' est imposé à deux joueurs (' + places.get(j.force) + ' et ' + j.nom + ').';
    }
    places.set(j.force, j.nom);
  }
  return null;
}

// Le tirage. Les postes imposes d'abord, puis chaque autre joueur prend une
// place libre au hasard (Fisher-Yates sur les places libres). `hasard` rend un
// nombre dans [0, 1[ : remplace dans les tests.
export function tirer({ code, joueurs }, hasard = Math.random) {
  const f = formation(code);
  const libres = f.places.map((pl) => pl.id).filter((id) => !joueurs.some((j) => j.force === id));
  for (let i = libres.length - 1; i > 0; i--) {
    const k = Math.floor(hasard() * (i + 1));
    [libres[i], libres[k]] = [libres[k], libres[i]];
  }
  let suivant = 0;
  const attribue = new Map(joueurs.map((j) => [j.nom, j.force || libres[suivant++]]));
  const joueurDe = new Map([...attribue].map(([nom, id]) => [id, nom]));
  // Les 11 places, du gardien vers l'attaque et de gauche a droite (l'ordre de
  // « Tout retourner ») ; celles sans joueur sont a l'IA.
  return f.places
    .map((pl) =>
      joueurDe.has(pl.id)
        ? { ...pl, nom: joueurDe.get(pl.id), ia: false, impose: joueurs.some((j) => j.force === pl.id) }
        : { ...pl, nom: 'IA', ia: true, impose: false }
    )
    .sort((a, b) => b.y - a.y || a.x - b.x);
}
