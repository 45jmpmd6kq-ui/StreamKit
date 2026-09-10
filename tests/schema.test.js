// Le schema est la piece qui rend l'ajout d'un module bon marche : un module
// DECRIT ses reglages et le dashboard fabrique l'ecran tout seul. Tout ce qui
// arrive du dashboard passe par normaliser() — c'est notre frontiere de
// confiance cote reglages, elle merite d'etre tenue par des tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../src/core/schema.js';

// --- normaliser : ce qui vient du dashboard -------------------------------

test('un nombre hors bornes est ramene dans les bornes, pas refuse', () => {
  const champs = [{ cle: 'cout', type: 'nombre', min: 1, max: 1000 }];

  assert.equal(schema.normaliser(champs, { cout: 50000 }).valeurs.cout, 1000);
  assert.equal(schema.normaliser(champs, { cout: -20 }).valeurs.cout, 1);
  assert.equal(schema.normaliser(champs, { cout: 500 }).valeurs.cout, 500);
});

test('un nombre illisible est une erreur, pas un NaN silencieux', () => {
  const { erreurs } = schema.normaliser([{ cle: 'cout', type: 'nombre', label: 'Coût' }], {
    cout: 'beaucoup',
  });
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /Coût/);
});

test('une commande recoit son « ! » et refuse les espaces', () => {
  const champs = [{ cle: 'cmd', type: 'commande', label: 'Commande' }];

  assert.equal(schema.normaliser(champs, { cmd: 'skip' }).valeurs.cmd, '!skip');
  assert.equal(schema.normaliser(champs, { cmd: '!SKIP' }).valeurs.cmd, '!skip');
  assert.equal(schema.normaliser(champs, { cmd: 'skip song' }).erreurs.length, 1);
});

test('une commande vide reste vide : c est ainsi qu on la desactive', () => {
  // Le piege serait de lui reappliquer son defaut : la commande se
  // rallumerait toute seule a chaque enregistrement.
  const champs = [{ cle: 'cmd', type: 'commande', defaut: '!skipsong' }];
  assert.equal(schema.normaliser(champs, { cmd: '' }).valeurs.cmd, '');
});

test('un champ absent reprend son defaut', () => {
  const champs = [
    { cle: 'titre', type: 'texte', defaut: 'Demande de musique' },
    { cle: 'actif', type: 'bool', defaut: true },
  ];
  const { valeurs } = schema.normaliser(champs, {});
  assert.equal(valeurs.titre, 'Demande de musique');
  assert.equal(valeurs.actif, true);
});

test('une valeur hors liste est refusee', () => {
  const champs = [
    {
      cle: 'coin',
      type: 'choix',
      label: 'Coin',
      options: [{ valeur: 'top-left' }, { valeur: 'top-right' }],
    },
  ];
  assert.equal(schema.normaliser(champs, { coin: 'top-left' }).erreurs.length, 0);
  assert.equal(schema.normaliser(champs, { coin: 'au-milieu' }).erreurs.length, 1);
});

test('une couleur doit etre au format #rrggbb', () => {
  const champs = [{ cle: 'c', type: 'couleur', label: 'Couleur' }];
  assert.equal(schema.normaliser(champs, { c: '#1DB954' }).valeurs.c, '#1db954');
  assert.equal(schema.normaliser(champs, { c: 'vert' }).erreurs.length, 1);
  assert.equal(schema.normaliser(champs, { c: '#fff' }).erreurs.length, 1);
});

test('une liste accepte le texte multiligne et jette les lignes vides', () => {
  const champs = [{ cle: 'l', type: 'liste' }];
  assert.deepEqual(schema.normaliser(champs, { l: 'un\n\n  deux  \n' }).valeurs.l, ['un', 'deux']);
  assert.deepEqual(schema.normaliser(champs, { l: ['a', ' ', 'b'] }).valeurs.l, ['a', 'b']);
});

