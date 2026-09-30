// Soiree Clubs FC 27 : les briques, sans reseau.
//
// Les reponses d'EA sont fabriquees a la forme exacte des vraies (relevees le
// 29/09/2026) : tout en chaines, les deux clubs dans `clubs` et `players`, un
// but de coequipier IA attribue a personne, l'homme du match chez l'adversaire.
// Noms et chiffres fictifs : aucun joueur reel dans le depot.

import test from 'node:test';
import assert from 'node:assert/strict';

import { analyserMatch } from '../src/modules/fc-clubs/analyse.js';
import {
  lireBilan,
  matchDuBilan,
  nouveauxDuBilan,
  provisoireDe,
} from '../src/modules/fc-clubs/bilan-club.js';
import { choisirClub, couleurDuMaillot, initiales, nomDivision } from '../src/modules/fc-clubs/club.js';
import { bilan, matchsDeLaSoiree, serie, trophees } from '../src/modules/fc-clubs/soiree.js';
import { tonNote, vueBandeau, vueCarte, vueClub, vueTableau } from '../src/modules/fc-clubs/vue.js';
import { soireeDemo } from '../src/modules/fc-clubs/demo.js';

const NOUS = '4242';
const EUX = '9001';
const H = 3600_000;

const joueurBrut = (nom, pos, rating, stats = {}) => ({
  archetypeid: '3',
  assists: '0',
  goals: '0',
  mom: '0',
  passattempts: '10',
  passesmade: '8',
  pos,
  rating: rating.toFixed(2),
  realtimegame: '964',
  redcards: '0',
  saves: '0',
  shots: '0',
  tackleattempts: '4',
  tacklesmade: '2',
  playername: nom,
  ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)])),
});

// Victoire 3-1 : Alpha 2 buts, un but de coequipier IA ; l'homme du match est adverse.
function matchBrut({ id = '111', timestamp = 1790653622, buts = 3, encaisses = 1, result = '1' } = {}) {
  return {
    matchId: id,
    timestamp,
    timeAgo: { number: 10, unit: 'minutes' },
    clubs: {
      [NOUS]: {
        date: String(timestamp),
        goals: String(buts),
        goalsAgainst: String(encaisses),
        matchType: '1',
        result,
        winnerByDnf: '0',
        details: { name: 'Les Testeurs', clubId: Number(NOUS) },
      },
      [EUX]: {
        date: String(timestamp),
        goals: String(encaisses),
        goalsAgainst: String(buts),
        matchType: '1',
        result: result === '1' ? '2' : '1',
        winnerByDnf: '0',
        details: { name: 'Adversaires United', clubId: Number(EUX) },
      },
    },
    players: {
      [NOUS]: {
        1: joueurBrut('Alpha', 'forward', 8.4, { goals: 2, shots: 5 }),
        2: joueurBrut('Bravo', 'midfielder', 7.4, { assists: 1, passesmade: 31, passattempts: 35 }),
        3: joueurBrut('Charlie', 'goalkeeper', 6.3, { saves: 3 }),
      },
      [EUX]: {
        7: joueurBrut('Rival', 'forward', 9.1, { goals: 1, mom: 1 }),
      },
    },
    aggregate: {},
  };
}

test('un match EA devient un match du club, sans rien garder de l’adversaire a part son nom', () => {
  const m = analyserMatch(matchBrut(), NOUS, 'championnat');
  assert.equal(m.id, '111');
  assert.equal(m.a, 1790653622 * 1000);
  assert.equal(m.resultat, 'V');
  assert.equal(m.buts, 3);
  assert.equal(m.encaisses, 1);
  assert.equal(m.adversaire, 'Adversaires United');
  assert.equal(m.adversaireId, EUX);
  assert.equal(m.dureeS, 964);
  assert.deepEqual(
    m.joueurs.map((j) => [j.nom, j.poste, j.note, j.buts]),
    [
      ['Alpha', 'ATT', 8.4, 2],
      ['Bravo', 'MIL', 7.4, 0],
      ['Charlie', 'G', 6.3, 0],
    ]
  );
  // Le joueur adverse, pourtant homme du match, n'y est pas.
  assert.ok(!m.joueurs.some((j) => j.nom === 'Rival' || j.hdm));
});

