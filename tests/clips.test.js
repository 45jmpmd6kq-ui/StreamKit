// Creation de clips Twitch, et leur nommage.
//
// « !clip pentakill » : le titre part AVEC la demande de clip (parametre title
// de Twitch). L'ancienne methode -- basculer le titre du stream autour de la
// creation -- ne nommait plus rien en live : ces tests verifient qu'on n'y
// touche plus, que le nom reellement pose par Twitch est controle, et qu'un
// titre refuse ne coute jamais le clip.

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerClipper } from '../src/modules/clips/clips.js';
import manifeste from '../src/modules/clips/module.js';

const DIFFUSEUR = '12345';

// Faux client Twitch : il note chaque demande de clip.
//   titresLus    titres successifs renvoyes par Get Clips (le dernier reste)
//   invisible    Get Clips ne trouve jamais le clip
//   refusTitre   erreur levee quand la demande porte un titre
function faireApi({ titresLus, invisible = false, refusTitre, echec } = {}) {
  const demandes = [];
  let lectures = 0;
  const interdit = () => {
    throw new Error('le titre du stream ne doit plus etre touche');
  };

  return {
    demandes,
    lectures: () => lectures,
    channels: { getChannelInfoById: interdit, updateChannelInfo: interdit },
    clips: {
      async createClip(params) {
        demandes.push(params);
        if (echec) throw echec;
        if (refusTitre && params.title) throw refusTitre;
        return 'ClipAbc123';
      },
      async getClipById(id) {
        const demande = demandes.at(-1);
        const titres = titresLus ?? [demande.title ?? 'Stream du soir'];
        const title = titres[Math.min(lectures, titres.length - 1)];
        lectures++;
        return invisible ? null : { url: 'https://clips.twitch.tv/' + id, title };
      },
    },
  };
}

function faireLog() {
  const lignes = { warn: [], err: [] };
  return {
    lignes,
    warn: (m) => lignes.warn.push(String(m)),
    err: (m) => lignes.err.push(String(m)),
    info: () => {},
    ok: () => {},
    debug: () => {},
  };
}

const erreur = (message, statut) => Object.assign(new Error(message), { statusCode: statut });
const clipper = (api, log = faireLog()) => creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log });

// --- Le chemin nominal -----------------------------------------------------

test('avec un nom, le titre part avec la demande de clip', async () => {
  const api = faireApi();
  const clip = await clipper(api).creer({ nom: 'pentakill' });

  assert.deepEqual(api.demandes, [{ channel: DIFFUSEUR, createAfterDelay: false, title: 'pentakill' }]);
  assert.deepEqual([clip.renamed, clip.renameIssue, clip.title], [true, null, 'pentakill']);
  assert.equal(clip.url, 'https://clips.twitch.tv/ClipAbc123');
  assert.equal(api.lectures(), 1, 'le bon titre est confirme du premier coup');
});

test('sans nom, aucun titre n est envoye : le clip prend celui du stream', async () => {
  const api = faireApi();
  const clip = await clipper(api).creer();

  assert.equal('title' in api.demandes[0], false);
  assert.deepEqual([clip.renamed, clip.renameIssue, clip.title], [false, null, 'Stream du soir']);
});

test('un nom trop long est coupe', async () => {
  const api = faireApi();
  await clipper(api).creer({ nom: '  ' + 'x'.repeat(200) + '  ' });
  assert.equal(api.demandes[0].title, 'x'.repeat(100));
});

// --- Ce que Twitch fait vraiment du titre ------------------------------------

test('titre refuse par Twitch : le clip est redemande sans, jamais perdu', async () => {
  const api = faireApi({ refusTitre: erreur('400 Bad Request: invalid title', 400) });
  const log = faireLog();
  const clip = await clipper(api, log).creer({ nom: 'pentakill' });

  assert.deepEqual(
    api.demandes.map((d) => d.title),
    ['pentakill', undefined]
  );
  assert.deepEqual([clip.renamed, clip.renameIssue], [false, 'REFUSED']);
  assert.equal(clip.url, 'https://clips.twitch.tv/ClipAbc123');
  assert.match(log.lignes.warn[0], /pentakill/);
});