test('un texte est tronque a la longueur annoncee', () => {
  const champs = [{ cle: 't', type: 'texte', max: 5 }];
  assert.equal(schema.normaliser(champs, { t: 'abcdefghij' }).valeurs.t, 'abcde');
});

test('un champ inconnu du schema est ecarte', () => {
  // Sinon le dashboard (ou n'importe qui parlant a l'API) pourrait injecter
  // des cles arbitraires dans les reglages d'un module.
  const { valeurs } = schema.normaliser([{ cle: 'connu', type: 'texte' }], {
    connu: 'oui',
    intrus: 'non',
  });
  assert.deepEqual(Object.keys(valeurs), ['connu']);
});

// --- secrets : l'aller-retour qui ne doit RIEN effacer ---------------------

test('rouvrir un module et enregistrer n efface pas ses secrets', () => {
  // Le scenario reel : le dashboard recoit un temoin a la place du secret,
  // et nous le renvoie tel quel puisque le streamer n'y a pas touche. Si on
  // le prenait au mot, sa cle d'API serait remplacee par « __inchange__ ».
  const champs = [{ cle: 'cle', type: 'secret' }];
  const enBase = { cle: 'vrai-secret-abc123' };

  const versDashboard = schema.masquerSecrets(champs, enBase);
  assert.equal(versDashboard.cle, schema.TEMOIN_SECRET);
  assert.notEqual(versDashboard.cle, enBase.cle);

  const { valeurs } = schema.normaliser(champs, versDashboard);
  const finales = schema.reinjecterSecrets(champs, valeurs, enBase);
  assert.equal(finales.cle, 'vrai-secret-abc123');
});

test('un secret reellement modifie est bien pris', () => {
  const champs = [{ cle: 'cle', type: 'secret' }];
  const { valeurs } = schema.normaliser(champs, { cle: 'nouveau' });
  assert.equal(schema.reinjecterSecrets(champs, valeurs, { cle: 'ancien' }).cle, 'nouveau');
});

test('un secret vide cote base ne devient pas un temoin', () => {
  assert.equal(schema.masquerSecrets([{ cle: 'k', type: 'secret' }], { k: '' }).k, '');
});

// --- migrations -----------------------------------------------------------

test('les migrations manquantes s appliquent en cascade', () => {
  const migrations = {
    2: (r) => ({ ...r, deux: true }),
    3: (r) => ({ ...r, trois: true }),
  };
  assert.deepEqual(schema.migrer({ a: 1 }, 1, 3, migrations), { a: 1, deux: true, trois: true });
  // Deja en v2 : seule la 3 doit passer.
  assert.deepEqual(schema.migrer({ a: 1 }, 2, 3, migrations), { a: 1, trois: true });
});

test('une migration qui ne renvoie rien ne perd pas les reglages', () => {
  // Le piege classique : `2: (r) => { delete r.vieux; }` ne renvoie rien.
  const r = schema.migrer({ garde: 'moi', vieux: 1 }, 1, 2, {
    2: (reglages) => {
      delete reglages.vieux;
    },
  });
  assert.equal(r.garde, 'moi');
  assert.equal(r.vieux, undefined);
});

// --- validation d'un schema de module -------------------------------------

test('un schema fautif est signale plutot que subi', () => {
  const erreurs = schema.validerSchema([
    { cle: 'a', type: 'texte' },
    { cle: 'a', type: 'texte' }, // doublon
    { cle: 'b', type: 'inconnu' }, // type inexistant
    { cle: 'c', type: 'choix' }, // options manquantes
    { type: 'texte' }, // cle manquante
  ]);
  assert.equal(erreurs.length, 4);
});

test('un schema correct ne remonte aucune erreur', () => {
  assert.deepEqual(
    schema.validerSchema([
      { cle: 'a', type: 'texte' },
      { cle: 'b', type: 'choix', options: [{ valeur: 'x' }] },
    ]),
    []
  );
});
