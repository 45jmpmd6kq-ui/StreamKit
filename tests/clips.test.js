// Creation de clips Twitch, et surtout la bascule du titre de chaine.
//
// L'API Twitch n'a aucun moyen de nommer un clip : un clip herite du TITRE DU
// STREAM au moment de la capture. « !clip pentakill » bascule donc le titre de
// la chaine, cree le clip, et le remet aussitot.
//
// C'est la que se joue le seul vrai risque du module : si la remise du titre
// est sautee, le streamer finit sa soiree avec « pentakill » en titre de chaine
// sans jamais s'en apercevoir. Ces tests verifient qu'elle a lieu meme quand
// tout le reste echoue.

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerClipper } from '../src/modules/clips/clips.js';

const DIFFUSEUR = '12345';

// Faux client Twitch : il note ce qu'on lui demande, dans l'ordre.
function faireApi({ titre = 'Stream du soir', echecs = {} } = {}) {
  const trace = [];
  let ecritures = 0;

  return {
    trace,
    // Les titres successivement poses sur la chaine.
    titresPoses: () => trace.filter((t) => t.startsWith('titre:')).map((t) => t.slice(6)),
    channels: {
      async getChannelInfoById() {
        trace.push('lire-chaine');
        if (echecs.lecture) throw echecs.lecture;
        return { title: titre };
      },
      async updateChannelInfo(id, { title }) {
        assert.equal(id, DIFFUSEUR);
        ecritures++;
        if (echecs.bascule && ecritures === 1) throw echecs.bascule;
        if (echecs.remise && ecritures === 2) throw echecs.remise;
        trace.push('titre:' + title);
      },
    },
    clips: {
      async createClip() {
        trace.push('creer-clip');
        if (echecs.creation) throw echecs.creation;
        return 'ClipAbc123';
      },
      async getClipById(id) {
        trace.push('relire-clip');
        return { url: 'https://clips.twitch.tv/' + id, title: 'peu importe' };
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

// --- Le chemin nominal -----------------------------------------------------

test('avec un nom, le titre bascule puis revient', async () => {
  const api = faireApi({ titre: 'Stream du soir' });
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  const clip = await clipper.creer({ nom: 'pentakill' });

  assert.deepEqual(api.titresPoses(), ['pentakill', 'Stream du soir'], 'le titre doit revenir');
  assert.equal(clip.renamed, true);
  assert.equal(clip.renameIssue, null);
  assert.equal(clip.url, 'https://clips.twitch.tv/ClipAbc123');
});

test('sans nom, on ne touche pas au titre de la chaine', async () => {
  const api = faireApi();
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  const clip = await clipper.creer();

  assert.deepEqual(api.titresPoses(), [], 'aucune bascule ne doit avoir lieu');
  assert.ok(!api.trace.includes('lire-chaine'), 'inutile de lire le titre');
  assert.equal(clip.renamed, false);
});

// --- Le titre revient meme quand tout echoue -------------------------------

test('le titre revient meme si la creation du clip echoue', async () => {
  // Le cas le plus courant : le streamer tape !clip alors qu'il n'est plus en
  // live. Sans la remise, son titre de chaine resterait « pentakill ».
  const api = faireApi({ titre: 'Stream du soir', echecs: { creation: erreur('404 not found', 404) } });
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  await assert.rejects(
    () => clipper.creer({ nom: 'pentakill' }),
    (e) => e.reason === 'OFFLINE'
  );

  assert.deepEqual(api.titresPoses(), ['pentakill', 'Stream du soir']);
});

test('si la remise echoue, le streamer est prevenu avec son titre', async () => {
  // On ne peut plus rien faire pour lui : au minimum, il doit lire dans le
  // journal le titre exact a recopier.
  const api = faireApi({ titre: 'Stream du soir', echecs: { remise: erreur('boom') } });
  const log = faireLog();
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log });

  await clipper.creer({ nom: 'pentakill' });

  assert.equal(log.lignes.err.length, 1);
  assert.match(log.lignes.err[0], /Stream du soir/, 'le titre a remettre doit figurer dans le message');
});

test('restaurerTitre rattrape une bascule restee en suspens', async () => {
  // Appele a l'arret du module : si StreamKit s'arrete pendant la seconde de
  // bascule, le titre doit quand meme revenir.
  const api = faireApi({ titre: 'Stream du soir', echecs: { remise: erreur('boom') } });
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  await clipper.creer({ nom: 'pentakill' }); // la remise a echoue

  assert.equal(await clipper.restaurerTitre(), false, 'plus rien en suspens a rattraper');
});

test('restaurerTitre ne fait rien quand rien n a bascule', async () => {
  const api = faireApi();
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  assert.equal(await clipper.restaurerTitre(), false);
  assert.deepEqual(api.titresPoses(), []);
});

// --- Renommage impossible : on clippe quand meme ---------------------------

test('sans le droit de renommer, le clip est cree sans nom', async () => {
  // Un streamer qui n'a pas re-autorise sa chaine apres l'ajout du module.
  const api = faireApi({ echecs: { bascule: erreur('missing requested scopes', 401) } });
  const log = faireLog();
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log });

  const clip = await clipper.creer({ nom: 'pentakill' });

  assert.equal(clip.renameIssue, 'NO_SCOPE');
  assert.equal(clip.renamed, false, 'le clip existe, mais il gardera le titre du stream');
  assert.match(log.lignes.warn[0], /channel:manage:broadcast/);
});

test('une chaine sans titre ne peut pas basculer', async () => {
  // Twitch refuse un titre vide : sans titre d'origine, aucun retour possible.
  const api = faireApi({ titre: '' });
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  const clip = await clipper.creer({ nom: 'pentakill' });

  assert.equal(clip.renameIssue, 'NO_TITLE');
  assert.deepEqual(api.titresPoses(), [], 'on ne pose rien qu on ne saurait defaire');
});

// --- Erreurs typees, pour que le module reponde juste dans le chat ---------

test('chaque refus de Twitch est traduit en raison exploitable', async () => {
  const cas = [
    [erreur('missing clips:edit scope', 401), 'NO_SCOPE'],
    [erreur('404 not found', 404), 'OFFLINE'],
    [erreur('429 too many requests', 429), 'RATE_LIMIT'],
  ];

  for (const [lancee, attendue] of cas) {
    const clipper = creerClipper({
      api: faireApi({ echecs: { creation: lancee } }),
      broadcasterId: DIFFUSEUR,
      delaiMs: 0,
      log: faireLog(),
    });
    await assert.rejects(
      () => clipper.creer(),
      (e) => e.reason === attendue,
      'attendu ' + attendue + ' pour « ' + lancee.message + ' »'
    );
  }
});

test('une erreur inconnue remonte telle quelle', async () => {
  // Mieux vaut un message brut dans le journal qu'une raison inventee.
  const api = faireApi({ echecs: { creation: erreur('la mer est en feu', 500) } });
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  await assert.rejects(
    () => clipper.creer(),
    (e) => e.reason === undefined && /la mer est en feu/.test(e.message)
  );
});

test('un nom trop long est coupe a la limite de Twitch', async () => {
  const api = faireApi();
  const clipper = creerClipper({ api, broadcasterId: DIFFUSEUR, delaiMs: 0, log: faireLog() });

  await clipper.creer({ nom: 'x'.repeat(200) });

  assert.equal(api.titresPoses()[0].length, 140, 'Twitch refuse au-dela de 140 caracteres');
});