test('clip cree sous un autre titre : signale dans le journal, pas maquille', async () => {
  const api = faireApi({ titresLus: ['Stream du soir'] });
  const log = faireLog();
  const clip = await clipper(api, log).creer({ nom: 'pentakill' });

  assert.deepEqual([clip.renamed, clip.renameIssue, clip.title], [false, 'IGNORED', 'Stream du soir']);
  assert.match(log.lignes.warn.at(-1), /Stream du soir.*pentakill/);
});

test('titre pose un peu apres le clip, ou normalise par Twitch : bien nomme', async () => {
  const api = faireApi({ titresLus: ['Stream du soir', 'Stream du soir', 'PENTAKILL  de Zen'] });
  const clip = await clipper(api).creer({ nom: 'pentakill de   zen' });

  assert.deepEqual([clip.renamed, clip.renameIssue, clip.title], [true, null, 'PENTAKILL  de Zen']);
  assert.equal(api.lectures(), 3, 'arret des que le titre est la');
});

test('clip pas encore visible : lien de secours, nom accepte avec la demande', async () => {
  const log = faireLog();
  const clip = await clipper(faireApi({ invisible: true }), log).creer({ nom: 'pentakill' });

  assert.deepEqual(
    [clip.url, clip.title, clip.renamed],
    ['https://clips.twitch.tv/ClipAbc123', 'pentakill', true]
  );
  assert.match(log.lignes.warn[0], /pas encore visible/);
});

// --- Erreurs typees, pour que le module reponde juste dans le chat ---------

test('chaque refus de Twitch est traduit en raison exploitable, sans redemander', async () => {
  const cas = [
    [erreur('missing clips:edit scope', 401), 'NO_SCOPE'],
    [erreur('404 not found', 404), 'OFFLINE'],
    [erreur('429 too many requests', 429), 'RATE_LIMIT'],
  ];

  for (const [lancee, attendue] of cas) {
    const api = faireApi({ echec: lancee });
    await assert.rejects(
      () => clipper(api).creer({ nom: 'pentakill' }),
      (e) => e.reason === attendue,
      'attendu ' + attendue + ' pour « ' + lancee.message + ' »'
    );
    assert.equal(api.demandes.length, 1, attendue + ' : un titre n y est pour rien');
  }
});

test('une erreur inconnue remonte telle quelle', async () => {
  // Mieux vaut un message brut dans le journal qu'une raison inventee.
  const api = faireApi({ echec: erreur('la mer est en feu', 500) });
  await assert.rejects(
    () => clipper(api).creer({ nom: 'pentakill' }),
    (e) => e.reason === undefined && /la mer est en feu/.test(e.message)
  );
});

test('400 sans titre demande : pas de seconde demande, l erreur remonte', async () => {
  const api = faireApi({ echec: erreur('400 Bad Request', 400) });
  await assert.rejects(() => clipper(api).creer(), /400/);
  assert.equal(api.demandes.length, 1);
});

// --- Module --------------------------------------------------------------------

test('module : nommer ne demande plus le droit de changer le titre du stream', async () => {
  assert.ok(!manifeste.scopes.includes('channel:manage:broadcast'));
  assert.ok(manifeste.scopes.includes('clips:edit'));

  const sante = (nommage) =>
    manifeste.sante({
      config: { commande: '!clip', nommage },
      twitch: { aLeDroit: (d) => d === 'clips:edit' },
    });
  const [actif] = await sante(true);
  assert.deepEqual([actif.etat, actif.detail], ['ok', '!clip — nommage actif']);
  const [coupe] = await sante(false);
  assert.deepEqual([coupe.etat, coupe.detail], ['ok', '!clip — sans nommage']);
});
