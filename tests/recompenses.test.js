// Recompenses de points de chaine : StreamKit les cree, puis les garde
// conformes aux reglages du module.
//
// Vecu le 19/09/2026 : Random Car, allume puis regle, etait reste a 500 points
// sur Twitch -- la recompense n'etait ecrite qu'a sa creation. Ces tests jouent
// contre une fausse chaine qui se comporte comme Twitch : une recompense ne se
// modifie que par l'application qui l'a creee, et deux titres identiques sont
// refuses.

import test from 'node:test';
import assert from 'node:assert/strict';

import { assurerRecompense, messageTwitch } from '../src/core/recompenses.js';

// Une erreur comme celles de Twurple : code HTTP, et le corps JSON de Twitch.
function erreurTwitch(statusCode, message) {
  return Object.assign(
    new Error(
      'Encountered HTTP status code ' + statusCode + ': Bad Request\n\nURL: channel_points/custom_rewards'
    ),
    { statusCode, body: JSON.stringify({ error: 'Bad Request', status: statusCode, message }) }
  );
}

const memeTitre = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Une recompense telle que Twurple la rend. `gerable` : creee par l'application
// de StreamKit (sinon : faite a la main dans le panneau Twitch).
const recompense = (r) => ({
  gerable: true,
  cost: 1000,
  prompt: 'Tire au sort une voiture.',
  backgroundColor: '#00B0FF',
  globalCooldown: 60,
  userInputRequired: false,
  autoFulfill: false,
  ...r,
});

function chaine(existantes = [], { messageDoublon = 'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD' } = {}) {
  const liste = existantes.map(recompense);
  const appels = [];
  let n = 0;
  const cp = {
    async getCustomRewards(_diffuseur, seulementGerables) {
      appels.push(['lire', seulementGerables]);
      return liste.filter((r) => r.gerable || !seulementGerables).map((r) => ({ ...r }));
    },
    async createCustomReward(_diffuseur, d) {
      appels.push(['creer', d]);
      if (liste.some((r) => memeTitre(r.title, d.title))) throw erreurTwitch(400, messageDoublon);
      const r = recompense({
        id: 'nouvelle-' + ++n,
        title: d.title,
        cost: d.cost,
        prompt: d.prompt,
        backgroundColor: d.backgroundColor,
        globalCooldown: d.globalCooldown ?? null,
        userInputRequired: d.userInputRequired,
        autoFulfill: d.autoFulfill,
      });
      liste.push(r);
      return { ...r };
    },
    async updateCustomReward(_diffuseur, id, d) {
      appels.push(['modifier', id, d]);
      const r = liste.find((x) => x.id === id);
      if (!r?.gerable)
        throw erreurTwitch(
          403,
          'The ID in the Client-Id header must match the client ID used to create the custom reward.'
        );
      if (d.title && liste.some((x) => x !== r && memeTitre(x.title, d.title))) {
        throw erreurTwitch(400, 'UPDATE_CUSTOM_REWARD_DUPLICATE_REWARD');
      }
      const champs = { title: 'title', cost: 'cost', prompt: 'prompt', backgroundColor: 'backgroundColor' };
      for (const [cle, champ] of Object.entries(champs)) if (d[cle] !== undefined) r[champ] = d[cle];
      if (d.globalCooldown !== undefined) r.globalCooldown = d.globalCooldown || null;
      if (d.userInputRequired !== undefined) r.userInputRequired = d.userInputRequired;
      if (d.autoFulfill !== undefined) r.autoFulfill = d.autoFulfill;
      return { ...r };
    },
  };
  return {
    api: { channelPoints: cp },
    liste,
    appels,
    modifications: () => appels.filter((a) => a[0] === 'modifier'),
    creations: () => appels.filter((a) => a[0] === 'creer'),
  };
}

// Ce que demande Random Car, reglages par defaut sauf le cout.
const ROUE = {
  titre: '🚗 Random Car',
  cout: 1000,
  prompt: 'Tire au sort une voiture.',
  couleur: '#00b0ff',
  cooldownSec: 60,
  saisieRequise: false,
};

test('absente de la chaine : creee avec les reglages du module', async () => {
  const c = chaine();
  const r = await assurerRecompense(c.api, '42', ROUE);

  assert.equal(r.creee, true);
  assert.equal(r.cout, 1000);
  const [, envoye] = c.creations()[0];
  assert.equal(envoye.title, '🚗 Random Car');
  assert.equal(envoye.cost, 1000);
  assert.equal(envoye.globalCooldown, 60);
  assert.equal(envoye.isEnabled, true);
  assert.equal(envoye.autoFulfill, false, 'une validation automatique empecherait tout remboursement');
});

test('le cout change dans StreamKit : il change sur Twitch', async () => {
  // Le cas vecu : creee a 500 points en allumant le module, reglee a 1000 ensuite.
  const c = chaine([{ id: 'roue', title: '🚗 Random Car', cost: 500 }]);
  const r = await assurerRecompense(c.api, '42', ROUE);

  assert.equal(r.creee, false);
  assert.equal(r.id, 'roue');
  assert.equal(r.cout, 1000);
  assert.deepEqual(c.modifications(), [['modifier', 'roue', { cost: 1000 }]], 'seul le cout part');
  assert.equal(c.liste[0].cost, 1000);
  assert.match(r.changements.join(), /coût 500 points → 1\s000 points/);
  assert.equal(c.creations().length, 0, 'pas de seconde recompense');
});

