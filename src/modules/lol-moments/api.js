// Acces a l'API de la partie en cours (« Live Client Data API » de Riot).
//
// C'est le jeu lui-meme qui ouvre ce service sur https://127.0.0.1:2999
// pendant une partie, et le referme a la fin. Riot le documente pour les outils
// qui affichent la partie (overlays, statistiques) : lecture seule, rien a
// authentifier, rien d'injecte dans le jeu.
//
// Port ferme = pas de partie en cours : c'est l'etat normal hors partie, pas une
// erreur (PasDePartie).

import http from 'node:http';
import https from 'node:https';

export class PasDePartie extends Error {}

export const PORT_PAR_DEFAUT = 2999;

// Le certificat est signe par une autorite interne a Riot : le verifier sur
// 127.0.0.1 n'apporte rien. Verification coupee UNIQUEMENT sur cet agent, jamais
// globalement. keepAlive : un appel par seconde pendant toute la partie.
const agentLocal = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 2 });

function requete({ port, protocole }, chemin, timeout) {
  const transport = protocole === 'http' ? http : https;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        host: '127.0.0.1',
        port,
        path: chemin,
        method: 'GET',
        agent: protocole === 'http' ? undefined : agentLocal,
        timeout,
        headers: { Accept: 'application/json' },
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
    req.on('timeout', () => req.destroy(new PasDePartie('le jeu ne répond pas')));
    req.on('error', (e) => {
      if (e instanceof PasDePartie) reject(e);
      // Fin de partie : le jeu ferme le port, et la connexion gardee ouverte
      // tombe au premier appel suivant.
      else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(e.code)) {
        reject(new PasDePartie('pas de partie en cours'));
      } else reject(e);
    });
    req.end();
  });
}

export function creerApi({ port = PORT_PAR_DEFAUT, protocole = 'https', timeout = 4000 } = {}) {
  async function get(chemin) {
    const { statut, corps } = await requete({ port, protocole }, chemin, timeout);
    // Pendant l'ecran de chargement, le service repond deja, mais en 404/503.
    if (statut >= 400) {
      const e = new Error('le jeu a répondu ' + statut + ' sur ' + chemin);
      e.status = statut;
      throw e;
    }
    try {
      return corps ? JSON.parse(corps) : null;
    } catch {
      throw new Error('réponse illisible du jeu sur ' + chemin);
    }
  }

  return {
    // La liste COMPLETE des evenements depuis le debut de la partie, a chaque
    // appel : c'est au lecteur de retenir ce qu'il a deja vu.
    evenements: async () => {
      const r = await get('/liveclientdata/eventdata');
      return Array.isArray(r?.Events) ? r.Events : [];
    },
    joueurs: async () => {
      const r = await get('/liveclientdata/playerlist');
      return Array.isArray(r) ? r : [];
    },
    // Une chaine JSON : « Pseudo#EUW » (ou l'ancien nom d'invocateur).
    nomJoueurActif: async () => String((await get('/liveclientdata/activeplayername')) ?? ''),
    stats: () => get('/liveclientdata/gamestats'),
  };
}