test('resultat : codes EA, abandons, et amicaux tranches au score', () => {
  const r = (opts) => analyserMatch(matchBrut(opts), NOUS, 'amical');
  assert.equal(r({ result: '2', buts: 0, encaisses: 2 }).resultat, 'D');
  assert.equal(r({ result: '4', buts: 1, encaisses: 1 }).resultat, 'N');
  const abandon = r({ result: '16385', buts: 0, encaisses: 0 });
  assert.equal(abandon.resultat, 'V');
  assert.equal(abandon.abandon, true);
  // Amical : EA met 0 partout, le score decide.
  assert.equal(r({ result: '0', buts: 2, encaisses: 3 }).resultat, 'D');
  assert.equal(r({ result: '0', buts: 2, encaisses: 2 }).resultat, 'N');
  // Un match sans notre club n'est pas le notre.
  assert.equal(analyserMatch(matchBrut(), '1', 'championnat'), null);
});

test('le club : nom exact seulement, casse et espaces mis a part', () => {
  const recherche = [
    { clubId: '1', clubInfo: { name: 'Nothing FC' }, currentDivision: '6' },
    { clubId: '2', clubInfo: { name: 'Nothing   More' }, currentDivision: '1', gamesPlayed: '55' },
    { clubId: '3', clubInfo: { name: 'Nothing But Ls' } },
  ];
  const r = choisirClub(recherche, { nom: '  nothing more ' });
  assert.equal(r.statut, 'trouve');
  assert.equal(r.club.id, '2');
  assert.equal(r.club.division, 1);
  assert.equal(r.club.matchsJoues, 55);

  // La recherche d'EA marche par debut de nom : « Nothing » seul n'est aucun d'eux.
  const introuvable = choisirClub(recherche, { nom: 'Nothing' });
  assert.equal(introuvable.statut, 'introuvable');
  assert.deepEqual(
    introuvable.proches.map((c) => c.nom),
    ['Nothing FC', 'Nothing   More', 'Nothing But Ls']
  );

  const doublons = [...recherche, { clubId: '4', clubInfo: { name: 'nothing more' } }];
  assert.equal(choisirClub(doublons, { nom: 'Nothing More' }).statut, 'ambigu');
  // L'identifiant tranche.
  assert.equal(choisirClub(doublons, { nom: 'Nothing More', id: '4' }).club.id, '4');
  assert.equal(choisirClub([], { nom: 'Rien' }).statut, 'introuvable');
});

test('division : le 1 d’EA est l’Elite, le 6 la Division 5', () => {
  assert.equal(nomDivision('1'), 'Élite');
  assert.equal(nomDivision('2'), 'Div. 1');
  assert.equal(nomDivision('6'), 'Div. 5');
  assert.equal(nomDivision(null), '');
  assert.equal(nomDivision('7'), '');
});

