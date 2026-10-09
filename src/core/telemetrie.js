// Statistiques d'usage, pour la vue « Modérateur » du développeur (demandée le
// 10/10/2026 : savoir quels modules ses streamers utilisent le plus).
//
// Ce qui part, une fois par heure, pour la journée en cours : la version, le
// nom de la chaîne, les modules actifs et leurs compteurs du jour, le nombre de
// lives et leur durée. JAMAIS un pseudo de viewer, un titre, un jeton.
//
// Opt-out (choix du user) : actif par défaut, annoncé dans la note de version
// qui s'affiche à la mise à jour, et coupé d'un clic dans les réglages
// (config.telemetrie.actif). Coupé, plus rien ne part.
//
// Le relevé va dans une base Supabase par une fonction qui ne sait QU'ÉCRIRE
// (deposer) ; la clé publique ci-dessous ne permet pas de lire. Un même jour
// renvoyé remplace le précédent. La base garde 13 mois.

import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import * as compteurs from './compteurs.js';
import * as journal from './journal.js';

const log = journal.pour('telemetrie');

export const SUPABASE_URL = 'https://akzqwthzhcchttemlxdf.supabase.co';
// Clé publique (« publishable ») : faite pour être embarquée dans une
// application. Elle n'ouvre que deposer() et lire(), et lire() exige la clé
// modérateur.
export const SUPABASE_CLE = 'sb_publishable_2xsoriUY8Fl1wA71M3y7ZA_hHYjE9lt';

const PERIODE_MS = 60 * 60 * 1000;
const PREMIER_ENVOI_MS = 60 * 1000;

// Jamais pendant les tests, ni quand on le demande (développement).
const neutralise = () => process.env.STREAMKIT_TELEMETRIE === '0' || !!process.env.NODE_TEST_CONTEXT;

export function active() {
  return store.getConfig().telemetrie?.actif !== false;
}

export function definir(actif) {
  const c = store.getConfig();
  c.telemetrie = { ...(c.telemetrie ?? {}), actif: !!actif };
  store.sauverConfig(c);
}

// Un identifiant d'installation tiré au hasard, pas lié à la personne : il sert
// seulement à ne pas mélanger deux PC qui streameraient sur la même chaîne.
function installId() {
  const c = store.getConfig();
  if (!c.telemetrie?.installId) {
    c.telemetrie = { ...(c.telemetrie ?? {}), installId: randomUUID() };
    store.sauverConfig(c);
  }
  return c.telemetrie.installId;
}

// Le relevé d'un jour (AAAA-MM-JJ, local).
export function releve(registre, jour, version) {
  const h = compteurs.historique();
  const duJour = h.jours[jour]?.m ?? {};
  const modules = {};
  for (const m of registre.liste()) {
    if (m.manifeste.developpement) continue;
    const c = duJour[m.id] ?? {};
    if (!m.actif && !Object.keys(c).length) continue;
    modules[m.id] = { a: m.actif ? 1 : 0, c };
  }
  const lives = h.lives.filter((l) => compteurs.jourDe(new Date(l.debut)) === jour);
  const minutes = lives.reduce(
    (t, l) => t + Math.max(0, ((l.fin ?? l.vu ?? Date.now()) - l.debut) / 60000),
    0
  );
  return {
    install_id: installId(),
    jour,
    chaine: store.getConfig().twitch?.channel || '',
    version,
    modules,
    lives: lives.length,
    minutes_live: Math.round(minutes),
  };
}

export async function envoyer(registre, jour, version, { fetch = globalThis.fetch } = {}) {
  if (neutralise() || !active()) return false;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/deposer', {
      method: 'POST',
      headers: { apikey: SUPABASE_CLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: releve(registre, jour, version) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) log.debug('Statistiques non envoyées : HTTP ' + r.status);
    return r.ok;
  } catch (e) {
    // Hors ligne, base en pause… rien de grave : on renverra à l'heure suivante.
    log.debug('Statistiques non envoyées : ' + (e?.message || e));
    return false;
  }
}

// Une minute après le démarrage (hier, pour finir la journée, et aujourd'hui),
// puis chaque heure.
export function demarrer(registre, version) {
  if (neutralise()) return () => {};
  const tour = async (avecHier) => {
    const auj = new Date();
    if (avecHier) {
      const hier = new Date(auj);
      hier.setDate(hier.getDate() - 1);
      await envoyer(registre, compteurs.jourDe(hier), version);
    }
    await envoyer(registre, compteurs.jourDe(auj), version);
  };
  const premier = setTimeout(() => tour(true), PREMIER_ENVOI_MS);
  const suivant = setInterval(() => tour(false), PERIODE_MS);
  premier.unref?.();
  suivant.unref?.();
  return () => {
    clearTimeout(premier);
    clearInterval(suivant);
  };
}
