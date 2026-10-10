// Statistiques d'usage, pour la vue « Modérateur » du développeur (demandée le
// 10/10/2026 : savoir quels modules ses streamers utilisent le plus).
//
// Ce qui part, à l'OUVERTURE de StreamKit et à la FIN DE CHAQUE LIVE (choix du
// user le 10/10/2026 : pas d'envoi horaire, mais savoir qui a ouvert StreamKit
// et avec quelle version), pour le jour concerné : la version, le
// nom de la chaîne, les modules actifs et leurs compteurs du jour, le nombre de
// lives et leur durée. JAMAIS un pseudo de viewer, un titre, un jeton.
// Un live dont la fin n'a pas pu partir (StreamKit fermé ou planté pendant le
// stream) part au démarrage suivant : chaque live est envoyé une fois.
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

// Au démarrage, le temps que le noyau ait refermé un live interrompu.
const RATTRAPAGE_MS = 60 * 1000;

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
    // Hors ligne, base en pause… rien de grave : le live repartira au prochain démarrage.
    log.debug('Statistiques non envoyées : ' + (e?.message || e));
    return false;
  }
}

// Les lives terminés et pas encore envoyés : celui qui vient de finir, ou un
// live interrompu (StreamKit fermé en plein stream) retrouvé au démarrage.
// Un live qui passe minuit compte sur son jour de début : ses deux jours
// partent. Il n'est marqué envoyé que si tout est parti.
export async function envoyerLives(registre, version) {
  if (neutralise() || !active()) return;
  for (const l of compteurs.historique().lives) {
    if (l.fin == null || l.envoye) continue;
    const jours = new Set([compteurs.jourDe(new Date(l.debut)), compteurs.jourDe(new Date(l.fin))]);
    let ok = true;
    for (const j of jours) ok = (await envoyer(registre, j, version)) && ok;
    if (ok) compteurs.marquerEnvoye(l);
  }
}

// À l'ouverture : le relevé du jour et le rattrapage. Pas d'envoi périodique.
export function demarrer(registre, version) {
  if (neutralise()) return () => {};
  // Le relevé du jour (version, modules actifs : qui a ouvert StreamKit), puis
  // les lives restés en attente.
  const t = setTimeout(async () => {
    await envoyer(registre, compteurs.jourDe(new Date()), version);
    await envoyerLives(registre, version);
  }, RATTRAPAGE_MS);
  t.unref?.();
  return () => clearTimeout(t);
}
