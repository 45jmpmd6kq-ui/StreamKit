// Acces aux donnees Valorant du joueur.
//
// Principe, repris tel quel du projet Valorant-Overlay :
//   - on lit le lockfile que le Riot Client ecrit lui-meme, pour connaitre le
//     port et le mot de passe de son API locale ;
//   - on recupere les jetons via /entitlements/v1/token ;
//   - on interroge les endpoints MMR de Riot avec ces jetons, exactement comme
//     le client officiel quand il affiche ta carriere.
//
// Aucune injection, aucune lecture de la memoire du jeu, aucune automatisation :
// Vanguard n'est jamais sollicite. En revanche l'API locale n'est pas supportee
// par Riot et peut changer a n'importe quel patch.

import https from 'node:https';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
const LOCKFILE = join(LOCALAPPDATA, 'Riot Games', 'Riot Client', 'Config', 'lockfile');
const JOURNAL_JEU = join(LOCALAPPDATA, 'VALORANT', 'Saved', 'Logs', 'ShooterGame.log');

// Le client officiel envoie cet en-tete sur chaque appel PD. La valeur est une
// constante cote client : elle decrit la plateforme, pas la machine.
const CLIENT_PLATFORM = Buffer.from(
  JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  })
).toString('base64');

// Les endpoints pvp.net sont derriere Cloudflare, qui rejette les User-Agent
// d'automate : sans en-tete credible on recoit un 403 « error code: 1010 ».
const UA = (build) => 'RiotClient/' + build + ' rso-auth (Windows;10;;Professional, x64)';
const BUILD_DE_SECOURS = '111.0.0.3261.5663';

// Les regions d'Amerique latine et du Bresil sont hebergees sur le shard NA.
const SHARD_PAR_REGION = { latam: 'na', br: 'na' };

export class ErreurClient extends Error {}

// L'API locale du Riot Client presente un certificat auto-signe : le verifier
// n'a pas de sens sur 127.0.0.1, et le client ne fournit pas d'autre voie.
// On desactive la verification UNIQUEMENT sur cet agent, jamais globalement.
const agentLocal = new https.Agent({ rejectUnauthorized: false });

function jsonLocal(port, chemin, motDePasse, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        path: chemin,
        method: 'GET',
        agent: agentLocal,
        timeout,
        headers: {
          Authorization: 'Basic ' + Buffer.from('riot:' + motDePasse).toString('base64'),
        },
      },
      (res) => {
        let corps = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (corps += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new ErreurClient('API locale : HTTP ' + res.statusCode));
          }
          try {
            resolve(JSON.parse(corps));
          } catch {
            reject(new ErreurClient('reponse illisible de l API locale'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new ErreurClient('API locale : delai depasse')));
    req.on('error', (e) => {
      // Le lockfile survit a une fermeture brutale du client : le fichier est
      // toujours la, mais plus personne n'ecoute sur le port.
      if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(e.code)) {
        reject(new ErreurClient('Riot Client fermé'));
      } else reject(e);
    });
    req.end();
  });
}

// ('eu', 'eu') lu dans le journal du jeu, qui contient l'URL GLZ complete.
// C'est la source la plus fiable : elle donne region ET shard, qui different
// pour LATAM et BR. Le journal n'existe qu'apres un premier lancement du jeu.
export function regionDepuisJournal() {
  try {
    const taille = statSync(JOURNAL_JEU).size;
    const debut = Math.max(0, taille - 400_000);
    const tampon = Buffer.alloc(Math.min(400_000, taille));
    const fd = openSync(JOURNAL_JEU, 'r');
    try {
      readSync(fd, tampon, 0, tampon.length, debut);
    } finally {
      closeSync(fd);
    }
    const texte = tampon.toString('utf8');
    const trouves = [...texte.matchAll(/https:\/\/glz-([a-z0-9-]+)-1\.([a-z0-9]+)\.a\.pvp\.net/g)];
    if (trouves.length) {
      const dernier = trouves[trouves.length - 1];
      return { region: dernier[1], shard: dernier[2] };
    }
  } catch {
    /* journal absent : le jeu n'a jamais ete lance sur ce poste */
  }
  return { region: '', shard: '' };
}

export class ClientRiot {
  constructor({ meta, regionForcee = '', shardForce = '' }) {
    this.meta = meta;
    this.regionForcee = regionForcee.trim().toLowerCase();
    this.shardForce = shardForce.trim().toLowerCase();

    this.port = 0;
    this.motDePasse = '';
    this.puuid = '';
    this.access = '';
    this.entitlement = '';
    this.nom = '';
    this.tag = '';
    this.region = '';
    this.shard = '';
    this.authA = 0;
  }

