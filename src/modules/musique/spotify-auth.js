// Autorisation Spotify (OAuth 2.0, code d'autorisation).
//
// Comme pour Twitch, le streamer cree SA propre application Spotify. Ce n'est
// pas seulement une question de secret a proteger : une application Spotify en
// mode developpement est plafonnee a 25 utilisateurs a ajouter un par un, et le
// passage en quota etendu est devenu tres difficile a obtenir. Avec une app par
// streamer, la limite ne se presente jamais.
//
// Le retour arrive sur /callback/module/musique, servi par StreamKit lui-meme.

const AUTORISATION = 'https://accounts.spotify.com/authorize';
const JETON = 'https://accounts.spotify.com/api/token';

// Le strict necessaire : lire ce qui joue, et agir sur la lecture.
export const SCOPES = [
  'user-modify-playback-state', // ajouter a la file, passer au suivant
  'user-read-playback-state', // connaitre l'appareil actif
  'user-read-currently-playing', // savoir ce qui joue (pour sauter les annulees)
];

// Etat de l'autorisation en cours : { state, clientId, clientSecret, urlDeRetour }
let attente = null;

export function construireUrl({ clientId, clientSecret, urlDeRetour }) {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  attente = { state, clientId, clientSecret, urlDeRetour };

  return (
    AUTORISATION +
    '?' +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: urlDeRetour,
      scope: SCOPES.join(' '),
      state,
      // Sans ca, Spotify reutilise silencieusement l'ancienne autorisation :
      // impossible de changer de compte, et les nouveaux droits ne sont jamais
      // demandes.
      show_dialog: 'true',
    })
  );
}

// Traite le retour de Spotify. Renvoie { ok, message, refreshToken? }.
export async function traiterRetour(url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const refus = url.searchParams.get('error');

  if (refus) {
    attente = null;
    return { ok: false, message: 'Autorisation Spotify refusée (' + refus + ').' };
  }
  if (!attente || state !== attente.state) {
    return {
      ok: false,
      message: "Cette page d'autorisation n'est plus valide. Relance l'opération depuis StreamKit.",
    };
  }
  if (!code) return { ok: false, message: 'Réponse incomplète de Spotify. Réessaie.' };

  const { clientId, clientSecret, urlDeRetour } = attente;
  attente = null;

  try {
    const r = await fetch(JETON, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: urlDeRetour,
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      // Le cas de loin le plus frequent : l'URL de retour n'a pas ete ajoutee
      // dans l'application Spotify. Le message brut de Spotify ne le dit pas.
      const detail = data.error_description || data.error || 'HTTP ' + r.status;
      const conseil = /redirect/i.test(String(detail))
        ? " Vérifie que l'adresse de retour est bien enregistrée dans ton application Spotify, au caractère près."
        : '';
      return { ok: false, message: 'Spotify a refusé : ' + detail + '.' + conseil };
    }

    if (!data.refresh_token) {
      return { ok: false, message: "Spotify n'a pas renvoyé de jeton de rafraîchissement. Réessaie." };
    }

    return {
      ok: true,
      refreshToken: data.refresh_token,
      message: 'Spotify est connecté ! Tu peux fermer cet onglet et revenir sur StreamKit.',
    };
  } catch (err) {
    return { ok: false, message: 'Erreur réseau en contactant Spotify : ' + (err?.message || err) };
  }
}
