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
