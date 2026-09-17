// Noms et icones des champions, depuis Data Dragon (le CDN officiel de Riot).
//
// L'historique du client ne donne qu'un numero de champion. Data Dragon fournit,
// pour chaque version du jeu, la table numero -> cle et nom FRANCAIS (« Nunu et
// Willump », « Wukong » dont la cle est MonkeyKing), et les icones carrees.
//
// Cache dans l'etat du module, rafraichi toutes les 12 heures : un nouveau
// champion sort avec un patch, pas en plein live. Sans reseau, le cache sert ;
// sans cache non plus, l'overlay affiche les initiales a la place de l'icone.

const DDRAGON = 'https://ddragon.leagueoflegends.com';
export const DUREE_CACHE_MS = 12 * 3600 * 1000;

export const VIDE = { version: '', parId: {}, chargeA: 0 };

async function json(recuperer, url) {
  const r = await recuperer(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Data Dragon a répondu ' + r.status);
  return r.json();
}

// -> { donnees, rafraichi, erreur }
export async function charger({ cache, maintenant = Date.now(), recuperer = globalThis.fetch }) {
  const actuel = cache?.version && cache?.parId ? cache : VIDE;
  if (actuel.version && maintenant - (actuel.chargeA || 0) < DUREE_CACHE_MS) {
    return { donnees: actuel, rafraichi: false, erreur: '' };
  }

  try {
    const versions = await json(recuperer, DDRAGON + '/api/versions.json');
    const version = String(Array.isArray(versions) ? versions[0] || '' : '');
    if (!version) throw new Error('aucune version publiée');

    if (version === actuel.version && Object.keys(actuel.parId).length) {
      return { donnees: { ...actuel, chargeA: maintenant }, rafraichi: true, erreur: '' };
    }

    const table = await json(recuperer, DDRAGON + '/cdn/' + version + '/data/fr_FR/champion.json');
    const parId = {};
    for (const c of Object.values(table?.data || {})) {
      if (c?.key && c?.id) parId[String(c.key)] = { cle: String(c.id), nom: String(c.name || c.id) };
    }
    if (!Object.keys(parId).length) throw new Error('table des champions vide');
    return { donnees: { version, parId, chargeA: maintenant }, rafraichi: true, erreur: '' };
  } catch (e) {
    return { donnees: actuel, rafraichi: false, erreur: e?.message || String(e) };
  }
}

// « Nunu et Willump » -> « NU », « Kai'Sa » -> « KA ». Deux lettres suffisent a
// reconnaitre un champion le temps que l'icone arrive.
export function initiales(nom) {
  const lettres = String(nom || '')
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '');
  return lettres.slice(0, 2).toUpperCase() || '?';
}

export function infoChampion(donnees, championId) {
  const c = donnees?.parId?.[String(championId)];
  if (!c) return { nom: 'Champion', icone: '', initiales: '?' };
  return {
    nom: c.nom,
    icone: donnees.version ? DDRAGON + '/cdn/' + donnees.version + '/img/champion/' + c.cle + '.png' : '',
    initiales: initiales(c.nom),
  };
}
