// Client de l'API Clubs d'EA SPORTS FC (proclubs.ea.com).
//
// C'est l'API du site des clubs d'EA, et avec lui de tous les trackers FC 27.
// Elle n'est PAS documentee : ses reponses peuvent changer sans prevenir, et EA
// l'a deja coupee plusieurs jours (forum EA, juin 2026). Le module doit donc se
// taire proprement quand elle ne repond pas, jamais planter.
//
// EA la protege contre les robots (Akamai). Le fetch de Node n'obtient AUCUNE
// reponse (verifie le 29/09/2026) ; la pile reseau de Chromium, celle
// d'Electron, obtient un 200 en s'annoncant telle qu'elle est (« Electron/44 »
// dans son User-Agent). On passe donc par net.fetch d'Electron, et on ne se
// deguise jamais en navigateur -- pas de faux User-Agent, pas de faux en-tetes :
// si EA ferme un jour la porte, le module le dit, il ne force pas.
//
// Reperes verifies sur de vraies reponses (29/09/2026) :
//   - tout arrive en chaines, nombres compris ("25", "7.40") ;
//   - /clubs/matches renvoie 10 matchs au plus, quel que soit maxResultCount :
//     le module retient donc lui-meme les matchs de la soiree ;
//   - la recherche ignore la casse et marche par debut de nom (« Nothing »
//     renvoie 14 clubs) ; un nom inconnu donne [] ; un nom trop long, un 500 ;
//   - /clubs/info ne prend qu'UN identifiant (deux : 400), et rend
//     { "<id>": { name, customKit, ... } } (verifie le 01/10/2026).

const BASE = 'https://proclubs.ea.com/api/fc/';

// PS5, Xbox Series et PC jouent ensemble : une seule plateforme pour eux. Les
// Clubs de FC 27 n'existent pas sur PS4, Xbox One ni Switch 1.
export const PLATEFORME = 'common-gen5';

export const MATCHS_PAR_REQUETE = 10;

// Le nom de club le plus long qu'EA accepte de chercher : 24 caracteres passent,
// 32 font repondre la recherche en 500 (ERR_TDF_STRING_TOO_LONG).
export const NOM_MAX = 30;

// Types de match cote EA, par nom du module.
export const TYPES = {
  championnat: 'leagueMatch',
  playoffs: 'playoffMatch',
  amical: 'friendlyMatch',
};

const DELAI_MS = 15_000;

export class ErreurEA extends Error {
  constructor(message, { statut = 0, reseau = false } = {}) {
    super(message);
    this.name = 'ErreurEA';
    this.statut = statut;
    this.reseau = reseau;
  }
}

// Le fetch a utiliser : celui de Chromium dans l'application, celui de Node
// ailleurs (tests, `node src/index.js`), ou EA ne repondra pas.
export async function moteurReseau() {
  try {
    const electron = await import('electron');
    const net = electron.net ?? electron.default?.net;
    if (typeof net?.fetch === 'function') {
      return { nom: 'electron', fetch: (url, options) => net.fetch(url, options) };
    }
  } catch {
    // Hors d'Electron, le paquet `electron` n'exporte que le chemin de son binaire.
  }
  // Lu a chaque appel : les tests remplacent globalThis.fetch apres le demarrage.
  return { nom: 'node', fetch: (url, options) => globalThis.fetch(url, options) };
}

export function creerClientEA({ fetch, delaiMs = DELAI_MS }) {
  async function lire(chemin, params) {
    const url = BASE + chemin + '?' + new URLSearchParams({ platform: PLATEFORME, ...params });
    const arret = new AbortController();
    let minuterie;

    // Le delai est tenu ici, et pas seulement par le signal : rien ne garantit
    // que net.fetch l'honore, et une requete pendue figerait le module pour de
    // bon (son intervalle saute les tours tant que le precedent tourne).
    const delai = new Promise((_, echec) => {
      minuterie = setTimeout(() => {
        arret.abort();
        echec(new ErreurEA('EA ne répond pas', { reseau: true }));
      }, delaiMs);
    });

    const travail = (async () => {
      let reponse;
      try {
        reponse = await fetch(url, { headers: { accept: 'application/json' }, signal: arret.signal });
      } catch (e) {
        throw new ErreurEA('EA injoignable (' + (e?.message || e) + ')', { reseau: true });
      }
      const texte = await reponse.text();
      if (!reponse.ok) throw new ErreurEA('EA a répondu ' + reponse.status, { statut: reponse.status });
      try {
        return JSON.parse(texte);
      } catch {
        throw new ErreurEA('réponse d’EA illisible');
      }
    })();
    // Perdant de la course : son rejet tardif ne doit pas remonter sans preneur.
    travail.catch(() => {});

    try {
      return await Promise.race([travail, delai]);
    } finally {
      clearTimeout(minuterie);
    }
  }

  return {
    rechercher: (nom) => lire('allTimeLeaderboard/search', { clubName: nom }),
    matchs: (clubId, type) =>
      lire('clubs/matches', { clubIds: clubId, matchType: TYPES[type], maxResultCount: MATCHS_PAR_REQUETE }),
    stats: (clubId) => lire('clubs/overallStats', { clubIds: clubId }),
    info: (clubId) => lire('clubs/info', { clubIds: clubId }),
  };
}
