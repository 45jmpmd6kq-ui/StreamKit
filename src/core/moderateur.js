// Vue « Modérateur » : réservée au développeur de StreamKit.
//
// Elle n'existe que sur un PC qui possède %APPDATA%\StreamKit\moderateur.json,
// avec la clé qui ouvre lire() dans la base des statistiques (core/telemetrie.js).
// La base n'en connaît que l'empreinte ; le fichier ne part jamais avec
// l'application, et rien dans le dépôt ne permet de lire les relevés.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DONNEES } from './paths.js';
import { SUPABASE_URL, SUPABASE_CLE } from './telemetrie.js';

const FICHIER = join(DONNEES, 'moderateur.json');

function cle() {
  if (!existsSync(FICHIER)) return null;
  try {
    return JSON.parse(readFileSync(FICHIER, 'utf8').replace(/^\uFEFF/, '')).cle || null;
  } catch {
    return null;
  }
}

export function disponible() {
  return !!cle();
}

// Les relevés depuis `depuis` (AAAA-MM-JJ).
export async function releves(depuis, { fetch = globalThis.fetch } = {}) {
  const k = cle();
  if (!k) return { ok: false, erreur: 'vue modérateur indisponible sur ce PC' };
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/lire', {
      method: 'POST',
      headers: { apikey: SUPABASE_CLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cle: k, depuis }),
      signal: AbortSignal.timeout(20000),
    });
    const corps = await r.json();
    if (!r.ok) return { ok: false, erreur: corps?.message || 'HTTP ' + r.status };
    return { ok: true, releves: corps };
  } catch (e) {
    return { ok: false, erreur: e?.message || String(e) };
  }
}
