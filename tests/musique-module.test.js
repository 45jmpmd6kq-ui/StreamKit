// Le bot musique branche de bout en bout, cote morceau en cours.
//
// Le module est demarre avec un contexte de test et un faux Spotify (fetch
// remplace) ; on regarde ce qui arrive a l'overlay. Les minuteurs ne tournent
// pas tout seuls : le test declenche chaque releve, pour que rien ne depende
// de l'horloge.

import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import manifeste from '../src/modules/musique/module.js';
import { valeursParDefaut } from '../src/core/schema.js';

afterEach(() => mock.restoreAll());

const pochettes = (nom) => [
  { url: 'https://i.scdn.co/image/' + nom + '-640', width: 640, height: 640 },
  { url: 'https://i.scdn.co/image/' + nom + '-300', width: 300, height: 300 },
  { url: 'https://i.scdn.co/image/' + nom + '-64', width: 64, height: 64 },
];

const MIDNIGHT = {
  uri: 'spotify:track:midnight',
  name: 'Midnight City',
  artists: [{ name: 'M83' }],
  duration_ms: 244000,
  album: { images: pochettes('midnight') },
};
const BEAUTIFUL = {
  uri: 'spotify:track:beautiful',
  name: 'Beautiful Things',
  artists: [{ name: 'Benson Boone' }],
  duration_ms: 180000,
  album: { images: pochettes('beautiful') },
};

// Reponse de /me/player/currently-playing.
const joue = (piste, { position = 0, pause = false } = {}) => ({
  is_playing: !pause,
  progress_ms: position,
  currently_playing_type: 'track',
  item: piste,
});

// Faux Spotify : un lecteur dont le test regle l'etat, et qui compte les
// « suivant ». La recherche trouve toujours Beautiful Things.
function fauxSpotify() {
  const s = { lecture: null, suivants: 0 };
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'accounts.spotify.com') {
      return Response.json({ access_token: 'jeton', expires_in: 3600 });
    }
    const route = (options.method ?? 'GET') + ' ' + u.pathname;
    switch (route) {
      case 'GET /v1/me/player/currently-playing':
        return s.lecture ? Response.json(s.lecture) : new Response(null, { status: 204 });
      case 'GET /v1/me/player/devices':
        return Response.json({ devices: [{ id: 'pc', name: 'PC', is_active: true }] });
      case 'GET /v1/search':
        return Response.json({ tracks: { items: [BEAUTIFUL] } });
      case 'POST /v1/me/player/queue':
        return new Response(null, { status: 204 });
      case 'POST /v1/me/player/next':
        s.suivants++;
        return new Response(null, { status: 204 });
      default:
        return Response.json({ error: { message: 'route inconnue : ' + route } }, { status: 404 });
    }
  });
  return s;
}

