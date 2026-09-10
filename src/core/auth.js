// Autorisation Twitch (OAuth 2.0, code d'autorisation).
//
// Choix assume : chaque streamer cree SA propre application Twitch, via
// l'assistant du dashboard. Consequence -- il n'y a aucun secret partage a
// proteger, donc aucun serveur a heberger : StreamKit reste 100 % local.
// Le cout est un assistant de 5 minutes a la premiere installation, exactement
// comme le setup.bat actuel du bot musique.
//
// Le retour d'autorisation arrive sur le serveur de StreamKit lui-meme
// (http://localhost:<port>/callback/twitch) : pas de second serveur temporaire.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as journal from './journal.js';
import * as store from './store.js';
import { fetchAvecDelai } from './reseau.js';

const log = journal.pour('auth');

// En cours d'autorisation : { state, resolve, minuteur }
let attente = null;

export function urlDeRetour(port) {
  // Twitch refuse une IP en http : « localhost » est obligatoire ici.
  return 'http://localhost:' + port + '/callback/twitch';
}

// "fetch failed" ne dit rien a personne : on traduit la vraie cause en conseil.
// (reprise du bot musique V2, ou ces cas se sont reellement produits)
export function expliquerErreurReseau(err) {
  const cause = err?.cause ?? {};
  // err.name recupere les TimeoutError d'AbortSignal.timeout, qui n'ont pas de
  // code : sans lui, un delai depasse tombait dans le conseil generique.
  const code = cause.code || err?.code || err?.name || '';
  let conseil = 'Verifie ta connexion internet, puis reessaie.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) {
    conseil = "Le PC n'arrive pas a joindre id.twitch.tv (DNS). Coupe un eventuel VPN, puis reessaie.";
  } else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    conseil =
      "Un antivirus ou un VPN inspecte le HTTPS et Node.js refuse son certificat. " +
      "Ajoute une exception pour node.exe, puis reessaie.";
  } else if (/ECONNREFUSED|ECONNRESET|EPIPE|EPROTO/i.test(code)) {
    conseil = "La connexion a ete coupee (pare-feu, antivirus ou proxy). Autorise node.exe a sortir.";
  } else if (/TIMEOUT/i.test(code)) {
    conseil = 'Delai depasse en contactant Twitch. Reessaie dans un instant.';
  }
  return { detail: [code, cause.message].filter(Boolean).join(' — ') || 'reseau indisponible', conseil };
}

export async function twitchJoignable() {
  try {
    await fetchAvecDelai('https://id.twitch.tv/oauth2/validate');
    return { ok: true };
  } catch (err) {
    return { ok: false, ...expliquerErreurReseau(err) };
  }
}

export function ouvrirNavigateur(url) {
  try {
    if (process.platform === 'win32') {
      // Le "" est le titre de fenetre : sans lui, start prend l'URL pour un titre.
      spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

// Lance l'autorisation. Renvoie l'URL a ouvrir (au cas ou le navigateur ne
// s'ouvre pas tout seul) et une promesse resolue au retour de Twitch.
export function demarrerAutorisation({ port, scopes }) {
  const tokens = store.lireTokens();
  const app = tokens.twitchApp ?? {};
  if (!app.clientId || !app.clientSecret) {
    return { ok: false, raison: "l'application Twitch n'est pas encore renseignee" };
  }

  annuler('nouvelle demande');

  // randomBytes et pas Math.random : ce jeton est ce qui lie le retour de
  // Twitch a la demande qu'on a nous-meme lancee. Math.random n'est pas
  // imprevisible, et coute ici exactement la meme chose que le vrai aleatoire.
  const state = randomBytes(16).toString('hex');
  const url =
    'https://id.twitch.tv/oauth2/authorize?' +
    new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: urlDeRetour(port),
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      // force_verify : sans ca, Twitch reutilise silencieusement l'ancienne
      // autorisation et les nouveaux droits ne sont jamais demandes.
      force_verify: 'true',
    });

  const promesse = new Promise((resolve) => {
    attente = {
      state,
      resolve,
      minuteur: setTimeout(() => annuler('delai depasse (5 minutes)'), 5 * 60000),
    };
  });

  ouvrirNavigateur(url);
  log.info('Page d\'autorisation Twitch ouverte. Droits demandes : ' + scopes.length + '.');

  return { ok: true, url, promesse };
}

function annuler(raison) {
  if (!attente) return;
  clearTimeout(attente.minuteur);
  attente.resolve({ ok: false, raison });
  attente = null;
}

// Appele par le serveur quand Twitch renvoie le navigateur sur /callback/twitch.
export async function traiterRetour(url, port) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const refus = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (refus) {
    annuler('autorisation refusee : ' + refus);
    return { ok: false, message: "Autorisation refusee. Tu peux fermer cet onglet et reessayer depuis StreamKit." };
  }
  if (!attente || state !== attente.state) {
    return { ok: false, message: "Cette page d'autorisation n'est plus valide. Relance l'operation depuis StreamKit." };
  }
  if (!code) {
    return { ok: false, message: 'Reponse incomplete de Twitch. Reessaie.' };
  }

  const tokens = store.lireTokens();
  const app = tokens.twitchApp;

  try {
    const r = await fetchAvecDelai('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: urlDeRetour(port),
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = data.message || 'echange du code impossible';
      annuler(msg);
      return { ok: false, message: 'Twitch a refuse : ' + msg };
    }

    // Format attendu par RefreshingAuthProvider de @twurple/auth.
    const jeton = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope ?? [],
      expiresIn: data.expires_in ?? 0,
      obtainmentTimestamp: Date.now(),
    };
    store.majTokens((t) => {
      t.twitch = jeton;
    });

    clearTimeout(attente.minuteur);
    attente.resolve({ ok: true, scopes: jeton.scope });
    attente = null;

    log.ok('Chaine autorisee. ' + (jeton.scope?.length ?? 0) + ' droit(s) accorde(s).');
    return { ok: true, message: "C'est bon ! Tu peux fermer cet onglet et revenir sur StreamKit." };
  } catch (err) {
    const { detail, conseil } = expliquerErreurReseau(err);
    annuler(detail);
    return { ok: false, message: 'Erreur reseau : ' + detail + '. ' + conseil };
  }
}

// Petite page HTML de retour : le streamer voit un resultat clair, pas du JSON.
//
// Le message n'est PAS forcement de nous : Spotify et Twitch renvoient leur
// refus dans l'URL (?error=...), et on le recopie pour que le streamer sache
// ce qu'on lui reproche. Sans echappement, il suffisait d'envoyer le streamer
// sur /callback/connecteur/spotify?error=<script>... pour executer du code sur
// notre propre origine -- donc avec un acces complet a l'API locale, jetons
// compris. Tout ce qui vient de l'exterieur passe par echapper().
function echapper(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function pageRetour({ ok, message }) {
  const couleur = ok ? '#22c55e' : '#f43f5e';
  const titre = ok ? 'Autorisation reussie' : 'Autorisation echouee';
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<title>StreamKit — ' + titre + '</title>' +
    '<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0d0d12;' +
    'color:#e8e8f0;font:16px/1.6 system-ui,Segoe UI,sans-serif}' +
    '.c{max-width:32rem;padding:2.5rem;text-align:center}' +
    'h1{font-size:1.4rem;margin:0 0 .75rem;color:' + couleur + '}' +
    'p{margin:0;color:#9a9aae}</style></head><body><div class="c">' +
    '<h1>' + titre + '</h1><p>' + echapper(message ?? '') + '</p></div></body></html>'
  );
}
