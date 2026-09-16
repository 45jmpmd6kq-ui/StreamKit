// Le morceau en cours du bot musique : ce que l'overlay affiche en tete du bloc
// « en cours + a venir ».
//
// Deux erreurs possibles, visibles seulement en direct : un bloc qui clignote
// parce qu'on le redessine a chaque releve de Spotify, ou une barre qui ment
// parce qu'on a oublie de la recaler apres un retour en arriere.

import test from 'node:test';
import assert from 'node:assert/strict';

import { etatLecture, lectureAChange, msAvantFin, TOLERANCE_MS } from '../src/modules/musique/lecture.js';
import { SpotifyClient, choisirImage, choisirMeilleur } from '../src/modules/musique/spotify.js';

// Les trois tailles que Spotify renvoie pour une pochette d'album.
const POCHETTES = [
  { url: 'https://i.scdn.co/image/640', width: 640, height: 640 },
  { url: 'https://i.scdn.co/image/300', width: 300, height: 300 },
  { url: 'https://i.scdn.co/image/64', width: 64, height: 64 },
];

const releve = (autres = {}) => ({
  uri: 'spotify:track:midnight-city',
  name: 'Midnight City',
  artists: 'M83',
  isPlaying: true,
  image: 'https://i.scdn.co/image/300',
  durationMs: 244000,
  progressMs: 72000,
  ...autres,
});

// --- etatLecture ------------------------------------------------------------

test('un morceau qui joue donne tout ce que l overlay affiche', () => {
  assert.deepEqual(etatLecture(releve(), null, 1000), {
    uri: 'spotify:track:midnight-city',
    name: 'Midnight City',
    artists: 'M83',
    image: 'https://i.scdn.co/image/300',
    durationMs: 244000,
    progressMs: 72000,
    at: 1000,
    requester: null,
  });
});

test('rien ne joue, ou pause : rien a afficher', () => {
  // Choix du streamer : en pause, le morceau disparait du bloc.
  assert.equal(etatLecture(null, null), null);
  assert.equal(etatLecture(releve({ isPlaying: false }), null), null);
});

test('le pseudo du viewer seulement si c est SON morceau qui joue', () => {
  const demande = { uri: 'spotify:track:midnight-city', requester: 'Viewer42' };
  assert.equal(etatLecture(releve(), demande).requester, 'Viewer42');

  // La file croit encore jouer une demande que Spotify a deja quittee.
  const autre = { uri: 'spotify:track:autre-chose', requester: 'Viewer42' };
  assert.equal(etatLecture(releve(), autre).requester, null);
});

test('un fichier local sans pochette ni duree ne casse rien', () => {
  const l = etatLecture({ uri: 'spotify:local:x', name: 'Demo', artists: '', isPlaying: true }, null, 0);
  assert.equal(l.image, null);
  assert.equal(l.durationMs, 0);
  assert.equal(l.progressMs, 0);
});

// --- lectureAChange ---------------------------------------------------------

test('la lecture qui avance normalement ne redessine pas le bloc', () => {
  const avant = etatLecture(releve({ progressMs: 72000 }), null, 0);
  // 5 s plus tard, Spotify dit 77 s (a la latence pres) : la page le savait deja.
  assert.equal(lectureAChange(avant, etatLecture(releve({ progressMs: 77300 }), null, 5000)), false);
});

test('un retour en arriere ou un saut en avant recale la barre', () => {
  const avant = etatLecture(releve({ progressMs: 72000 }), null, 0);
  const saut = etatLecture(releve({ progressMs: 72000 + 5000 + TOLERANCE_MS + 1 }), null, 5000);
  const retour = etatLecture(releve({ progressMs: 10000 }), null, 5000);
  assert.equal(lectureAChange(avant, saut), true);
  assert.equal(lectureAChange(avant, retour), true);
});

