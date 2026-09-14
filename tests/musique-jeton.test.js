// Renouvellement du jeton Spotify par le bot musique.
//
// Le test qui manquait depuis la 0.14.0. Le passage de Spotify en PKCE avait
// ete teste cote connexion (echange du code, dans connecteurs.js) mais pas cote
// module : SpotifyClient continuait d'envoyer un en-tete Basic, avec un secret
// VIDE puisqu'une connexion PKCE n'en a pas. Spotify le refuse, et le bot
// echouait des sa premiere demande de musique. Personne ne l'a vu parce que le
// module n'a pas tourne depuis.
//
// On remplace fetch par un faux Spotify qui applique la meme regle que le vrai :
// une application sans secret s'identifie par client_id dans le corps.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const { SpotifyClient } = await import('../src/modules/musique/spotify.js');
const connecteurs = await import('../src/core/connecteurs.js');
const store = await import('../src/core/store.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();
afterEach(() => mock.restoreAll());
after(() => nettoyer(DONNEES));

// Faux point d'entree des jetons Spotify. Il note chaque requete, et repond
// comme Spotify : invalid_client si l'application ne s'identifie pas
// correctement, un jeton sinon.
function fauxSpotify({ secretAttendu = null, nouveauRefresh = null } = {}) {
  const requetes = [];
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const corps = new URLSearchParams(String(options.body ?? ''));
    const auth = options.headers?.Authorization ?? null;
    requetes.push({ url: String(url), auth, corps: Object.fromEntries(corps) });

    const identifie = secretAttendu
      ? auth === 'Basic ' + Buffer.from('id-spotify:' + secretAttendu).toString('base64')
      : !auth && corps.get('client_id') === 'id-spotify';
    if (!identifie) {
      return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 });
    }
    return Response.json({
      access_token: 'jeton-acces-' + requetes.length,
      expires_in: 3600,
      ...(nouveauRefresh ? { refresh_token: nouveauRefresh } : {}),
    });
  });
  return requetes;
}

test('connexion PKCE : l application s identifie par client_id, sans en-tete Basic', async () => {
  const requetes = fauxSpotify();
  const spotify = new SpotifyClient({ clientId: 'id-spotify', clientSecret: '', refreshToken: 'refresh-1' });

  assert.equal(await spotify.getToken(), 'jeton-acces-1');

  const [r] = requetes;
  assert.equal(r.url, 'https://accounts.spotify.com/api/token');
  assert.equal(r.auth, null, 'aucun en-tete Basic : il n y a pas de secret');
  assert.deepEqual(r.corps, {
    grant_type: 'refresh_token',
    refresh_token: 'refresh-1',
    client_id: 'id-spotify',
  });
});

test('ancien flux avec secret : l en-tete Basic reste, sans client_id dans le corps', async () => {
  // Un streamer connecte avant la 0.14.0 et jamais reconnecte depuis.
  const requetes = fauxSpotify({ secretAttendu: 'secret-historique' });
  const spotify = new SpotifyClient({
    clientId: 'id-spotify',
    clientSecret: 'secret-historique',
    refreshToken: 'refresh-1',
  });

  assert.equal(await spotify.getToken(), 'jeton-acces-1');
  assert.equal(requetes[0].corps.client_id, undefined);
});

test('le bot branche sur une vraie connexion PKCE obtient son jeton', async () => {
  // De bout en bout cote StreamKit : ce que connecteurs.pour() rend apres une
  // connexion PKCE, passe au client exactement comme le fait le module musique.
  store.majTokens((t) => {
    t.connecteurs = { spotify: { clientId: 'id-spotify', clientSecret: '', refreshToken: 'refresh-1' } };
  });
  const conn = connecteurs.pour('spotify');
  assert.equal(conn.connecte, true);

  fauxSpotify();
  const spotify = new SpotifyClient({
    clientId: conn.clientId,
    clientSecret: conn.clientSecret,
    refreshToken: conn.refreshToken,
  });
  assert.equal(await spotify.getToken(), 'jeton-acces-1', 'Spotify doit accepter la demande');
});

test('un jeton de rafraichissement renouvele par Spotify est garde', async () => {
  fauxSpotify({ nouveauRefresh: 'refresh-2' });
  const spotify = new SpotifyClient({ clientId: 'id-spotify', clientSecret: '', refreshToken: 'refresh-1' });

  await spotify.getToken();
  assert.equal(spotify.refreshToken, 'refresh-2', 'l ancien jeton ne servirait plus');
});

test('le jeton d acces est reutilise tant qu il est valide', async () => {
  const requetes = fauxSpotify();
  const spotify = new SpotifyClient({ clientId: 'id-spotify', clientSecret: '', refreshToken: 'refresh-1' });

  await spotify.getToken();
  await spotify.getToken();
  assert.equal(requetes.length, 1, 'pas un aller-retour chez Spotify a chaque appel');
});

test('un refus de Spotify donne un message qui dit quoi faire', async () => {
  fauxSpotify({ secretAttendu: 'un-secret-que-le-client-n-a-pas' });
  const spotify = new SpotifyClient({ clientId: 'id-spotify', clientSecret: '', refreshToken: 'refresh-1' });

  await assert.rejects(spotify.getToken(), /Reconnecte Spotify dans l'ecran Connecteurs/);
});
