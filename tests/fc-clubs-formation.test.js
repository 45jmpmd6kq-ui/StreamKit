// Formation du club (Soiree Clubs) : le tirage des postes et les actions de la
// page « Formation du club ».

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMATIONS,
  formation,
  libellePlace,
  nettoyer,
  probleme,
  tirer,
} from '../src/modules/fc-clubs/formation.js';
import manifeste from '../src/modules/fc-clubs/module.js';

// Un hasard rejouable.
function graine(n) {
  let x = n;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const noms = (n) => Array.from({ length: n }, (_, i) => ({ nom: 'Joueur' + (i + 1), force: '' }));

test('chaque formation a 11 places, un seul gardien, des identifiants uniques', () => {
  assert.ok(FORMATIONS.length >= 6);
  for (const f of FORMATIONS) {
    assert.equal(f.places.length, 11, f.code);
    assert.equal(f.places.filter((pl) => pl.ligne === 'G').length, 1, f.code);
    assert.equal(new Set(f.places.map((pl) => pl.id)).size, 11, f.code);
    for (const pl of f.places) {
      assert.ok(pl.x >= 0 && pl.x <= 100 && pl.y >= 0 && pl.y <= 100, f.code + ' ' + pl.id);
    }
  }
});

test('deux DC se distinguent par leur cote, un poste unique garde son nom', () => {
  const f = formation('4-3-3');
  const dc = f.places.filter((pl) => pl.poste === 'DC');
  assert.deepEqual(
    dc.map((pl) => pl.id),
    ['DC1', 'DC2']
  );
  assert.deepEqual(
    dc.map((pl) => libellePlace(f, pl)),
    ['DC (gauche)', 'DC (droite)']
  );
  assert.equal(
    libellePlace(
      f,
      f.places.find((pl) => pl.id === 'GB')
    ),
    'GB'
  );
  assert.equal(
    libellePlace(
      f,
      f.places.find((pl) => pl.id === 'MC2')
    ),
    'MC (axe)'
  );
});

test('nettoyer : pseudos coupes, lignes vides retirees, 11 au plus, poste inconnu oublie', () => {
  const propre = nettoyer({
    code: '4-4-2',
    joueurs: [
      { nom: '  Zizou   le  Boss ', force: 'MD' },
      { nom: '', force: 'GB' },
      { nom: 'Titi', force: 'AG' }, // pas d'AG en 4-4-2
      ...noms(12),
    ],
  });
  assert.equal(propre.code, '4-4-2');
  assert.equal(propre.joueurs.length, 11);
  assert.deepEqual(propre.joueurs[0], { nom: 'Zizou le Boss', force: 'MD' });
  assert.deepEqual(propre.joueurs[1], { nom: 'Titi', force: '' });
  assert.equal(nettoyer({ code: 'n’importe quoi', joueurs: [] }).code, '4-3-3');
  assert.equal(nettoyer({ joueurs: [{ nom: 'x'.repeat(40) }] }).joueurs[0].nom.length, 24);
});

test('probleme : aucun joueur, pseudo en double, poste impose deux fois', () => {
  assert.match(probleme({ joueurs: [] }), /au moins un joueur/);
  assert.match(
    probleme({
      joueurs: [
        { nom: 'Titi', force: '' },
        { nom: 'TITI', force: '' },
      ],
    }),
    /deux fois/
  );
  assert.match(
    probleme({
      joueurs: [
        { nom: 'A', force: 'GB' },
        { nom: 'B', force: 'GB' },
      ],
    }),
    /GB est imposé à deux joueurs \(A et B\)/
  );
  assert.equal(probleme({ joueurs: noms(11) }), null);
});

test('tirage : 11 joueurs, chacun une place, toutes prises', () => {
  const r = tirer({ code: '4-2-3-1', joueurs: noms(11) }, graine(7));
  assert.equal(r.length, 11);
  assert.equal(new Set(r.map((pl) => pl.id)).size, 11);
  assert.equal(new Set(r.map((pl) => pl.nom)).size, 11);
  assert.ok(r.every((pl) => !pl.ia));
});

test('tirage : les postes imposes sont respectes, a chaque fois', () => {
  for (let s = 1; s < 60; s++) {
    const joueurs = noms(6);
    joueurs[0].force = 'GB';
    joueurs[3].force = 'BU';
    const r = tirer({ code: '4-3-3', joueurs }, graine(s));
    assert.equal(r.filter((pl) => !pl.ia).length, 6);
    assert.equal(r.find((pl) => pl.id === 'GB').nom, 'Joueur1');
    assert.equal(r.find((pl) => pl.id === 'BU').nom, 'Joueur4');
    assert.equal(r.filter((pl) => pl.impose).length, 2);
  }
});

test('tirage : moins de 11 joueurs, l’IA complete la formation, et le hasard varie les places', () => {
  const vues = new Set();
  for (let s = 1; s < 200; s++) {
    const r = tirer({ code: '4-3-3', joueurs: noms(3) }, graine(s));
    assert.equal(r.length, 11);
    assert.equal(new Set(r.map((pl) => pl.id)).size, 11);
    const ia = r.filter((pl) => pl.ia);
    assert.equal(ia.length, 8);
    assert.ok(ia.every((pl) => pl.nom === 'IA' && !pl.impose));
    vues.add(r.find((pl) => pl.nom === 'Joueur1').id);
  }
  // Sur 200 tirages, le premier joueur a connu presque toutes les places.
  assert.ok(vues.size >= 9, [...vues].join(','));
});

test('4-1-2-1-2 (2) : le losange large, MG et MD a la place des deux MC', () => {
  const postes = (code) => formation(code).places.map((pl) => pl.poste);
  assert.deepEqual(postes('4-1-2-1-2').filter((x) => x === 'MC').length, 2);
  const large = postes('4-1-2-1-2 (2)');
  assert.ok(!large.includes('MC'));
  assert.ok(large.includes('MG') && large.includes('MD') && large.includes('MDC') && large.includes('MOC'));
});

test('tirage : rendu du gardien vers l’attaque', () => {
  const r = tirer({ code: '4-4-2', joueurs: noms(11) }, graine(3));
  assert.equal(r[0].poste, 'GB');
  for (let i = 1; i < r.length; i++) assert.ok(r[i].y <= r[i - 1].y);
  assert.ok(['BU'].includes(r.at(-1).poste));
});

// --- Actions de la page ------------------------------------------------------

function contexte(etatInitial = {}) {
  let etat = structuredClone(etatInitial);
  const journal = [];
  return {
    config: { club: 'mafia enjoyer', couleur: '#3b7bff', couleurMaillot: true },
    etat: {
      lire: (defaut) => (Object.keys(etat).length ? structuredClone(etat) : defaut),
      sauver: (v) => {
        etat = structuredClone(v);
      },
    },
    log: { ok: (m) => journal.push(m), info() {}, warn() {} },
    get stocke() {
      return etat;
    },
    journal,
  };
}

test('actions : liste enregistree, tirage sauve, la soiree du club n’est pas touchee', async () => {
  const ctx = contexte({
    cle: '|mafia enjoyer',
    club: { nom: 'mafia enjoyer', kit: null },
    matchs: [{ id: 'm1' }],
  });
  const a = manifeste.actions;

  const vide = await a.formation(ctx);
  assert.equal(vide.club, 'mafia enjoyer');
  assert.equal(vide.code, '4-3-3');
  assert.deepEqual(vide.joueurs, []);
  assert.equal(vide.tirage, null);
  assert.equal(vide.formations.length, FORMATIONS.length);
  assert.ok(vide.formations[0].places.every((pl) => pl.libelle));

  await a.enregistrerFormation(ctx, {
    code: '3-5-2',
    joueurs: [{ nom: 'Titi', force: 'MOC' }, { nom: ' ' }],
  });
  assert.deepEqual(ctx.stocke.formation.joueurs, [{ nom: 'Titi', force: 'MOC' }]);
  assert.deepEqual(ctx.stocke.matchs, [{ id: 'm1' }]);

  const refus = await a.tirerFormation(ctx, { code: '3-5-2', joueurs: [] });
  assert.equal(refus.ok, false);

  const r = await a.tirerFormation(ctx, {
    code: '3-5-2',
    joueurs: [
      { nom: 'Titi', force: 'MOC' },
      { nom: 'Gros Minet', force: '' },
    ],
  });
  assert.equal(r.tirage.places.length, 11);
  assert.equal(r.tirage.places.filter((pl) => !pl.ia).length, 2);
  assert.equal(r.tirage.places.find((pl) => pl.nom === 'Titi').id, 'MOC');
  assert.equal(ctx.stocke.formation.tirage.code, '3-5-2');
  assert.deepEqual(ctx.stocke.matchs, [{ id: 'm1' }]);
  assert.match(ctx.journal.at(-1), /Formation tirée \(3-5-2\)/);
  assert.doesNotMatch(ctx.journal.at(-1), /IA/);

  const relu = await a.formation(ctx);
  assert.equal(relu.code, '3-5-2');
  assert.equal(relu.tirage.places.length, 11);
});

test('la page est declaree, et ses actions ne sont pas des boutons', () => {
  assert.deepEqual(
    manifeste.pages.map((p) => p.fichier),
    ['formation.html']
  );
  for (const nom of ['formation', 'enregistrerFormation', 'tirerFormation']) {
    assert.equal(typeof manifeste.actions[nom], 'function');
    assert.ok(!(nom in manifeste.libellesActions), nom);
  }
});
