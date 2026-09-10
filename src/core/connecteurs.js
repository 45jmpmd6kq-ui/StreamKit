// Connecteurs : les services auxquels StreamKit se raccorde.
//
// Avant, chaque module portait ses propres identifiants d'application — l'ID et
// le secret Spotify vivaient dans les réglages du bot musique. Deux problèmes :
// deux modules Spotify auraient demandé deux fois la même chose, et le streamer
// devait chercher « où on configure Spotify » au fond d'un module.
//
// Ici, un connecteur est configuré UNE fois, au niveau du socle. Un module
// déclare `connecteurs: ['spotify']` et reçoit les identifiants tout prêts.
//
// Twitch reste géré par core/auth.js : son flux est plus ancien et plus imbriqué
// (résolution de la chaîne, scopes calculés depuis les modules). Il apparaît sur
// le même écran, mais son code ne passe pas par ici.

import * as store from './store.js';
import * as journal from './journal.js';
import { ouvrirNavigateur } from './auth.js';

const log = journal.pour('connecteurs');

// Chaque entrée décrit ce qu'il faut pour brancher un service, y compris la
// marche à suivre côté streamer : ces étapes sont affichées telles quelles dans
// le dashboard, pour qu'il n'ait pas à chercher ailleurs.
export const CATALOGUE = [
  {
    id: 'spotify',
    nom: 'Spotify',
    icone: '🎵',
    type: 'oauth',
    description: 'Nécessaire au bot musique : ajouter un morceau à ta file, passer au suivant.',
    consoleUrl: 'https://developer.spotify.com/dashboard',
    autorisation: 'https://accounts.spotify.com/authorize',
    jeton: 'https://accounts.spotify.com/api/token',
    profil: 'https://api.spotify.com/v1/me',
    // Le strict nécessaire : lire ce qui joue, et agir sur la lecture.
    scopes: ['user-modify-playback-state', 'user-read-playback-state', 'user-read-currently-playing'],
    // Spotify INTERDIT « localhost » et impose l'IP de bouclage explicite
    // (doc officielle : « localhost is not allowed as redirect URI »).
    // Twitch, lui, impose l'inverse : « localhost » et jamais une IP.
    // Les deux regles sont opposees, d'ou cet hote declare par connecteur.
    hoteRetour: '127.0.0.1',
    etapes: [
      'Ouvre le tableau de bord développeur Spotify et connecte-toi.',
      'Create app — nom et description libres.',
      'Redirect URI : colle l’adresse affichée ci-dessous, exactement.',
      'Coche « Web API », valide, puis récupère l’ID et le secret client.',
    ],
    // Chaque streamer crée sa propre application : une app Spotify en mode
    // développement est plafonnée à 25 utilisateurs à ajouter un par un, et le
    // quota étendu est devenu très difficile à obtenir. Avec une app par
    // streamer, la limite ne se présente jamais.
    pourquoiSonApp: true,
  },
];

export function catalogue() {
  return CATALOGUE;
}

export function trouver(id) {
  return CATALOGUE.find((c) => c.id === id) ?? null;
}

// --- Stockage ---------------------------------------------------------------
// Identifiants et jetons vont dans tokens.json, jamais dans config.json : ce
// sont des secrets, et tokens.json ne part dans aucun zip.

function lire(id) {
  return store.lireTokens().connecteurs?.[id] ?? {};
}

function ecrire(id, patch) {
  store.majTokens((t) => {
    t.connecteurs ??= {};
    t.connecteurs[id] = { ...(t.connecteurs[id] ?? {}), ...patch };
  });
}

export function definirApp(id, { clientId, clientSecret }) {
  const c = trouver(id);
  if (!c) return { ok: false, erreur: 'connecteur inconnu' };
  if (!clientId || !clientSecret) return { ok: false, erreur: 'identifiants incomplets' };
  ecrire(id, { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() });
  log.ok('Application ' + c.nom + ' enregistrée.');
  return { ok: true };
}

// Ce qu'un module reçoit via ctx.connecteur('spotify').
export function pour(id) {
  const { clientId, clientSecret, refreshToken, compte } = lire(id);
  return {
    id,
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
    refreshToken: refreshToken ?? '',
    compte: compte ?? '',
    configure: !!(clientId && clientSecret),
    connecte: !!(clientId && clientSecret && refreshToken),
    // Certains services font tourner le jeton de rafraichissement en cours
    // d'usage : le module qui s'en apercoit le repersiste ici, la ou le socle
    // le relira au prochain demarrage.
    majJeton: (nouveau) => {
      if (nouveau && nouveau !== refreshToken) ecrire(id, { refreshToken: nouveau });
    },
  };
}

