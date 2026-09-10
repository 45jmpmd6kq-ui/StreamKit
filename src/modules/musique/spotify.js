// Client Spotify minimal : gestion du token (rafraichissement automatique),
// recherche d'un morceau, ajout a la file d'attente, morceau suivant, lecture en cours.
// Necessite un compte Spotify Premium + un appareil actif (Spotify ouvert).

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

// fetch() n'a aucun delai par defaut. Une connexion qui reste ouverte sans
// jamais repondre (VPN qui tombe, proxy d'antivirus) gelerait le bot musique
// SANS erreur dans le journal : le tour de boucle suivant ne demarre pas tant
// que le precedent tourne. Meme garde-fou que dans le module Valorant.
const DELAI_RESEAU = 15000;

// --- Aide a la correspondance stricte des titres ---
// Mots vides ignores dans la comparaison (articles, "feat", "by", etc.)
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'feat',
  'featuring',
  'ft',
  'with',
  'x',
  'vs',
  'le',
  'la',
  'les',
  'de',
  'du',
  'des',
  'et',
  'un',
  'une',
  'by',
  'song',
  'music',
  'musique',
  'play',
  'joue',
  'please',
  'stp',
  'svp',
  'track',
  'remix',
]);

function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents (marques combinantes)
    .replace(/[^a-z0-9]+/g, ' ') // ponctuation -> espace
    .trim();
}

function toTokens(s) {
  return normalizeText(s)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Distance de Levenshtein (nombre de corrections pour passer de a a b).
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1, // suppression
        dp[i - 1] + 1, // insertion
        prev + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
      prev = tmp;
    }
  }
  return dp[m];
}

