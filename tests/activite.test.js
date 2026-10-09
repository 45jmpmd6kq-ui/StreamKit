// L'activite, c'est ce que le streamer relit apres son live (page « Activite
// recente ») : un fichier par jour, qu'il doit pouvoir parcourir date par date.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const activite = await import('../src/core/activite.js');
const { preparerDossiers, JOURNAUX_DIR } = await import('../src/core/paths.js');

preparerDossiers();
after(() => nettoyer(DONNEES));

const aujourdhui = activite.jourDe(new Date());

test('un evenement note se relit dans le fichier du jour', () => {
  activite.noter('clips', 'Clip créé par @ziggy');
  activite.noter('pub', 'Pub automatique de 1 min', 'info');

  const evts = activite.lire(aujourdhui);
  assert.deepEqual(
    evts.map((e) => [e.source, e.niveau, e.message]),
    [
      ['clips', 'succes', 'Clip créé par @ziggy'],
      ['pub', 'info', 'Pub automatique de 1 min'],
    ]
  );
  assert.match(evts[0].h, /^\d{2}:\d{2}:\d{2}$/);
  assert.ok(activite.jours().includes(aujourdhui));
});

test('une saisie de viewer tient sur une ligne et ne fait pas fuiter de secret', () => {
  activite.noter('musique', '« titre » demandé\npar access_token=abcdef123456');
  const dernier = activite.lire(aujourdhui).at(-1);
  assert.ok(!/[\r\n]/.test(dernier.message));
  assert.ok(!dernier.message.includes('abcdef123456'));
});

test('une date invalide ou sans activite donne une liste vide, sans erreur', () => {
  assert.deepEqual(activite.lire('../../config'), []);
  assert.deepEqual(activite.lire('2001-01-01'), []);
});

test('une ligne tronquee n empeche pas de lire le reste du jour', () => {
  const dossier = join(DONNEES, 'activite');
  writeFileSync(
    join(dossier, '2026-01-02.jsonl'),
    '{"t":"2026-01-02T20:00:00.000Z","h":"21:00:00","source":"clips","niveau":"succes","message":"ok"}\n{"t":"2026-01-02T2'
  );
  assert.deepEqual(
    activite.lire('2026-01-02').map((e) => e.message),
    ['ok']
  );
});

test('les jours sont listes du plus recent au plus ancien', () => {
  const j = activite.jours();
  assert.deepEqual(j, [...j].sort().reverse());
});

test('le journal technique du jour est relu sans le debug', () => {
  mkdirSync(JOURNAUX_DIR, { recursive: true });
  writeFileSync(
    join(JOURNAUX_DIR, '2026-01-03.log'),
    [
      '2026-01-03T20:00:00.000Z [info] [noyau] Module demarre : Clips',
      '2026-01-03T20:00:01.000Z [debug] [twitch] bavardage',
      'ligne sans format',
      '2026-01-03T20:00:02.000Z [avert] [rl-session] API muette',
    ].join('\n')
  );
  const lignes = activite.technique('2026-01-03');
  assert.deepEqual(
    lignes.map((l) => [l.niveau, l.source, l.message, l.technique]),
    [
      ['info', 'noyau', 'Module demarre : Clips', true],
      ['avert', 'rl-session', 'API muette', true],
    ]
  );
});

test('la purge efface ce qui depasse la retention, pas le reste', () => {
  const dossier = join(DONNEES, 'activite');
  writeFileSync(join(dossier, '2020-01-01.jsonl'), '');
  activite.purger();
  assert.ok(!existsSync(join(dossier, '2020-01-01.jsonl')));
  assert.ok(existsSync(join(dossier, aujourdhui + '.jsonl')));
});