test('couleur : la plus franche du maillot, eclaircie ; blanc et noir ignores', () => {
  // Blanc (15921906), puis violet sombre (5775459) : le violet, eclairci.
  const couleur = couleurDuMaillot({ kitColor1: '15921906', kitColor2: '5775459' });
  assert.match(couleur, /^#[0-9a-f]{6}$/);
  assert.notEqual(couleur, '#582063');
  // Tout en blanc, gris ou noir : rien, le reglage prend le relais.
  assert.equal(couleurDuMaillot({ kitColor1: '16777215', kitColor2: '0', kitColor3: '8421504' }), null);
  assert.equal(couleurDuMaillot(null), null);
  assert.equal(initiales('FC Les Potes'), 'FLP');
  assert.equal(initiales('Galactiques'), 'GAL');
});

const match = (a, resultat, extra = {}) => ({
  id: String(a),
  a,
  type: 'championnat',
  buts: resultat === 'V' ? 2 : 0,
  encaisses: resultat === 'D' ? 2 : 0,
  resultat,
  abandon: false,
  adversaire: 'X',
  dureeS: 900,
  joueurs: [],
  ...extra,
});

test('la soiree : les matchs sans pause de plus de 3 h, et rien si la derniere est finie', () => {
  const maintenant = 100 * H;
  const matchs = [
    match(70 * H, 'V'), // la semaine derniere, en quelque sorte
    match(97 * H, 'V'),
    match(98 * H, 'D'),
    match(99.5 * H, 'N'),
  ];
  const s = matchsDeLaSoiree(matchs, { pauseMs: 3 * H, maintenant });
  assert.deepEqual(
    s.map((m) => m.resultat),
    ['V', 'D', 'N']
  );
  // « Nouvelle soirée » : ce qui precede ne compte plus.
  assert.equal(matchsDeLaSoiree(matchs, { pauseMs: 3 * H, maintenant, reinitA: 98.5 * H }).length, 1);
  // Trois heures apres le dernier match : la soiree est finie, la suivante pas commencee.
  assert.deepEqual(matchsDeLaSoiree(matchs, { pauseMs: 3 * H, maintenant: 103 * H }), []);
});

test('serie : a partir de 2, « sans défaite » a partir de 3, sinon le dernier match', () => {
  const s = (...r) => serie(r.map((x, i) => match(i, x))).texte;
  assert.equal(serie([]).texte, 'En attente du premier match');
  assert.equal(s('D', 'V', 'V'), '2 victoires d’affilée');
  assert.equal(serie([match(1, 'D'), match(2, 'D')]).ton, 'rouge');
  assert.equal(s('V', 'N', 'V'), '3 matchs sans défaite');
  assert.equal(s('V', 'D'), 'Dernier match : défaite 0–2');
  assert.equal(s('N'), 'Dernier match : nul 0–0');
});

test('trophees : MVP parmi ceux qui ont joue la moitie des matchs, mur sans gardien', () => {
  const j = (nom, note, stats = {}) => ({
    nom,
    poste: 'MIL',
    note,
    buts: 0,
    pd: 0,
    arrets: 0,
    tacles: 0,
    hdm: false,
    ...stats,
  });
  const soiree = [
    match(1, 'V', {
      joueurs: [
        j('Assidu', 8.0, { buts: 1, tacles: 3 }),
        j('Passeur', 7.0, { pd: 2 }),
        j('Pressing', 7.0, { poste: 'ATT', tacles: 40 }),
      ],
    }),
    match(2, 'V', { joueurs: [j('Assidu', 8.0, { tacles: 5 }), j('Passeur', 7.1, { pd: 1 })] }),
    match(3, 'D', { joueurs: [j('Assidu', 8.0), j('Eclair', 9.9, { buts: 3 })] }),
  ];
  const t = trophees(soiree);
  // Eclair a 9,9, mais sur un seul match des trois.
  assert.equal(t.mvp.nom, 'Assidu');
  assert.equal(t.buteur.nom, 'Eclair');
  assert.equal(t.passeur.nom, 'Passeur');
  // Pas de gardien humain : le meilleur tacleur des milieux -- pas l'attaquant,
  // meme a 40 tacles.
  assert.equal(t.mur.nom, 'Assidu');
  assert.equal(t.mur.exploit, 'tacles');
  // Un defenseur passe avant les milieux.
  const avecDefenseur = [...soiree, match(4, 'V', { joueurs: [j('Roc', 6.5, { poste: 'DEF', tacles: 2 })] })];
  assert.equal(trophees(avecDefenseur).mur.nom, 'Roc');
  // Un gardien passe avant tout le monde.
  const avecGardien = [...soiree, match(4, 'V', { joueurs: [j('Gants', 6.0, { poste: 'G', arrets: 1 })] })];
  assert.equal(trophees(avecGardien).mur.nom, 'Gants');
  assert.equal(trophees(avecGardien).mur.exploit, 'arrets');
  assert.equal(trophees([]).mvp, null);
});

test('carte : notes triees, but IA annonce, stat du match, adversaire au choix', () => {
  const m = analyserMatch(matchBrut(), NOUS, 'championnat');
  const club = vueClub({ club: { nom: 'Les Testeurs', division: 4 }, couleur: '#3b7bff' });
  const v = vueCarte({ club, match: m, visible: true, sr: 12 });
  assert.equal(v.visible, true);
  assert.equal(v.match.libelle, 'Victoire');
  assert.equal(v.match.contexte, 'Championnat · Div. 3');
  assert.deepEqual(v.match.sr, { texte: '+12', signe: 1 });
  assert.deepEqual(
    v.match.joueurs.map((x) => [x.nom, x.note, x.ton, x.detail]),
    [
      ['Alpha', '8,4', 'vert', '5 tirs'],
      ['Bravo', '7,4', 'neutre', '31/35 passes'],
      ['Charlie', '6,3', 'ambre', '3 arrêts'],
    ]
  );
  // 3 buts au score, 2 attribues : un coequipier IA ou un contre son camp.
  assert.equal(v.match.butsSansJoueur, 1);
  assert.equal(v.match.stat.texte, 'Bravo · 31 passes réussies sur 35');
  assert.equal(v.match.adversaire, 'Adversaires United');
  assert.equal(vueCarte({ club, match: m, visible: true, adversaire: false }).match.adversaire, '');

  // Amical : pas de division, pas de skill rating.
  const amical = vueCarte({ club, match: { ...m, type: 'amical' }, visible: true, sr: 12 });
  assert.equal(amical.match.contexte, 'Amical');
  assert.equal(amical.match.sr, null);
  // Un triple passe avant la meilleure passe.
  const triple = { ...m, joueurs: m.joueurs.map((x) => (x.nom === 'Alpha' ? { ...x, buts: 3 } : x)) };
  assert.equal(vueCarte({ club, match: triple, visible: true }).match.stat.texte, 'Alpha · triplé');
  assert.equal(vueCarte({ club, match: null, visible: true }).visible, false);
  assert.equal(tonNote(5.9), 'rouge');
});

test('bandeau et tableau : la soiree d’exemple, celle des maquettes', () => {
  const s = soireeDemo(10 * H);
  const club = vueClub({ club: { nom: 'FC Les Potes', division: 4 }, couleur: '#3b7bff' });
  assert.deepEqual(bilan(s), { v: 3, n: 1, d: 1, pour: 10, contre: 7 });

  const b = vueBandeau({ club, soiree: s });
  assert.deepEqual(b.bilan.libelles, { v: 'Victoires', n: 'Nul', d: 'Défaite' });
  assert.equal(b.serie.texte, '3 victoires d’affilée');
  assert.equal(b.club.division, 'Div. 3');

  const t = vueTableau({ club, soiree: s, sr: { debut: 1448, actuel: 1486 } });
  assert.equal(t.vide, false);
  assert.equal(t.buts, '10 – 7');
  assert.equal(t.sr.ecart, '+38');
  assert.deepEqual(
    t.trophees.map((x) => [x.nom, x.detail]),
    [
      ['Yass', '8,0 de note moyenne'],
      ['Tomzer', '5 buts'],
      ['Kev', '4 passes décisives'],
      ['Nico', '14 arrêts'],
    ]
  );
  assert.equal(t.titreMatchs, 'Les matchs de la soirée');
  assert.deepEqual(
    t.matchs.map((m) => m.legende),
    ['Sporting Manette', 'Olympique Canapé', 'AS Dimanche', 'Racing Tacos', 'Inter Pantoufle']
  );
  // Sans le nom de l'adversaire, le type du match prend sa place.
  assert.equal(vueTableau({ club, soiree: s, adversaire: false }).matchs[0].legende, 'Championnat');

  const vide = vueTableau({ club, soiree: [] });
  assert.equal(vide.vide, true);
  assert.equal(vide.sr, null);
  assert.equal(vide.trophees[0].nom, '—');
  assert.equal(vueBandeau({ club, soiree: [] }).bilan.libelles.v, 'Victoire');
});

// Le bilan d'un club tel qu'EA le rend (forme relevee le 01/10/2026, chiffres
// fictifs) : 7 matchs, les 4 derniers gagnes. N = 0 est le plus recent, le
// resultat n'est connu que pour les 5 derniers.
const bilanBrut = (extra = {}) => [
  {
    clubId: NOUS,
    gamesPlayed: '7',
    wins: '5',
    losses: '2',
    ties: '0',
    skillRating: '1584',
    ...Object.fromEntries(
      ['501', '502', '503', '504', '505', '506', '507', '-1', '-1', '-1'].map((id, i) => [
        'lastOpponent' + i,
        id,
      ])
    ),
    ...Object.fromEntries(
      ['1', '1', '1', '1', '2', '-1', '-1', '-1', '-1', '-1'].map((r, i) => ['lastMatch' + i, r])
    ),
    ...extra,
  },
];

test('bilan du club : les matchs comptes par EA entre deux lectures, du plus ancien au plus recent', () => {
  const apres = lireBilan(bilanBrut());
  assert.deepEqual([apres.joues, apres.v, apres.n, apres.d, apres.sr], [7, 5, 0, 2, 1584]);
  assert.equal(apres.derniers.length, 7);
  assert.deepEqual(apres.derniers[4], { adversaireId: '505', resultat: 'D' });
  assert.equal(apres.derniers[5].resultat, null); // au-dela des 5 derniers

  // Le cas vu le 30/09 : 4 victoires depuis la lecture precedente.
  const avant = { joues: 3, v: 1, n: 0, d: 2 };
  assert.deepEqual(nouveauxDuBilan(avant, apres), [
    { adversaireId: '504', resultat: 'V' },
    { adversaireId: '503', resultat: 'V' },
    { adversaireId: '502', resultat: 'V' },
    { adversaireId: '501', resultat: 'V' },
  ]);
  // Plus de 5 : les totaux donnent les resultats qu'EA ne detaille plus.
  assert.deepEqual(
    nouveauxDuBilan({ joues: 1, v: 0, n: 0, d: 1 }, apres).map((e) => e.adversaireId + e.resultat),
    ['506V', '505D', '504V', '503V', '502V', '501V']
  );
  // Premiere lecture, rien de neuf, ou compteurs remis a zero par EA : rien.
  assert.deepEqual(nouveauxDuBilan(null, apres), []);
  assert.deepEqual(nouveauxDuBilan({ joues: 7, v: 5, n: 0, d: 2 }, apres), []);
  assert.deepEqual(nouveauxDuBilan({ joues: 40, v: 20, n: 5, d: 15 }, apres), []);

  // Un bilan illisible garde son skill rating, pas le reste.
  const abime = lireBilan(bilanBrut({ gamesPlayed: undefined }));
  assert.equal(abime.joues, null);
  assert.equal(abime.sr, 1584);
  assert.deepEqual(nouveauxDuBilan(avant, abime), []);
  assert.equal(lireBilan(null), null);
  assert.equal(lireBilan([]), null);
});

test('bilan du club : chaque ligne retrouve son match publie, sinon un match sans detail la complete', () => {
  const T = 100 * H;
  const publie = match(T - 2 * 60_000, 'V', { adversaireId: '501' });
  const ancien = match(T - 2 * H, 'V', { adversaireId: '501' });
  const amical = match(T - 60_000, 'V', { adversaireId: '502', type: 'amical' });
  const matchs = [ancien, publie, amical];
  const ligne = (id) => ({ adversaireId: id, resultat: 'V' });

  // Meme adversaire, fini entre les deux lectures : c'est lui (pas celui d'il y a 2 h).
  assert.equal(matchDuBilan(matchs, ligne('501'), { depuis: T - 60_000, jusqua: T }), publie);
  // Deja rattache a une ligne : plus disponible.
  assert.equal(
    matchDuBilan([{ ...publie, auBilan: true }], ligne('501'), { depuis: T - 60_000, jusqua: T }),
    null
  );
  // Un amical n'est jamais dans le bilan.
  assert.equal(matchDuBilan(matchs, ligne('502'), { depuis: T - 60_000, jusqua: T }), null);

  // Le detail arrive apres coup : il remplace le match sans detail du meme adversaire.
  const provisoire = { ...match(T, 'V'), provisoire: true, depuis: T - 60_000, adversaireId: '501' };
  assert.equal(provisoireDe([provisoire], publie), provisoire);
  assert.equal(provisoireDe([provisoire], { ...publie, adversaireId: '999' }), null);
  // Un match contre le meme club, mais joue bien plus tard : un autre match.
  assert.equal(provisoireDe([provisoire], { ...publie, a: T + H }), null);
  assert.equal(provisoireDe([provisoire], { ...publie, type: 'amical' }), null);
});

test('un match sans detail : compte dans le bilan et la serie, pas dans les buts ni les trophees', () => {
  const club = vueClub({ club: { nom: 'FC Les Potes', division: 4 }, couleur: '#3b7bff' });
  const s = soireeDemo(10 * H);
  const sansDetail = {
    ...match(10 * H + 60_000, 'V'),
    provisoire: true,
    buts: null,
    encaisses: null,
    adversaire: 'Dasporto',
  };
  const soiree = [...s, sansDetail];
  assert.deepEqual(bilan(soiree), { v: 4, n: 1, d: 1, pour: 10, contre: 7 });
  assert.equal(serie([match(1, 'D'), sansDetail]).texte, 'Dernier match : victoire');
  assert.equal(vueBandeau({ club, soiree }).serie.texte, '4 victoires d’affilée');

  const t = vueTableau({ club, soiree });
  assert.equal(t.sousTitre.includes('6 matchs'), true);
  assert.deepEqual(t.matchs.at(-1), { resultat: 'V', score: 'Victoire', legende: 'Dasporto' });
  // Le MVP se juge sur les matchs detailles : les memes trophees qu'avant.
  assert.deepEqual(
    t.trophees.map((x) => x.nom),
    vueTableau({ club, soiree: s }).trophees.map((x) => x.nom)
  );
});
