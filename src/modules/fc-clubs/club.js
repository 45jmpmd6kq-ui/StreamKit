// Le club du streamer : le retrouver chez EA par son nom, et ce qu'on en montre
// (nom, initiales pour le blason, couleur, division).

const normaliser = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr');

// Une ligne de la recherche EA -> ce que le module en garde.
export function depuisRecherche(c) {
  return {
    id: String(c?.clubId ?? c?.clubInfo?.clubId ?? ''),
    nom: String(c?.clubInfo?.name ?? c?.clubName ?? '').trim(),
    division: Number(c?.currentDivision) || null,
    matchsJoues: Number(c?.gamesPlayed) || 0,
    kit: c?.clubInfo?.customKit ?? null,
  };
}

// La recherche d'EA marche par debut de nom : « Nothing » renvoie aussi
// « Nothing FC » ou « Nothing But Ls ». Seul le nom exact compte (casse et
// espaces en trop mis a part). Avec un identifiant, c'est lui qui tranche.
export function choisirClub(resultats, { nom, id = '' }) {
  const liste = (Array.isArray(resultats) ? resultats : []).map(depuisRecherche).filter((c) => c.id);
  if (id) {
    const club = liste.find((c) => c.id === String(id).trim());
    return club ? { statut: 'trouve', club } : { statut: 'introuvable', proches: liste.slice(0, 5) };
  }
  const exacts = liste.filter((c) => normaliser(c.nom) === normaliser(nom));
  if (exacts.length === 1) return { statut: 'trouve', club: exacts[0] };
  if (exacts.length > 1) return { statut: 'ambigu', candidats: exacts };
  return { statut: 'introuvable', proches: liste.slice(0, 5) };
}

// EA numerote les divisions de 1, la plus haute, a 6, celle d'un club tout neuf
// (un club a 1 match en est au 6). FC 27 en a six : Division 5 a Division 1,
// puis l'Elite. Le 6 d'EA est donc la Division 5, ou commence tout club
// (confirme par le user le 29/09/2026), et le 1 l'Elite : le club numero un
// mondial y est, avec 5 montees au compteur.
export function nomDivision(n) {
  const d = Number(n);
  if (!Number.isInteger(d) || d < 1 || d > 6) return '';
  return d === 1 ? 'Élite' : 'Div. ' + (d - 1);
}

// « FC Les Potes » -> FLP, « Nothing More » -> NM, « Galactiques » -> GAL.
export function initiales(nom) {
  const mots = String(nom ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!mots.length) return '?';
  if (mots.length === 1) return mots[0].slice(0, 3).toUpperCase();
  return mots
    .slice(0, 3)
    .map((m) => m[0])
    .join('')
    .toUpperCase();
}

function versHsl(n) {
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function versHex({ h, s, l }) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

// La couleur des overlays : la plus franche des couleurs du maillot domicile
// (EA les donne en entiers RVB, "5775459" = #582063). Un maillot blanc, gris ou
// noir n'en donne pas : le module garde alors la couleur de ses reglages. La
// luminosite est ramenee entre 45 et 62 % pour rester lisible sur le fond sombre
// des overlays -- un bordeaux fonce y disparaitrait.
export function couleurDuMaillot(kit) {
  if (!kit) return null;
  for (const cle of ['kitColor1', 'kitColor2', 'kitColor3', 'kitColor4']) {
    const n = Number(kit[cle]);
    if (!Number.isInteger(n) || n <= 0 || n > 0xffffff) continue;
    const hsl = versHsl(n);
    if (hsl.s < 0.3) continue;
    return versHex({ ...hsl, l: Math.min(0.62, Math.max(0.45, hsl.l)) });
  }
  return null;
}
