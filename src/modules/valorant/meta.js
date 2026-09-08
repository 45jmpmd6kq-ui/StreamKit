// Donnees de reference Valorant : version du client, acte competitif en cours,
// noms et icones des rangs, noms des cartes.
//
// valorant-api.com est une API publique de contenu : pas de cle, pas de compte,
// aucune donnee personnelle n'y transite.
//
// La version du client n'est pas cosmetique : elle part dans les en-tetes des
// appels a Riot, et un numero perime fait echouer les requetes.

const AGE_MAX_MS = 12 * 3600 * 1000;
const BUILD_DE_SECOURS = '111.0.0.3261.5663';

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('valorant-api a répondu ' + r.status);
  return r.json();
}

async function telecharger(langue) {
  const meta = { fetched_at: new Date().toISOString() };

  const version = (await json('https://valorant-api.com/v1/version')).data || {};
  meta.version = version.riotClientVersion || '';
  // Le numero de build du Riot Client (different de la version du jeu) sert a
  // batir le User-Agent : il suit donc les mises a jour sans intervention.
  meta.client_build = version.riotClientBuild || BUILD_DE_SECOURS;

  // Le catalogue melange episodes (~6 mois) et actes (~2 mois), plusieurs etant
  // « en cours » au meme instant. Le MMR est indexe par ACTE : on retient donc
  // la fenetre active la plus etroite, pas la premiere rencontree.
  const saisons = (await json('https://valorant-api.com/v1/seasons/competitive')).data || [];
  const maintenant = Date.now();
  const actives = [];
  for (const s of saisons) {
    const debut = Date.parse(s.startTime);
    const fin = Date.parse(s.endTime);
    if (Number.isNaN(debut) || Number.isNaN(fin)) continue;
    if (debut <= maintenant && maintenant < fin) actives.push({ duree: fin - debut, s });
  }
  const acte = actives.length
    ? actives.sort((a, b) => a.duree - b.duree)[0].s
    : saisons[saisons.length - 1] || {};
  meta.act_id = acte.uuid || '';

  const jeux = (await json('https://valorant-api.com/v1/competitivetiers?language=' + langue)).data || [];
  const choisi = jeux.find((t) => t.uuid === acte.competitiveTiersUuid) || jeux[jeux.length - 1] || {};
  meta.tiers = {};
  for (const t of choisi.tiers || []) {
    meta.tiers[String(t.tier)] = {
      name: (t.tierName || '').trim(),
      division: (t.divisionName || '').trim(),
      icon: t.largeIcon || t.smallIcon || '',
      color: '#' + (t.color || 'ffffffff').slice(0, 6),
    };
  }

  meta.maps = {};
  for (const m of (await json('https://valorant-api.com/v1/maps?language=' + langue)).data || []) {
    if (m.mapUrl) meta.maps[m.mapUrl.toLowerCase()] = m.displayName || '';
  }

  return meta;
}

// Metadonnees du cache si elles sont fraiches, sinon rafraichies en ligne.
// Un echec reseau ne doit jamais empecher l'overlay de tourner : on garde le
// cache, et a defaut on degrade les noms et icones de rangs.
export async function charger({ cache, langue = 'fr-FR', log }) {
  const utilisable = cache?.tiers && cache?.version && cache?.client_build;
  const age = cache?.fetched_at ? Date.now() - Date.parse(cache.fetched_at) : Infinity;
  if (utilisable && age < AGE_MAX_MS) return { meta: cache, rafraichi: false };

  try {
    const meta = await telecharger(langue);
    log?.debug('Métadonnées Valorant à jour (client ' + meta.version + ').');
    return { meta, rafraichi: true };
  } catch (e) {
    if (utilisable) {
      log?.warn('Métadonnées non rafraîchies (' + (e?.message || e) + ') — cache conservé.');
      return { meta: cache, rafraichi: false };
    }
    log?.warn('Métadonnées indisponibles (' + (e?.message || e) + ') — noms et icônes de rangs dégradés.');
    return {
      meta: { version: '', client_build: BUILD_DE_SECOURS, act_id: '', tiers: {}, maps: {} },
      rafraichi: false,
    };
  }
}