function contexte(reglages = {}) {
  const etats = [];
  const recompenses = new Map();
  const tours = [];
  const delais = [];
  const ctx = {
    config: { ...valeursParDefaut(manifeste.config.champs), ...reglages },
    log: Object.fromEntries(['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, () => {}])),
    connecteur: () => ({
      connecte: true,
      clientId: 'id-spotify',
      clientSecret: '',
      refreshToken: 'refresh',
      majJeton() {},
    }),
    twitch: {
      channel: 'streamer',
      // Comme la vraie : ce que Twitch porte apres alignement. Un test remplace
      // cette fonction pour renvoyer un cout different des reglages.
      assurerRecompense: async ({ titre, cout }) => ({ id: titre, titre, cout, changements: [] }),
      surRecompense: (id, fn) => recompenses.set(id, fn),
      statutRedemption: async () => {},
      dire: () => {},
      surCommande: () => {},
    },
    overlay: {
      etat: (vue, data) => etats.push([vue, structuredClone(data)]),
      diffuser: () => {},
    },
    compteur: { incr() {} },
    minuteur: {
      intervalle: (fn, ms) => tours.push({ fn, ms }),
      delai: (fn, ms) => delais.push({ fn, ms }),
    },
  };

  return {
    ctx,
    // Ce que la source OBS « liste » afficherait maintenant.
    liste: () => etats.filter(([vue]) => vue === 'liste').at(-1)[1],
    nbEtats: () => etats.length,
    tour: () => tours[0].fn(),
    delais,
    demander: (saisie, qui) =>
      recompenses.get(ctx.config.rewardTitle)({ input: saisie, userDisplayName: qui }),
    refuser: (saisie, qui) =>
      [...recompenses].find(([id]) => id !== ctx.config.rewardTitle)[1]({
        input: saisie,
        userDisplayName: qui,
      }),
  };
}

test('le reglage est coupe par defaut : ceux qui ont deja cale leur source ne voient rien changer', () => {
  const champ = manifeste.config.champs.find((c) => c.cle === 'afficherEnCours');
  assert.equal(champ.type, 'bool');
  assert.equal(champ.defaut, false);
});

test('taille compacte et fond d origine par defaut', () => {
  const champ = (cle) => manifeste.config.champs.find((c) => c.cle === cle);

  const taille = champ('tailleBloc');
  assert.equal(taille.type, 'choix');
  assert.equal(taille.defaut, 'compacte');
  assert.deepEqual(
    taille.options.map((o) => o.valeur),
    ['compacte', 'normale']
  );

  // 92 % : le fond qu'avaient deja les overlays. Un autre defaut changerait
  // l'ecran de tous les streamers a la mise a jour, reglage jamais touche.
  const opacite = champ('opaciteFond');
  assert.equal(opacite.type, 'nombre');
  assert.equal(opacite.defaut, 92);
  assert.equal(opacite.min, 0);
  assert.equal(opacite.max, 100);
});

test('la taille et l opacite partent a l overlay avec le theme', async () => {
  fauxSpotify();
  const parDefaut = contexte();
  await manifeste.demarrer(parDefaut.ctx);
  assert.equal(parDefaut.liste().theme.taille, 'compacte');
  assert.equal(parDefaut.liste().theme.opacite, 92);

  const regle = contexte({ tailleBloc: 'normale', opaciteFond: 40 });
  await manifeste.demarrer(regle.ctx);
  assert.equal(regle.liste().theme.taille, 'normale');
  assert.equal(regle.liste().theme.opacite, 40);
});

test('reglage coupe : la liste d avant, sans morceau en cours ni releve anticipe', async () => {
  const spotify = fauxSpotify();
  const t = contexte();
  spotify.lecture = joue(MIDNIGHT, { position: 244000 - 2000 }); // presque fini

  await manifeste.demarrer(t.ctx);
  await t.tour();

  assert.equal(t.liste().afficherEnCours, false);
  assert.equal(t.liste().lecture, null);
  assert.deepEqual(t.delais, [], 'aucun releve en plus quand rien ne s affiche');
});

test('reglage active : pochette, titre et position arrivent des le demarrage', async () => {
  const spotify = fauxSpotify();
  const t = contexte({ afficherEnCours: true });
  spotify.lecture = joue(MIDNIGHT, { position: 72000 });

  await manifeste.demarrer(t.ctx);
  const immediat = t.delais.find((d) => d.ms === 0);
  assert.ok(immediat, 'le premier releve ne doit pas attendre 5 s');
  await immediat.fn();

  const { afficherEnCours, lecture } = t.liste();
  assert.equal(afficherEnCours, true);
  assert.equal(lecture.name, 'Midnight City');
  assert.equal(lecture.artists, 'M83');
  assert.equal(lecture.image, 'https://i.scdn.co/image/midnight-300');
  assert.equal(lecture.durationMs, 244000);
  assert.equal(lecture.progressMs, 72000);
  assert.equal(lecture.requester, null, 'un morceau de la playlist n a pas de demandeur');
  assert.equal(typeof lecture.at, 'number');

  // Rien n'a change : on ne redessine pas le bloc.
  const avant = t.nbEtats();
  await t.tour();
  assert.equal(t.nbEtats(), avant);
});

test('une demande : vignette et pseudo dans la liste, puis en tete quand elle joue', async () => {
  const spotify = fauxSpotify();
  const t = contexte({ afficherEnCours: true });
  spotify.lecture = joue(MIDNIGHT, { position: 72000 });
  await manifeste.demarrer(t.ctx);
  await t.tour();

  await t.demander('beautiful things benson boone', 'Viewer42');
  const [demande] = t.liste().upcoming;
  assert.equal(demande.name, 'Beautiful Things');
  assert.equal(demande.requester, 'Viewer42');
  assert.equal(demande.image, 'https://i.scdn.co/image/beautiful-64', 'la vignette, pas la grande pochette');

  spotify.lecture = joue(BEAUTIFUL, { position: 1000 });
  await t.tour();
  const { lecture, upcoming } = t.liste();
  assert.equal(lecture.name, 'Beautiful Things');
  assert.equal(lecture.requester, 'Viewer42');
  assert.equal(lecture.image, 'https://i.scdn.co/image/beautiful-300');
  assert.deepEqual(upcoming, [], 'le morceau quitte la liste en montant en tete');
});

test('pause ou Spotify ferme : plus de morceau, et tout revient a la reprise', async () => {
  // Sans morceau en cours, l'overlay masque TOUT le bloc (choix du streamer).
  // La file doit pourtant continuer d'arriver : a la reprise, le bloc revient
  // complet, demandes faites pendant la pause comprises.
  const spotify = fauxSpotify();
  const t = contexte({ afficherEnCours: true });
  spotify.lecture = joue(MIDNIGHT, { position: 72000 });
  await manifeste.demarrer(t.ctx);
  await t.tour();
  assert.ok(t.liste().lecture);

  spotify.lecture = joue(MIDNIGHT, { position: 75000, pause: true });
  await t.tour();
  assert.equal(t.liste().lecture, null, 'en pause : rien a afficher');

  await t.demander('beautiful things benson boone', 'Viewer42');
  assert.equal(t.liste().lecture, null, 'une demande ne fait pas reapparaitre le bloc');
  assert.equal(t.liste().upcoming.length, 1, 'mais elle est bien gardee pour la reprise');

  spotify.lecture = joue(MIDNIGHT, { position: 75000 });
  await t.tour();
  const repris = t.liste();
  assert.equal(repris.lecture?.progressMs, 75000, 'reprise : la barre repart du bon endroit');
  assert.equal(repris.upcoming[0]?.name, 'Beautiful Things', 'reprise : la liste revient avec le morceau');

  spotify.lecture = null; // Spotify ferme
  await t.tour();
  assert.equal(t.liste().lecture, null);
});

test('fin de morceau : un seul releve anticipe, qui montre le suivant', async () => {
  const spotify = fauxSpotify();
  const t = contexte({ afficherEnCours: true });
  spotify.lecture = joue(MIDNIGHT, { position: 244000 - 3000 });
  await manifeste.demarrer(t.ctx);
  await t.tour();
  await t.tour();

  const anticipes = t.delais.filter((d) => d.ms > 0);
  assert.equal(anticipes.length, 1, 'programme une fois, pas a chaque tour');
  assert.ok(anticipes[0].ms >= 3000 && anticipes[0].ms <= 3900, 'juste apres la fin : ' + anticipes[0].ms);

  spotify.lecture = joue(BEAUTIFUL, { position: 500 });
  await anticipes[0].fn();
  assert.equal(t.liste().lecture.name, 'Beautiful Things');
});

test('deux releves simultanes ne passent pas deux fois un morceau refuse', async () => {
  // Le releve anticipe et le tour normal peuvent tomber ensemble. Sans verrou,
  // les deux voient le morceau refuse et appellent « suivant » : le second
  // saute le morceau d'un autre viewer.
  const spotify = fauxSpotify();
  const t = contexte({ afficherEnCours: true });
  spotify.lecture = joue(MIDNIGHT, { position: 72000 });
  await manifeste.demarrer(t.ctx);

  await t.demander('beautiful things benson boone', 'Viewer42');
  await t.refuser('beautiful things', 'LunaTique');
  assert.equal(t.liste().upcoming[0].cancelled, true);

  spotify.lecture = joue(BEAUTIFUL, { position: 0 });
  const releveAnticipe = t.delais.find((d) => d.ms === 0).fn;
  await Promise.all([t.tour(), releveAnticipe()]);

  assert.equal(spotify.suivants, 1);
});

// --- Vue d'ensemble ---------------------------------------------------------

test('la vue d ensemble montre les deux recompenses, au cout porte par Twitch', async () => {
  fauxSpotify();
  const t = contexte({ rewardTitle: '🎵 Demande de musique', rewardCost: 500, cancelRewardCost: 1000 });
  // Twitch renvoie un cout different des reglages : c'est LUI qu'on affiche,
  // sinon la ligne repeterait le formulaire au lieu de le verifier.
  t.ctx.twitch.assurerRecompense = async ({ titre, cout }) => ({
    id: titre,
    titre,
    cout: cout === 500 ? 750 : cout,
  });
  await manifeste.demarrer(t.ctx);

  const cartes = await manifeste.sante(t.ctx);
  assert.deepEqual(
    cartes.map((c) => c.id),
    ['musique', 'spotify']
  );
  assert.equal(cartes[0].etat, 'ok');
  // `\s` : l'espace des milliers est une espace fine insecable, qui depend de
  // la version d'ICU du Node qui fait tourner le test.
  assert.match(cartes[0].detail, /^« 🎵 Demande de musique » à 750 points · refus à 1\s000 points$/);
  assert.match(cartes[0].aide, /Récompense de refus/);
});

test('refus desactive : la ligne ne parle que de la demande', async () => {
  fauxSpotify();
  const t = contexte({ annulationActive: false, rewardCost: 1 });
  await manifeste.demarrer(t.ctx);

  const [ligne] = await manifeste.sante(t.ctx);
  assert.equal(ligne.detail, '« 🎵 Demande de musique » à 1 point');
  assert.match(ligne.aide, /désactivé/);
});

test('module au repos : pas de ligne recompense, la carte Spotify reste', async () => {
  // sante() est aussi lue avant tout demarrage (vue d'ensemble ouverte au
  // lancement) : sans recompense connue, on ne montre pas une ligne vide.
  fauxSpotify();
  const { ctx } = contexte();

  const cartes = await manifeste.sante(ctx);
  assert.deepEqual(
    cartes.map((c) => c.id),
    ['spotify']
  );
});