test('autre morceau, pause, reprise, pseudo : il faut repousser', () => {
  const l = etatLecture(releve(), null, 0);
  assert.equal(lectureAChange(l, etatLecture(releve({ uri: 'spotify:track:b' }), null, 0)), true);
  assert.equal(lectureAChange(l, null), true, 'pause');
  assert.equal(lectureAChange(null, l), true, 'reprise');
  assert.equal(lectureAChange(l, { ...l, requester: 'Viewer42' }), true);
  assert.equal(lectureAChange(null, null), false, 'toujours rien : rien a pousser');
});

// --- msAvantFin -------------------------------------------------------------

test('le temps restant tient compte du temps ecoule depuis le releve', () => {
  const l = etatLecture(releve({ durationMs: 200000, progressMs: 190000 }), null, 0);
  assert.equal(msAvantFin(l, 0), 10000);
  assert.equal(msAvantFin(l, 4000), 6000);
  assert.equal(msAvantFin(l, 60000), 0, 'jamais negatif');
  assert.equal(msAvantFin(null), Infinity);
});

// --- Pochettes --------------------------------------------------------------

test('la plus petite pochette encore nette a la taille demandee', () => {
  assert.equal(choisirImage(POCHETTES, 184), 'https://i.scdn.co/image/300');
  assert.equal(choisirImage(POCHETTES, 60), 'https://i.scdn.co/image/64');
  // Plus grand que tout ce qui existe : la plus grande, faute de mieux.
  assert.equal(choisirImage(POCHETTES, 2000), 'https://i.scdn.co/image/640');
  // L'ordre de Spotify ne doit pas compter.
  assert.equal(choisirImage([...POCHETTES].reverse(), 184), 'https://i.scdn.co/image/300');
});

test('pas de pochette exploitable : null', () => {
  assert.equal(choisirImage([], 60), null);
  assert.equal(choisirImage(undefined, 60), null);
  // Jamais autre chose que du https : cette adresse finit dans un attribut src.
  assert.equal(choisirImage([{ url: 'javascript:alert(1)', width: 64 }], 60), null);
  assert.equal(choisirImage([{ url: 'http://i.scdn.co/image/64', width: 64 }], 60), null);
});

test('la recherche garde la vignette de la demande', () => {
  const choix = choisirMeilleur('midnight city m83', [
    {
      uri: 'spotify:track:mc',
      name: 'Midnight City',
      artists: [{ name: 'M83' }],
      album: { images: POCHETTES },
    },
  ]);
  assert.equal(choix.image, 'https://i.scdn.co/image/64');
});

test('currentlyPlaying lit la pochette, la duree et la position', async () => {
  const spotify = new SpotifyClient({ clientId: 'id', clientSecret: '', refreshToken: 'r' });
  spotify.api = async (chemin) => {
    assert.equal(chemin, '/me/player/currently-playing');
    return {
      is_playing: true,
      progress_ms: 72000,
      currently_playing_type: 'track',
      item: {
        uri: 'spotify:track:mc',
        name: 'Midnight City',
        artists: [{ name: 'M83' }],
        duration_ms: 244000,
        album: { images: POCHETTES },
      },
    };
  };

  assert.deepEqual(await spotify.currentlyPlaying(), {
    uri: 'spotify:track:mc',
    name: 'Midnight City',
    artists: 'M83',
    isPlaying: true,
    image: 'https://i.scdn.co/image/300',
    durationMs: 244000,
    progressMs: 72000,
  });
});

test('currentlyPlaying : une pub ou rien en lecture donnent null', async () => {
  const spotify = new SpotifyClient({ clientId: 'id', clientSecret: '', refreshToken: 'r' });
  spotify.api = async () => ({ is_playing: true, currently_playing_type: 'ad', item: null });
  assert.equal(await spotify.currentlyPlaying(), null);

  spotify.api = async () => null; // 204 : aucun appareil n'a rien joue
  assert.equal(await spotify.currentlyPlaying(), null);
});
