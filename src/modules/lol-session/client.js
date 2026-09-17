// Acces au client League of Legends, par son API locale.
//
// Le client ecrit un « lockfile » dans son dossier d'installation tant qu'il
// tourne : « LeagueClient:<pid>:<port>:<mot de passe>:<protocole> ». Avec ces
// deux informations, on l'interroge exactement comme sa propre interface le fait
// (phase de jeu, classement, historique).
//
// Aucune injection, aucune lecture de la memoire du jeu, aucune automatisation :
// on ne fait que LIRE ce que le client affiche deja. En revanche cette API n'est
// pas documentee par Riot et peut changer a n'importe quel patch.

import http from 'node:http';
import https from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class ErreurClient extends Error {}

const DOSSIER_PAR_DEFAUT = 'C:\\Riot Games\\League of Legends';

// Le Riot Client note ou il a installe chaque jeu, dans un petit YAML :
//   product_install_full_path: "D:/Jeux/Riot Games/League of Legends"
// Utile quand le jeu n'est pas dans le dossier par defaut.
export function dossierDepuisMetadonnees(texte) {
  const m = /^\s*product_install_full_path:\s*"?([^"\r\n]+?)"?\s*$/m.exec(String(texte || ''));
  return m ? m[1].replace(/\//g, '\\') : '';
}

export function trouverDossier(force = '', programData = process.env.ProgramData || 'C:\\ProgramData') {
  const saisi = String(force || '').trim();
  if (saisi) return saisi;
  try {
    const meta = join(
      programData,
      'Riot Games',
      'Metadata',
      'league_of_legends.live',
      'league_of_legends.live.product_settings.yaml'
    );
    const dossier = dossierDepuisMetadonnees(readFileSync(meta, 'utf8'));
    if (dossier) return dossier;
  } catch {
    /* metadonnees absentes : on tente le dossier par defaut */
  }
  return DOSSIER_PAR_DEFAUT;
}

// -> { port, motDePasse, protocole } ou null si le contenu est illisible.
export function lireLockfile(texte) {
  const parts = String(texte || '')
    .trim()
    .split(':');
  if (parts.length < 5) return null;
  const port = Number(parts[2]);
  if (!Number.isInteger(port) || port <= 0) return null;
  return { port, motDePasse: parts[3], protocole: parts[4] === 'http' ? 'http' : 'https' };
}

// L'API locale presente un certificat auto-signe : le verifier n'a pas de sens
// sur 127.0.0.1, et le client ne fournit pas d'autre voie. On desactive la
// verification UNIQUEMENT sur cet agent, jamais globalement.
const agentLocal = new https.Agent({ rejectUnauthorized: false });

function requete(acces, chemin, timeout) {
  const transport = acces.protocole === 'http' ? http : https;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        host: '127.0.0.1',
        port: acces.port,
        path: chemin,
        method: 'GET',
        agent: acces.protocole === 'http' ? undefined : agentLocal,
        timeout,
        headers: {
          Accept: 'application/json',
          Authorization: 'Basic ' + Buffer.from('riot:' + acces.motDePasse).toString('base64'),
        },
      },
      (res) => {
        // Des Buffer, decodes une seule fois : un pseudo accentue coupe entre
        // deux paquets deviendrait illisible avec une chaine concatenee.
        const morceaux = [];
        res.on('data', (c) => morceaux.push(c));
        res.on('end', () =>
          resolve({ statut: res.statusCode, corps: Buffer.concat(morceaux).toString('utf8') })
        );
      }
    );
    req.on('timeout', () => req.destroy(new ErreurClient('le client ne répond pas')));
    req.on('error', (e) => {
      // Le lockfile peut survivre a une fermeture brutale : le fichier est la,
      // mais plus personne n'ecoute sur le port.
      if (e instanceof ErreurClient) reject(e);
      else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(e.code)) {
        reject(new ErreurClient('client fermé'));
      } else reject(e);
    });
    req.end();
  });
}

export function creerClient({ dossier, timeout = 8000 }) {
  let acces = null;
  let signature = '';

  function lireAcces() {
    const chemin = join(dossier(), 'lockfile');
    let texte;
    try {
      texte = existsSync(chemin) ? readFileSync(chemin, 'utf8') : '';
    } catch {
      texte = ''; // verrouille pendant son ecriture : on retentera au tour suivant
    }
    const lu = lireLockfile(texte);
    if (!lu) {
      acces = null;
      signature = '';
      throw new ErreurClient('client fermé');
    }
    acces = lu;
    signature = lu.port + ':' + lu.motDePasse;
    return lu;
  }

  // GET JSON. absentSi404 : pour ce qui n'existe pas encore (pas de partie en
  // cours, detail pas encore publie), null plutot qu'une erreur.
  async function get(chemin, { absentSi404 = false } = {}) {
    const a = acces ?? lireAcces();
    const { statut, corps } = await requete(a, chemin, timeout);
    if (statut === 404 && absentSi404) return null;
    if (statut >= 400) {
      const e = new Error('le client a répondu ' + statut + ' sur ' + chemin.split('?')[0]);
      e.status = statut;
      throw e;
    }
    try {
      return corps ? JSON.parse(corps) : null;
    } catch {
      throw new Error('réponse illisible du client sur ' + chemin.split('?')[0]);
    }
  }

  return {
    // A appeler a chaque tour : le client a pu redemarrer (nouveau port, nouveau
    // mot de passe) ou se fermer depuis le tour precedent.
    rafraichir: () => lireAcces(),
    signature: () => signature,
    dossier,

    phase: () => get('/lol-gameflow/v1/gameflow-phase'),
    session: () => get('/lol-gameflow/v1/session', { absentSi404: true }),
    invocateur: () => get('/lol-summoner/v1/current-summoner', { absentSi404: true }),
    classement: () => get('/lol-ranked/v1/current-ranked-stats'),
    historique: (nombre = 10) =>
      get('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=' + (nombre - 1)),
    partie: (id) => get('/lol-match-history/v1/games/' + Number(id), { absentSi404: true }),
  };
}
