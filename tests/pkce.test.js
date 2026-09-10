// Autorisation Spotify par PKCE (RFC 7636).
//
// Ce qui change pour le streamer : il ne saisit plus qu'un identifiant client.
// Il n'y a plus de secret Spotify -- ni a taper, ni a stocker, ni a perdre, ni
// a laisser fuiter. Un secret qui n'existe pas est le seul qu'on soit sur de
// ne pas compromettre.
//
// Ce qui doit rester vrai malgre tout : une autorisation obtenue AVANT ce
// changement continue de fonctionner avec son secret, jusqu'a ce que le
// streamer se reconnecte. Personne ne doit avoir a refaire quoi que ce soit le
// jour de la mise a jour.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const connecteurs = await import('../src/core/connecteurs.js');
const store = await import('../src/core/store.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();
after(() => nettoyer(DONNEES));

const SPOTIFY = connecteurs.trouver('spotify');
const RETOUR = 'http://127.0.0.1:4455/callback/connecteur/spotify';

// Remet le connecteur a zero entre deux tests : ils partagent le meme fichier.
function poser(valeurs) {
  store.majTokens((t) => {
    t.connecteurs = { spotify: valeurs };
  });
}

// --- Le calcul lui-meme ---------------------------------------------------

test('le defi est calcule comme le veut la RFC 7636', () => {
  // Vecteur officiel, annexe B de la RFC. Si ce test tombe, c'est le calcul
  // qui est faux -- et Spotify refusera l'echange avec un message opaque.
  assert.equal(
    connecteurs.defiDeCode('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );
});

test('le verifieur respecte la longueur et l alphabet imposes', () => {
  const v = connecteurs.fabriquerVerifieur();
  assert.ok(v.length >= 43 && v.length <= 128, 'longueur hors bornes : ' + v.length);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/, 'caractere interdit dans le verifieur : ' + v);
});

test('deux verifieurs ne se ressemblent pas', () => {
  // Tout l echange repose sur son imprevisibilite.
  const vus = new Set(Array.from({ length: 50 }, () => connecteurs.fabriquerVerifieur()));
  assert.equal(vus.size, 50);
});

// --- L URL d autorisation -------------------------------------------------

test('l URL PKCE porte le defi, jamais le verifieur', () => {
  const verifieur = connecteurs.fabriquerVerifieur();
  const url = new URL(
    connecteurs.urlAutorisation(SPOTIFY, {
      clientId: 'mon-id',
      redirect: RETOUR,
      state: 'abcdef',
      defi: connecteurs.defiDeCode(verifieur),
    })
  );

  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), connecteurs.defiDeCode(verifieur));
  assert.ok(!url.href.includes(verifieur), 'le verifieur ne doit pas partir dans l URL');
  assert.ok(!url.href.includes('secret'), 'aucun secret ne doit figurer dans l URL');

  // Ce qui ne change pas.
  assert.equal(url.searchParams.get('client_id'), 'mon-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), RETOUR);
  assert.equal(url.searchParams.get('show_dialog'), 'true');
});

test('sans defi, l URL reste celle de l ancien flux', () => {
  const url = new URL(
    connecteurs.urlAutorisation(SPOTIFY, {
      clientId: 'mon-id',
      redirect: RETOUR,
      state: 'abcdef',
      defi: null,
    })
  );
  assert.equal(url.searchParams.get('code_challenge'), null);
  assert.equal(url.searchParams.get('code_challenge_method'), null);
});

// --- Ce que le streamer doit saisir ---------------------------------------

test('Spotify est declare en PKCE', () => {
  assert.equal(connecteurs.estPkce('spotify'), true);
  assert.equal(connecteurs.estPkce('service-inexistant'), false);
});

test('un identifiant client suffit a configurer Spotify', () => {
  poser({});
  assert.deepEqual(connecteurs.definirApp('spotify', { clientId: 'mon-id' }), { ok: true });

  const e = connecteurs.pour('spotify');
  assert.equal(e.pkce, true);
  assert.equal(e.configure, true, 'sans secret, le connecteur doit etre considere configure');
  assert.equal(e.clientSecret, '', 'aucun secret ne doit avoir ete invente');
});

test('un identifiant vide reste refuse', () => {
  poser({});
  assert.equal(connecteurs.definirApp('spotify', { clientId: '  ' }).ok, false);
  assert.equal(connecteurs.definirApp('spotify', {}).ok, false);
});

test('enregistrer l ID n efface pas un secret herite de l ancien flux', () => {
  // Migration douce : tant que le streamer ne s'est pas reconnecte, c'est ce
  // secret qui fait vivre son autorisation. Le lui retirer ici couperait son
  // bot musique au premier rafraichissement de jeton.
  poser({ clientId: 'vieil-id', clientSecret: 'vieux-secret', refreshToken: 'vieux-refresh' });
  connecteurs.definirApp('spotify', { clientId: 'nouvel-id' });

  const e = connecteurs.pour('spotify');
  assert.equal(e.clientId, 'nouvel-id');
  assert.equal(e.clientSecret, 'vieux-secret', 'le secret existant doit survivre');
  assert.equal(e.connecte, true);
});

test('un connecteur configure sans secret est bien vu comme connecte', () => {
  poser({ clientId: 'mon-id', refreshToken: 'un-refresh' });
  assert.equal(connecteurs.estConnecte('spotify'), true);

  poser({ clientId: 'mon-id' });
  assert.equal(connecteurs.estConnecte('spotify'), false, 'sans jeton, pas connecte');
});

test('l autorisation refuse de partir sans identifiant client', () => {
  poser({});
  const r = connecteurs.demarrerAutorisation('spotify', 4455);
  assert.equal(r.ok, false);
  assert.match(r.erreur, /ID client/, 'le message ne doit plus reclamer de secret');
});

// --- Ce que le catalogue promet au dashboard ------------------------------

test('les etapes affichees ne demandent plus de secret', () => {
  const texte = SPOTIFY.etapes.join(' ');
  assert.ok(/secret est inutile/i.test(texte), 'le streamer doit lire qu il n a pas de secret a chercher');
});