// Tolerance de faute selon la longueur du mot (les mots courts doivent etre exacts).
function maxTypos(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// Le mot "word" figure-t-il dans "list", a une petite faute de frappe pres ?
function fuzzyHas(word, list) {
  for (const w of list) {
    if (w === word) return true;
    const tol = maxTypos(Math.max(word.length, w.length));
    if (tol > 0 && Math.abs(w.length - word.length) <= tol && levenshtein(word, w) <= tol) return true;
  }
  return false;
}

// Fraction des mots de refTokens retrouves dans wantedTokens (fautes tolerees), 0 a 1.
function coverage(refTokens, wantedTokens) {
  if (!refTokens.length) return 0;
  const hit = refTokens.filter((t) => fuzzyHas(t, wantedTokens)).length;
  return hit / refTokens.length;
}

// Comparaison souple entre le texte tape par un viewer et un "Titre Artiste".
// Sert a retrouver quelle demande annuler. Tolere les petites fautes de frappe.
export function looseMatch(input, reference) {
  const a = toTokens(input);
  const b = toTokens(reference);
  if (!a.length || !b.length) return false;
  return coverage(a, b) >= SEUIL;
}

// En dessous, on refuse le morceau plutot que de passer n'importe quoi.
const SEUIL = 0.6;

// Choisit le meilleur resultat Spotify pour une demande, ou null si aucun ne
// correspond VRAIMENT.
//
// Sortie de searchTrack pour etre testable sans reseau : c'est la regle qui
// decide si un viewer entend son morceau ou se fait rembourser ses points. Une
// erreur ici ne se voit pas dans un journal, elle se voit en direct.
export function choisirMeilleur(demande, resultats = []) {
  const demandeTokens = toTokens(demande || '');
  if (!demandeTokens.length || !resultats.length) return null;

  let best = null;
  for (const it of resultats) {
    const nameTokens = toTokens(it.name);
    const artistTokens = toTokens((it.artists ?? []).map((a) => a.name).join(' '));
    const candidateTokens = [...nameTokens, ...artistTokens];

    // Le titre trouve est-il present dans la demande ? (evite "Beautiful" pour "Beautiful Things")
    const titleCoverage = coverage(nameTokens, demandeTokens);
    // La demande correspond-elle bien au morceau ? (titre + artiste)
    const inputCoverage = coverage(demandeTokens, candidateTokens);
    const artistHit = artistTokens.some((t) => fuzzyHas(t, demandeTokens));

    const score = titleCoverage + inputCoverage + (artistHit ? 0.3 : 0);
    if (!best || score > best.score) best = { it, titleCoverage, inputCoverage, score };
  }

  // STRICT : le titre trouve ET la demande doivent bien se recouvrir.
  if (best.titleCoverage < SEUIL || best.inputCoverage < SEUIL) return null;

  const it = best.it;
  return {
    uri: it.uri,
    name: it.name,
    artists: (it.artists ?? []).map((a) => a.name).join(', '),
  };
}

export class SpotifyClient {
  constructor({ clientId, clientSecret, refreshToken }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accessToken = null;
    this.expiresAt = 0;
  }

  get basicAuth() {
    return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  // Renvoie un token d'acces valide (le rafraichit si besoin).
  async getToken() {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: this.basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(DELAI_RESEAU),
    });
    if (!r.ok) {
      throw new Error(
        `Spotify : echec du rafraichissement du token (${r.status}). Relance setup.bat si ca persiste.`
      );
    }
    const j = await r.json();
    this.accessToken = j.access_token;
    this.expiresAt = Date.now() + (j.expires_in ?? 3600) * 1000;
    if (j.refresh_token) this.refreshToken = j.refresh_token; // Spotify peut faire tourner le refresh token
    return this.accessToken;
  }

  async api(path, { method = 'GET', query, body } = {}) {
    const token = await this.getToken();
    let url = API + path;
    if (query) {
      // IMPORTANT : Spotify n'interprete PAS le "+" comme une espace dans /search.
      // URLSearchParams encode les espaces en "+", ce qui renvoie de MAUVAIS
      // resultats. On encode donc a la main (espaces -> %20) via encodeURIComponent.
      const qs = Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      url += '?' + qs;
    }

    const r = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // Demande une reponse non compressee : evite le "reponse non-JSON" si un
        // proxy / antivirus / VPN abime les reponses gzip/brotli.
        'Accept-Encoding': 'identity',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DELAI_RESEAU),
    });

    if (r.status === 204) return null; // Pas de contenu (fréquent pour player)

    const raw = await r.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        // Reponse OK mais pas du JSON : l'action a reussi quand meme. Certains
        // antivirus/proxys ajoutent un jeton au corps de la reponse "ajouter a la
        // file" (qui renvoie normalement un 204 vide). On ne fait donc PAS echouer.
        if (r.ok) return null;
        // Sinon (erreur HTTP + corps non-JSON) : on remonte le detail pour diagnostiquer.
        const ct = r.headers.get('content-type') || 'inconnu';
        const err = new Error(
          `Spotify: reponse NON-JSON de ${path} (HTTP ${r.status}, type "${ct}") : ${raw.slice(0, 100)}`
        );
        err.status = r.status;
        err.nonJson = true;
        throw err;
      }
    }

    if (!r.ok) {
      const reason = data?.error?.reason;
      const message = data?.error?.message || r.status;
      const err = new Error(`Spotify API ${r.status} : ${reason || message}`);
      err.status = r.status;
      err.reason = reason;
      throw err;
    }
    return data;
  }

  // Cherche le morceau demande, mais STRICTEMENT : ne renvoie un resultat que s'il
  // correspond vraiment a la demande. Sinon renvoie null -> l'appelant rembourse.
  async searchTrack(input) {
    const q = (input || '').trim();
    if (!q) return null;

    const data = await this.api('/search', { query: { q, type: 'track', limit: 6 } });
    return choisirMeilleur(q, data?.tracks?.items ?? []);
  }

  // Renvoie l'appareil Spotify actuellement actif, ou null.
  async getActiveDevice() {
    const data = await this.api('/me/player/devices');
    const devices = data?.devices ?? [];
    return devices.find((d) => d.is_active) || null;
  }

  // Ajoute un morceau a la file d'attente. Leve NO_ACTIVE_DEVICE si Spotify n'est pas actif.
  async addToQueue(uri) {
    const device = await this.getActiveDevice();
    if (!device) {
      const e = new Error('NO_ACTIVE_DEVICE');
      e.reason = 'NO_ACTIVE_DEVICE';
      throw e;
    }
    await this.api('/me/player/queue', { method: 'POST', query: { uri, device_id: device.id } });
    return device;
  }

  // Passe au morceau suivant de la file.
  async next() {
    const device = await this.getActiveDevice();
    await this.api('/me/player/next', {
      method: 'POST',
      query: device ? { device_id: device.id } : undefined,
    });
  }

  // Morceau en cours de lecture (ou null).
  async currentlyPlaying() {
    const data = await this.api('/me/player/currently-playing');
    const item = data?.item;
    if (!item) return null;
    return {
      uri: item.uri,
      name: item.name,
      artists: item.artists.map((a) => a.name).join(', '),
      isPlaying: !!data.is_playing,
    };
  }
}
