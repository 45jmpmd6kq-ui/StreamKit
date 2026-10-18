// Sub Goal — la logique pure, sans Twitch ni overlay : ce qu'un lot de subs
// offerts apporte au compteur, et ce que l'overlay affiche.
//
// Un subgift compte 1, quel que soit son palier (T1, T2 ou T3) : on compte des
// subs offerts, pas des points de sub. Choix du user (18/10/2026).

// Evenement Twurple channel.subscription.gift -> lot de subs offerts.
// `amount` = nombre de subs du lot. Un gift anonyme n'a pas de gifteur.
export function depuisEvenement(e) {
  const nombre = Math.max(0, Math.floor(Number(e?.amount) || 0));
  const gifteur = e?.isAnonymous ? null : e?.gifterDisplayName || e?.gifterName || null;
  return { nombre, gifteur };
}

// Le compteur apres un lot. On ne s'arrete pas a l'objectif : 52 / 50 reste
// affiche, le streamer change d'objectif quand il veut.
export function ajouter(memoire, lot, maintenant = Date.now()) {
  if (!lot.nombre) return memoire;
  return {
    ...memoire,
    compte: (memoire.compte ?? 0) + lot.nombre,
    dernier: { gifteur: lot.gifteur, nombre: lot.nombre, a: maintenant },
  };
}

// Correction a la main (bouton ➕ / ➖) : jamais sous zero.
export function corriger(memoire, delta) {
  return { ...memoire, compte: Math.max(0, (memoire.compte ?? 0) + delta) };
}

// Ce que recoit l'overlay.
export function vue({ objectif, cible, afficherDernier }, memoire) {
  const compte = memoire.compte ?? 0;
  const c = Math.max(1, Math.floor(cible) || 1);
  return {
    objectif: String(objectif ?? '').trim(),
    cible: c,
    compte,
    pourcent: Math.min(100, Math.round((compte * 100) / c)),
    atteint: compte >= c,
    reste: Math.max(0, c - compte),
    dernier: afficherDernier && memoire.dernier ? memoire.dernier : null,
  };
}
