// Le journal est l'outil de support de StreamKit : quand un streamer dit
// « hier soir le bot repondait plus », c'est le fichier du jour qu'on ouvre. Ce
// qu'on y lit doit donc venir de StreamKit, et de personne d'autre.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const journal = await import('../src/core/journal.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();

after(() => nettoyer(DONNEES));

test('une saisie de viewer ne peut pas fabriquer de fausses lignes de journal', () => {
  const log = journal.pour('test-injection');

  // Ce que tape le spectateur dans le chat. Recopie tel quel, il s'ecrivait
  // deux lignes de plus dans le fichier du jour -- horodatage, niveau et source
  // compris -- et le diagnostic du lendemain partait sur une piste inventee.
  log.info('!sr toto\r\n2026-09-10T00:00:00.000Z [erreur] [twitch] jeton expire\nsuite');

  const [ligne] = journal.historique({ source: 'test-injection' });
  assert.ok(ligne, 'la ligne devrait etre dans le tampon');
  assert.ok(!/[\r\n]/.test(ligne.message), 'le message tient sur une seule ligne');
  assert.ok(ligne.message.includes('jeton expire'), 'le texte reste lisible, il est juste aplati');
});

test('une erreur multiligne est aplatie elle aussi', () => {
  const log = journal.pour('test-erreur');
  log.err(new Error('echec\n    at quelquePart (fichier.js:1:1)'));

  const [ligne] = journal.historique({ source: 'test-erreur' });
  assert.ok(!/[\r\n]/.test(ligne.message));
});

// --- Masquage des secrets --------------------------------------------------
//
// Le journal du jour est le fichier qu'on demande au streamer d'envoyer pour du
// support, et il reste 14 jours sur son disque. Y ecrire un secret annulerait
// tout le benefice du chiffrement de tokens.json.

test('une erreur de Twurple ne laisse pas fuiter le secret client', () => {
  // Cas REEL, constate au demarrage avec des identifiants invalides : Twurple
  // met l'URL complete de la requete dans le message de son erreur HTTP.
  const log = journal.pour('test-masque-url');
  log.err(
    'Twitch : Encountered HTTP status code 400 URL: token?grant_type=refresh_token' +
      '&client_id=abc123&client_secret=SUPER-SECRET&refresh_token=REFRESH-SECRET Method: POST'
  );

  const [ligne] = journal.historique({ source: 'test-masque-url' });
  assert.ok(!ligne.message.includes('SUPER-SECRET'), 'le secret client a fuite');
  assert.ok(!ligne.message.includes('REFRESH-SECRET'), 'le jeton de rafraichissement a fuite');
  assert.ok(ligne.message.includes('client_secret=<masque>'));
  assert.ok(ligne.message.includes('client_id=abc123'), "l'identifiant client, lui, aide au support");
});

test('un en-tete d autorisation est masque', () => {
  const log = journal.pour('test-masque-entete');
  log.warn('Refus : Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.charge.signature');

  const [ligne] = journal.historique({ source: 'test-masque-entete' });
  assert.ok(!ligne.message.includes('eyJhbGciOiJIUzI1NiJ9'), 'le jeton porteur a fuite');
  assert.ok(ligne.message.includes('Bearer <masque>'));
});

test('un objet recopie tel quel est masque aussi', () => {
  const log = journal.pour('test-masque-json');
  log.err({ clientSecret: 'SUPER-SECRET', compte: 'Sylvain' });

  const [ligne] = journal.historique({ source: 'test-masque-json' });
  assert.ok(!ligne.message.includes('SUPER-SECRET'));
  assert.ok(ligne.message.includes('Sylvain'), 'ce qui n est pas secret doit rester lisible');
});

test('le masquage ne devore pas les messages ordinaires', () => {
  // Un filtre trop gourmand rendrait le journal inutile, ce qui serait pire.
  const log = journal.pour('test-masque-neutre');
  const message = 'Dashboard : http://127.0.0.1:4455 — client_id=public, 5 modules, port 4455.';
  log.info(message);

  const [ligne] = journal.historique({ source: 'test-masque-neutre' });
  assert.equal(ligne.message, message);
});