test('deja conforme : aucune modification envoyee', async () => {
  const c = chaine([{ id: 'roue', title: '🚗 Random Car' }]);
  const r = await assurerRecompense(c.api, '42', ROUE);
  assert.deepEqual(r.changements, []);
  assert.equal(c.modifications().length, 0);
});

test('renommee dans StreamKit : la meme recompense change de nom', async () => {
  // Avant, un nouveau nom creait une seconde recompense ; l'ancienne restait sur
  // la chaine, utilisable par les viewers mais plus surveillee.
  const c = chaine([{ id: 'roue', title: '🚗 Random Car' }]);
  const r = await assurerRecompense(
    c.api,
    '42',
    { ...ROUE, titre: '🎲 Voiture au hasard' },
    { idConnu: 'roue' }
  );

  assert.equal(r.id, 'roue');
  assert.equal(r.titre, '🎲 Voiture au hasard');
  assert.deepEqual(c.modifications(), [['modifier', 'roue', { title: '🎲 Voiture au hasard' }]]);
  assert.equal(c.liste.length, 1);
});

test('retrouvee par son nom quand l identifiant n a pas ete retenu, casse comprise', async () => {
  // Une recompense creee avant cette version : aucun identifiant en memoire.
  const c = chaine([{ id: 'roue', title: '🚗 random car ' }]);
  const r = await assurerRecompense(c.api, '42', ROUE);
  assert.equal(r.id, 'roue');
  assert.deepEqual(c.modifications(), [['modifier', 'roue', { title: '🚗 Random Car' }]]);
  assert.equal(c.creations().length, 0);
});

test('delai : aligne s il est regle dans le module, laisse tel quel sinon', async () => {
  const coupe = chaine([{ id: 'roue', title: '🚗 Random Car' }]);
  const r = await assurerRecompense(coupe.api, '42', { ...ROUE, cooldownSec: 0 });
  assert.deepEqual(coupe.modifications(), [['modifier', 'roue', { globalCooldown: 0 }]]);
  assert.match(r.changements.join(), /délai 60 s → 0 s/);

  // Le bot musique ne regle pas de delai : celui pose sur Twitch reste.
  const musique = chaine([{ id: 'm', title: '🎵 Demande de musique', globalCooldown: 300 }]);
  await assurerRecompense(musique.api, '42', {
    ...ROUE,
    titre: '🎵 Demande de musique',
    cooldownSec: undefined,
  });
  assert.equal(musique.modifications().length, 0);
});

test('ce dont le module a besoin pour marcher est remis en place', async () => {
  // Une validation automatique interdit de rembourser ; une saisie absente
  // prive le bot musique du titre demande.
  const c = chaine([
    { id: 'm', title: '🎵 Demande de musique', autoFulfill: true, userInputRequired: false },
  ]);
  await assurerRecompense(c.api, '42', { ...ROUE, titre: '🎵 Demande de musique', saisieRequise: true });
  assert.deepEqual(c.modifications()[0][2], { userInputRequired: true, autoFulfill: false });
});

test('une recompense du meme nom faite a la main : message clair, pas de doublon', async () => {
  const c = chaine([{ id: 'main', title: '🚗 Random Car', gerable: false }]);
  await assert.rejects(
    assurerRecompense(c.api, '42', ROUE),
    /Une récompense « 🚗 Random Car » existe déjà sur ta chaîne, mais StreamKit ne l’a pas créée/
  );
  assert.equal(c.modifications().length, 0, 'celle du streamer n est pas touchee');
});

test('doublon sans le message attendu : on le reconnait quand meme', async () => {
  // Si Twitch change le libelle de son erreur, la liste complete tranche.
  const c = chaine([{ id: 'main', title: '🚗 Random Car', gerable: false }], {
    messageDoublon: 'Bad Request',
  });
  await assert.rejects(assurerRecompense(c.api, '42', ROUE), /existe déjà sur ta chaîne/);
});

test('mise a jour refusee : le module garde l ancienne recompense et le dit', async () => {
  const c = chaine([
    { id: 'roue', title: '🚗 Random Car' },
    { id: 'autre', title: '🎲 Voiture au hasard' },
  ]);
  const r = await assurerRecompense(
    c.api,
    '42',
    { ...ROUE, titre: '🎲 Voiture au hasard' },
    { idConnu: 'roue' }
  );
  assert.equal(r.id, 'roue', 'on ne se rabat pas sur la recompense qui porte deja ce nom');
  assert.equal(r.titre, '🚗 Random Car');
  assert.match(r.avertissement, /le nom « 🎲 Voiture au hasard » est déjà pris/);
});

test('chaine non affiliee : le motif en francais, pas l erreur de l API', async () => {
  const api = {
    channelPoints: {
      async getCustomRewards() {
        throw erreurTwitch(403, 'The broadcaster must have partner or affiliate status.');
      },
    },
  };
  await assert.rejects(assurerRecompense(api, '42', ROUE), /réserve aux chaînes Affiliées ou Partenaires/);
});

test('messageTwitch garde le message de Twitch, sans l enrobage de Twurple', () => {
  assert.equal(
    messageTwitch(erreurTwitch(400, 'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD')),
    'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD'
  );
  assert.equal(messageTwitch(new Error('fetch failed\ncause: ECONNRESET')), 'fetch failed');
});