export function estConnecte(id) {
  return pour(id).connecte;
}

// --- Autorisation -----------------------------------------------------------

export function urlDeRetour(id, port) {
  // Chaque service a sa propre exigence (voir hoteRetour dans le catalogue) :
  // Spotify veut 127.0.0.1, Twitch veut localhost. Defaut : localhost.
  const hote = trouver(id)?.hoteRetour ?? 'localhost';
  return 'http://' + hote + ':' + port + '/callback/connecteur/' + id;
}

// Une autorisation en cours à la fois : { id, state }
let attente = null;

export function demarrerAutorisation(id, port) {
  const c = trouver(id);
  if (!c) return { ok: false, erreur: 'connecteur inconnu' };

  const { clientId, clientSecret } = lire(id);
  if (!clientId || !clientSecret) {
    return { ok: false, erreur: 'renseigne d’abord l’ID et le secret client, puis enregistre' };
  }

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  attente = { id, state };

  const url =
    c.autorisation +
    '?' +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: urlDeRetour(id, port),
      scope: c.scopes.join(' '),
      state,
      // Sans ça, le service réutilise silencieusement l'ancienne autorisation :
      // impossible de changer de compte, et de nouveaux droits ne seraient
      // jamais demandés.
      show_dialog: 'true',
    });

  ouvrirNavigateur(url);
  log.info('Page d’autorisation ' + c.nom + ' ouverte.');
  return { ok: true, url };
}

export async function traiterRetour(id, url, port) {
  const c = trouver(id);
  if (!c) return { ok: false, message: 'Connecteur inconnu.' };

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const refus = url.searchParams.get('error');

  if (refus) {
    attente = null;
    return { ok: false, message: 'Autorisation ' + c.nom + ' refusée (' + refus + ').' };
  }
  if (!attente || attente.id !== id || attente.state !== state) {
    return {
      ok: false,
      message: "Cette page d'autorisation n'est plus valide. Relance l'opération depuis StreamKit.",
    };
  }
  if (!code) return { ok: false, message: 'Réponse incomplète de ' + c.nom + '. Réessaie.' };

  attente = null;
  const { clientId, clientSecret } = lire(id);

  try {
    const r = await fetch(c.jeton, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: urlDeRetour(id, port),
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      // Le cas de loin le plus fréquent : l'adresse de retour n'a pas été
      // ajoutée dans l'application du streamer. Le message brut ne le dit pas.
      const detail = data.error_description || data.error || 'HTTP ' + r.status;
      const conseil = /redirect/i.test(String(detail))
        ? " Vérifie que l'adresse de retour est bien enregistrée dans ton application, au caractère près."
        : '';
      return { ok: false, message: c.nom + ' a refusé : ' + detail + '.' + conseil };
    }

    if (!data.refresh_token) {
      return { ok: false, message: c.nom + " n'a pas renvoyé de jeton de rafraîchissement. Réessaie." };
    }

    // Récupérer le nom du compte : c'est ce que le streamer veut voir sur
    // l'écran, pas un jeton opaque.
    let compte = '';
    if (c.profil) {
      try {
        const p = await fetch(c.profil, {
          headers: { Authorization: 'Bearer ' + data.access_token },
        }).then((x) => x.json());
        compte = p.display_name || p.id || '';
      } catch {
        /* le compte restera vide : sans gravité */
      }
    }

    ecrire(id, { refreshToken: data.refresh_token, compte, connecteA: new Date().toISOString() });
    log.ok(c.nom + ' connecté' + (compte ? ' — ' + compte : '') + '.');
    return { ok: true, message: c.nom + ' est connecté ! Tu peux fermer cet onglet.' };
  } catch (err) {
    return { ok: false, message: 'Erreur réseau en contactant ' + c.nom + ' : ' + (err?.message || err) };
  }
}

export function deconnecter(id) {
  const c = trouver(id);
  if (!c) return { ok: false, erreur: 'connecteur inconnu' };
  ecrire(id, { refreshToken: '', compte: '', connecteA: null });
  log.info(c.nom + ' déconnecté.');
  return { ok: true };
}
