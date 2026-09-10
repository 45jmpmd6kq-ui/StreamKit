// Le registre decouvre les modules livres avec StreamKit. Ce fichier ne teste
// pas un module en particulier : il verifie que TOUS ceux du depot respectent
// le contrat, et que ce qui part vers le dashboard est bien lave de ce qui
// n'a rien a y faire.
//
// C'est le test qui attrape la faute de frappe dans un manifeste avant qu'elle
// ne parte en release, ou le module qu'on aurait casse en refactorisant.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const registre = await import('../src/core/registre.js');
const schema = await import('../src/core/schema.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();

before(async () => {
  await registre.charger();
});

after(() => nettoyer(DONNEES));

test('les modules du depot sont tous decouverts', () => {
  const ids = registre.liste().map((m) => m.id).sort();
  // Si un module disparait de cette liste, c'est qu'il a ete ecarte au
  // chargement : manifeste invalide, ou fichier illisible.
  assert.deepEqual(ids, ['clips', 'exemple', 'musique', 'roue-rl', 'valorant']);
});

test('chaque manifeste respecte le contrat', () => {
  for (const m of registre.liste()) {
    assert.equal(m.manifeste.id, m.dossier, m.id + ' : id different du dossier');
    assert.ok(m.manifeste.nom, m.id + ' : nom manquant');
    assert.equal(typeof m.manifeste.demarrer, 'function', m.id + ' : demarrer absent');
    assert.ok(Array.isArray(m.manifeste.scopes ?? []), m.id + ' : scopes doit etre un tableau');
    assert.deepEqual(
      schema.validerSchema(m.manifeste.config?.champs ?? []),
      [],
      m.id + ' : schema de reglages fautif'
    );
  }
});

test('un overlay declare pointe sur un fichier qui existe', async () => {
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { MODULES_DIR } = await import('../src/core/paths.js');

  for (const m of registre.liste()) {
    for (const o of m.manifeste.overlays ?? []) {
      const f = join(MODULES_DIR, m.dossier, 'overlay', o.fichier);
      assert.ok(existsSync(f), m.id + ' : overlay « ' + o.chemin + ' » introuvable (' + o.fichier + ')');
    }
    for (const p of m.manifeste.pages ?? []) {
      const f = join(MODULES_DIR, m.dossier, 'pages', p.fichier);
      assert.ok(existsSync(f), m.id + ' : page « ' + p.chemin + ' » introuvable (' + p.fichier + ')');
    }
  }
});

test('une action mise en bouton existe vraiment', () => {
  // libellesActions fabrique les boutons du dashboard. Un libelle sans action
  // derriere donnerait un bouton qui ne fait rien.
  for (const m of registre.liste()) {
    for (const nom of Object.keys(m.manifeste.libellesActions ?? {})) {
      assert.equal(
        typeof m.manifeste.actions?.[nom],
        'function',
        m.id + ' : le bouton « ' + nom + ' » n a pas d action'
      );
    }
  }
});

test('la vue envoyee au dashboard ne contient aucun secret en clair', () => {
  for (const m of registre.liste()) {
    const v = registre.vue(m.id);
    for (const c of v.champs.filter((x) => x.type === 'secret')) {
      const valeur = v.reglages[c.cle];
      assert.ok(
        valeur === '' || valeur === schema.TEMOIN_SECRET,
        m.id + ' : le secret « ' + c.cle + ' » part en clair vers le dashboard'
      );
    }
  }
});

test('la vue envoyee au dashboard est serialisable', () => {
  // Elle transite en JSON : une fonction ou une instance qui trainerait
  // dedans disparaitrait silencieusement, ou ferait planter la reponse.
  for (const m of registre.liste()) {
    const v = registre.vue(m.id);
    assert.equal(v.instance, undefined);
    assert.doesNotThrow(() => JSON.stringify(v), m.id + ' : vue non serialisable');
  }
});

test('les droits Twitch demandes sont uniques et tries', () => {
  const scopes = registre.scopesRequis({ tousLesModules: true });
  assert.deepEqual(scopes, [...new Set(scopes)].sort(), 'doublons ou ordre instable');
  assert.ok(
    scopes.every((s) => typeof s === 'string' && s.length),
    'un scope vide s est glisse dans la demande d autorisation'
  );
});

test('un module inactif ne reclame aucun droit', () => {
  // On ne demande au streamer que ce dont ses modules actifs ont besoin.
  assert.deepEqual(registre.scopesRequis(), []);
});