  lireLockfile() {
    if (!existsSync(LOCKFILE)) {
      this.port = 0;
      throw new ErreurClient('Riot Client fermé');
    }
    const parts = readFileSync(LOCKFILE, 'utf8').trim().split(':');
    if (parts.length < 5) throw new ErreurClient('lockfile illisible');

    const port = Number(parts[2]);
    const motDePasse = parts[3];
    if (port !== this.port || motDePasse !== this.motDePasse) {
      // Le client a redemarre : les anciens jetons ne valent plus rien.
      this.port = port;
      this.motDePasse = motDePasse;
      this.authA = 0;
      this.access = '';
    }
  }

  local(chemin) {
    if (!this.port) throw new ErreurClient('Riot Client fermé');
    return jsonLocal(this.port, chemin, this.motDePasse);
  }

  async authentifier() {
    const data = await this.local('/entitlements/v1/token');
    this.access = data.accessToken || '';
    this.entitlement = data.token || '';
    this.puuid = data.subject || '';
    if (!this.access || !this.entitlement || !this.puuid) {
      throw new ErreurClient('pas encore connecté au compte Riot');
    }
    this.authA = Date.now();
  }

  async detecterRegion() {
    if (this.shardForce) {
      this.region = this.regionForcee || this.shardForce;
      this.shard = this.shardForce;
      return;
    }

    let { region, shard } = regionDepuisJournal();
    if (!region) {
      try {
        const d = await this.local('/riotclient/region-locale');
        region = (d.region || '').toLowerCase();
      } catch {
        region = '';
      }
      shard = SHARD_PAR_REGION[region] || region;
    }
    if (!region) {
      throw new ErreurClient(
        "région introuvable — renseigne-la dans les réglages du module (eu, na, ap, kr…)"
      );
    }
    this.region = region;
    this.shard = shard;
  }

  async preparer() {
    this.lireLockfile();
    // Les jetons ont une duree de vie courte : on repasse toutes les 5 minutes.
    if (!this.access || Date.now() - this.authA > 300_000) await this.authentifier();
    if (!this.shard) await this.detecterRegion();
  }

  // --- Endpoints joueur (internet) -----------------------------------------

  async pd(chemin, timeout = 15000) {
    const r = await fetch('https://pd.' + this.shard + '.a.pvp.net' + chemin, {
      headers: {
        Authorization: 'Bearer ' + this.access,
        'X-Riot-Entitlements-JWT': this.entitlement,
        'X-Riot-ClientPlatform': CLIENT_PLATFORM,
        'X-Riot-ClientVersion': this.meta.version || '',
        'User-Agent': UA(this.meta.client_build || BUILD_DE_SECOURS),
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (!r.ok) {
      // Jetons perimes : on forcera une nouvelle authentification au tour suivant.
      if ([400, 401, 403].includes(r.status)) this.authA = 0;
      const e = new Error('Riot a répondu ' + r.status + ' sur ' + chemin.split('?')[0]);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }

  // Etat de session decode depuis la presence chat : 100 % local, aucun appel
  // internet. C'est ce qui dit si le joueur est en menu, en file ou en match.
  async presence() {
    const data = await this.local('/chat/v4/presences');
    for (const p of data.presences || []) {
      if (p.puuid !== this.puuid || p.product !== 'valorant') continue;
      this.nom = p.game_name || this.nom;
      this.tag = p.game_tag || this.tag;
      try {
        return JSON.parse(Buffer.from(p.private || '', 'base64').toString('utf8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  mmr() {
    return this.pd('/mmr/v1/players/' + this.puuid);
  }

  async misesAJourClassees(nombre = 20) {
    const data = await this.pd(
      '/mmr/v1/players/' + this.puuid + '/competitiveupdates' +
        '?startIndex=0&endIndex=' + nombre + '&queue=competitive'
    );
    return (data.Matches || []).filter((m) => m.MatchID);
  }

  // Les reponses de detail pesent plusieurs Mo : delai allonge en consequence.
  detailMatch(matchId) {
    return this.pd('/match-details/v1/matches/' + matchId, 45000);
  }
}

// ('W', 13, 11) depuis le detail d'un match, ou null si illisible.
export function resultatDepuisDetail(data, puuid) {
  const moi = (data.players || []).find((p) => p.subject === puuid);
  if (!moi) return null;

  const equipes = data.teams || [];
  const mienne = equipes.find((t) => t.teamId === moi.teamId);
  const autre = equipes.find((t) => t.teamId !== moi.teamId);
  if (!mienne) return null;

  const gagnes = Number(mienne.roundsWon || 0);
  const perdus = autre ? Number(autre.roundsWon || 0) : 0;
  const resultat = mienne.won ? 'W' : gagnes === perdus ? 'D' : 'L';
  return { resultat, gagnes, perdus };
}
