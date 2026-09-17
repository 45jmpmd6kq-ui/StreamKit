// Moments forts LoL : qui est qui, ce qui compte, ce que ca devient.
//
// Une partie s'ecrit evenement par evenement, dans le format du jeu (API
// « Live Client Data », port 2999), et se relit comme le module la lit : la
// liste COMPLETE a chaque tour. Chaque test est un piege deja connu de cette
// API : noms sans #TAG, mode streamer qui remplace les pseudos par les
// champions, premier sang publie avant son kill, « True » ecrit en texte.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cleChampion, creerRoster } from '../src/modules/lol-moments/joueurs.js';
import { creerDetecteur } from '../src/modules/lol-moments/detection.js';
import {
  REGLAGES,
  cleReglage,
  horloge,
  messageChat,
  niveau,
  presenter,
  titreClip,
} from '../src/modules/lol-moments/moments.js';
import { sequenceDemo } from '../src/modules/lol-moments/demo.js';

const joueur = (nom, cle, equipe, extra = {}) => ({
  riotId: nom + '#EUW',
  riotIdGameName: nom,
  riotIdTagLine: 'EUW',
  summonerName: nom + '#EUW',
  championName: cle,
  rawChampionName: 'game_character_displayname_' + cle,
  team: equipe,
  ...extra,
});

const LISTE = [
  joueur('Pseudo', 'Ahri', 'ORDER'),
  joueur('Allie', 'Jinx', 'ORDER'),
  joueur('Rival1', 'Zed', 'CHAOS'),
  joueur('Rival2', 'LeeSin', 'CHAOS', { championName: 'Lee Sin' }),
  joueur('Rival3', 'Darius', 'CHAOS'),
  joueur('Rival4', 'Thresh', 'CHAOS'),
  joueur('Rival5', 'Lux', 'CHAOS'),
];

const roster = (nom = 'Pseudo#EUW', liste = LISTE) => creerRoster(liste, nom);

// Une partie qu'on ecrit comme le jeu la publie.
function partie() {
  const evenements = [{ EventID: 0, EventName: 'GameStart', EventTime: 0.02 }];
  const ajouter = (e) => {
    evenements.push({ EventID: evenements.length, ...e });
    return evenements;
  };
  return {
    evenements,
    ajouter,
    kill: (tueur, victime, temps) =>
      ajouter({
        EventName: 'ChampionKill',
        KillerName: tueur,
        VictimName: victime,
        Assisters: [],
        EventTime: temps,
      }),
    multi: (tueur, n, temps) =>
      ajouter({ EventName: 'Multikill', KillerName: tueur, KillStreak: n, EventTime: temps }),
  };
}

// Stand-in de la fonction du module : pas de Data Dragon ici.
const champion = (j, secours = '') => ({
  nom: j?.champion || secours || 'Champion',
  icone: '',
  initiales: 'XX',
});

test('roster : le streamer est retrouve sous toutes les formes de son nom', () => {
  const r = roster();
  assert.equal(r.moi.nom, 'Pseudo');
  assert.equal(r.moi.equipe, 'ORDER');
  for (const nom of ['Pseudo', 'pseudo#euw', ' Pseudo#EUW ', 'Ahri']) assert.ok(r.estMoi(nom), nom);
  assert.equal(r.estMoi('Rival1'), false);
  assert.equal(r.estMoi(''), false);
  assert.equal(r.trouver('Lee Sin').cle, 'LeeSin', 'mode streamer : nom affiche du champion');
  assert.equal(cleChampion({ rawChampionName: 'game_character_displayname_MonkeyKing' }), 'MonkeyKing');
  assert.equal(cleChampion({ rawChampionName: 'autre chose' }), '');
});

test('roster : un nom de joueur passe avant un nom de champion', () => {
  // Le streamer s'appelle « Zed », un adversaire joue Zed.
  const liste = [joueur('Zed', 'Ahri', 'ORDER'), joueur('Rival1', 'Zed', 'CHAOS')];
  const r = roster('Zed#EUW', liste);
  assert.equal(r.trouver('Zed'), r.moi);
});

test('roster : bots et anciens noms d invocateur, sans Riot ID', () => {
  const liste = [
    {
      summonerName: 'Pseudo',
      championName: 'Ahri',
      rawChampionName: 'game_character_displayname_Ahri',
      team: 'ORDER',
    },
    {
      summonerName: 'Annie Bot',
      championName: 'Annie',
      rawChampionName: 'game_character_displayname_Annie',
      team: 'CHAOS',
    },
  ];
  const r = roster('Pseudo', liste);
  assert.ok(r.moi);
  assert.equal(r.trouver('Annie Bot').cle, 'Annie');
});

test('roster : personne a qui rattacher le nom (spectateur, chargement)', () => {
  assert.equal(roster('Inconnu#EUW').moi, null);
  assert.equal(creerRoster([], 'Pseudo#EUW').moi, null);
  assert.deepEqual(creerDetecteur().traiter([{ EventID: 1, EventName: 'Ace' }], roster('Inconnu')), []);
});

test('multikill : du double au penta, tour apres tour, avec les bonnes victimes', () => {
  const r = roster();
  const d = creerDetecteur();
  const p = partie();

  p.kill('Pseudo', 'Rival1', 1400);
  p.kill('Pseudo', 'Rival2', 1402);
  p.multi('Pseudo', 2, 1402);
  let m = d.traiter(p.evenements, r);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'multikill');
  assert.equal(m[0].niveau, 2);
  assert.deepEqual(
    m[0].victimes.map((v) => v.joueur.cle),
    ['Zed', 'LeeSin']
  );

  for (const [n, victime] of [
    [3, 'Rival3'],
    [4, 'Rival4'],
    [5, 'Rival5'],
  ]) {
    p.kill('Pseudo', victime, 1400 + n * 2);
    p.multi('Pseudo', n, 1400 + n * 2);
    m = d.traiter(p.evenements, r);
    assert.equal(m.length, 1, 'un seul moment au niveau ' + n);
    assert.equal(m[0].niveau, n);
    assert.equal(m[0].victimes.length, n);
  }
  assert.deepEqual(
    m[0].victimes.map((v) => v.joueur.cle),
    ['Zed', 'LeeSin', 'Darius', 'Thresh', 'Lux']
  );
});

test('un evenement n est jamais traite deux fois', () => {
  const r = roster();
  const d = creerDetecteur();
  const p = partie();
  p.kill('Pseudo', 'Rival1', 100);
  p.kill('Pseudo', 'Rival2', 101);
  p.multi('Pseudo', 2, 101);
  assert.equal(d.traiter(p.evenements, r).length, 1);
  assert.deepEqual(d.traiter(p.evenements, r), []);
  assert.deepEqual(d.traiter([...p.evenements].reverse(), r), [], 'meme dans le desordre');
});

test('le multikill d un coequipier ou d un adversaire ne compte pas', () => {
  const r = roster();
  const d = creerDetecteur();
  const p = partie();
  p.kill('Allie', 'Rival1', 100);
  p.kill('Allie', 'Rival2', 101);
  p.multi('Allie', 2, 101);
  p.kill('Rival3', 'Pseudo', 102);
  p.kill('Rival3', 'Allie', 103);
  p.multi('Rival3', 2, 103);
  assert.deepEqual(d.traiter(p.evenements, r), []);
});

test('premier sang : le sien seulement, meme publie avant son kill', () => {
  const r = roster();
  const d = creerDetecteur();
  const p = partie();
  p.ajouter({ EventName: 'FirstBlood', Recipient: 'Pseudo', EventTime: 192.4 });
  p.kill('Pseudo', 'Rival1', 192.4);
  const [m] = d.traiter(p.evenements, r);
  assert.equal(m.type, 'premierSang');
  assert.equal(m.victimes[0].joueur.cle, 'Zed');

  const autre = partie();
  autre.kill('Allie', 'Rival1', 150);
  autre.ajouter({ EventName: 'FirstBlood', Recipient: 'Allie', EventTime: 150 });
  assert.deepEqual(creerDetecteur().traiter(autre.evenements, r), []);
});

test('ace : celui de l equipe du streamer, pas celui des adversaires', () => {
  const r = roster();
  const p = partie();
  p.ajouter({ EventName: 'Ace', Acer: 'Allie', AcingTeam: 'ORDER', EventTime: 900 });
  p.ajouter({ EventName: 'Ace', Acer: 'Rival1', AcingTeam: 'CHAOS', EventTime: 1200 });
  const m = creerDetecteur().traiter(p.evenements, r);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'ace');
  assert.equal(m[0].auteur.cle, 'Jinx');
});

test('objectif vole : par le streamer, et vraiment vole (« True » en texte)', () => {
  const r = roster();
  const p = partie();
  p.ajouter({
    EventName: 'DragonKill',
    DragonType: 'Fire',
    Stolen: 'True',
    KillerName: 'Pseudo',
    EventTime: 1290,
  });
  p.ajouter({
    EventName: 'DragonKill',
    DragonType: 'Water',
    Stolen: 'False',
    KillerName: 'Pseudo',
    EventTime: 1600,
  });
  p.ajouter({ EventName: 'BaronKill', Stolen: 'True', KillerName: 'Allie', EventTime: 1700 });
  p.ajouter({ EventName: 'BaronKill', Stolen: 'True', KillerName: 'Pseudo', EventTime: 1800 });
  p.ajouter({ EventName: 'HeraldKill', Stolen: 'True', KillerName: 'Ahri', EventTime: 820 });
  const m = creerDetecteur().traiter(p.evenements, r);
  assert.deepEqual(
    m.map((x) => [x.objectif, x.dragon]),
    [
      ['dragon', 'Fire'],
      ['nashor', ''],
      ['heraut', ''],
    ]
  );
});

test('legendaire : au 8e kill sans mourir, une fois par serie ; toute mort remet a zero', () => {
  const r = roster();
  const d = creerDetecteur();
  const p = partie();
  const rivaux = ['Rival1', 'Rival2', 'Rival3', 'Rival4', 'Rival5'];
  for (let i = 0; i < 7; i++) p.kill('Pseudo', rivaux[i % 5], 100 + i * 60);
  assert.deepEqual(d.traiter(p.evenements, r), []);

  p.kill('Pseudo', 'Rival3', 600);
  const [m] = d.traiter(p.evenements, r);
  assert.equal(m.type, 'legendaire');
  assert.equal(m.serie, 8);

  p.kill('Pseudo', 'Rival4', 660);
  assert.deepEqual(d.traiter(p.evenements, r), [], 'le 9e kill ne relance rien');

  // Execute par une tour : c'est aussi une mort.
  p.kill('Turret_T200_L_03_A', 'Pseudo', 700);
  for (let i = 0; i < 7; i++) p.kill('Pseudo', rivaux[i % 5], 800 + i * 60);
  assert.deepEqual(d.traiter(p.evenements, r), []);
  p.kill('Pseudo', 'Rival1', 1300);
  assert.equal(d.traiter(p.evenements, r)[0]?.type, 'legendaire');
});

test('mode streamer : les evenements portent les noms des champions', () => {
  const r = roster();
  const d = creerDetecteur();
  const p = partie();
  p.kill('Ahri', 'Zed', 500);
  p.kill('Ahri', 'Lee Sin', 501);
  p.multi('Ahri', 2, 501);
  const [m] = d.traiter(p.evenements, r);
  assert.equal(m?.niveau, 2);
  assert.deepEqual(
    m.victimes.map((v) => v.joueur.cle),
    ['Zed', 'LeeSin']
  );
});

test('StreamKit lance en pleine partie : rien d ancien n est annonce, mais la serie compte', () => {
  const r = roster();
  const d = creerDetecteur();
  const p = partie();
  const rivaux = ['Rival1', 'Rival2', 'Rival3', 'Rival4', 'Rival5'];
  for (let i = 0; i < 7; i++) p.kill('Pseudo', rivaux[i % 5], 100 + i * 50);
  p.multi('Pseudo', 2, 400);
  assert.deepEqual(d.traiter(p.evenements, r, { ignorerAvant: 490 }), []);

  p.kill('Pseudo', 'Rival1', 505);
  const m = d.traiter(p.evenements, r, { ignorerAvant: 490 });
  assert.deepEqual(
    m.map((x) => x.type),
    ['legendaire']
  );
});

test('presentation : carte en plein combat, annonce quand il se termine', () => {
  const r = roster();
  const vue = (moment) => presenter(moment, { moi: r.moi, champion });
  const victimes = ['Rival1', 'Rival2', 'Rival3', 'Rival4', 'Rival5'].map((nom) => ({
    joueur: r.trouver(nom),
    nom,
  }));
  const multi = (niveau) =>
    vue({ type: 'multikill', id: niveau, temps: 1421.7, niveau, victimes: victimes.slice(0, niveau) });

  for (const [n, titre] of [
    [2, 'Double kill'],
    [3, 'Triple kill'],
    [4, 'Quadra kill'],
  ]) {
    const v = multi(n);
    assert.equal(v.format, 'carte', titre);
    assert.equal(v.groupe, 'multikill');
    assert.equal(v.titre, titre);
  }
  const penta = multi(5);
  assert.equal(penta.format, 'annonce');
  assert.equal(penta.groupe, 'multikill', 'l annonce remplace la carte du combat');
  assert.equal(penta.detail, 'Ahri · 23:41');
  assert.equal(penta.victimes.length, 5);

  const sang = vue({ type: 'premierSang', id: 9, temps: 192, victimes: victimes.slice(0, 1) });
  assert.deepEqual([sang.format, sang.accent, sang.detail], ['carte', 'rouge', 'Sur Zed · 3:12']);

  const ace = vue({ type: 'ace', id: 10, temps: 900, auteur: r.trouver('Allie') });
  assert.deepEqual(
    [ace.format, ace.titre, ace.detail, ace.champion.nom],
    ['carte', 'Ace', 'Par Jinx · 15:00', 'Jinx']
  );

  const dragon = vue({ type: 'vol', id: 11, temps: 1290, objectif: 'dragon', dragon: 'Fire' });
  assert.deepEqual(
    [dragon.format, dragon.titre, dragon.detail, dragon.accent, dragon.embleme],
    ['annonce', 'Dragon volé', 'Dragon infernal · Ahri · 21:30', 'orange', 'flamme']
  );

  const nashor = vue({ type: 'vol', id: 12, temps: 1625, objectif: 'nashor', dragon: '' });
  assert.deepEqual([nashor.titre, nashor.accent, nashor.embleme], ['Nashor volé', 'violet', 'oeil']);

  const legende = vue({ type: 'legendaire', id: 13, temps: 1300, serie: 8 });
  assert.deepEqual([legende.format, legende.accent], ['annonce', 'serie']);
});

test('chat et clip : les textes', () => {
  const r = roster();
  const vue = (moment) => presenter(moment, { moi: r.moi, champion });
  const penta = { type: 'multikill', id: 5, temps: 1421, niveau: 5, victimes: [] };
  assert.equal(messageChat(penta, vue(penta)), '🔥 PENTAKILL avec Ahri à 23:41 !');
  assert.equal(titreClip(penta, vue(penta)), 'Pentakill · Ahri · 23:41');

  const quadra = { type: 'multikill', id: 4, temps: 1418, niveau: 4, victimes: [] };
  assert.equal(messageChat(quadra, vue(quadra)), '⚔️ QUADRA KILL avec Ahri !');

  const dragon = { type: 'vol', id: 6, temps: 1290, objectif: 'dragon', dragon: 'Elder' };
  assert.equal(messageChat(dragon, vue(dragon)), '🐉 Dragon ancestral volé par Ahri !');
  const nashor = { type: 'vol', id: 7, temps: 1625, objectif: 'nashor', dragon: '' };
  assert.equal(messageChat(nashor, vue(nashor)), '👁️ Nashor volé par Ahri !');

  const sang = {
    type: 'premierSang',
    id: 8,
    temps: 192,
    victimes: [{ joueur: r.trouver('Rival1'), nom: 'Rival1' }],
  };
  assert.equal(messageChat(sang, vue(sang)), '🩸 Premier sang pour Ahri sur Zed !');
});

test('niveaux : un reglage vide ou inconnu reprend la valeur par defaut', () => {
  assert.equal(niveau({}, 'pentakill'), 'clip');
  assert.equal(niveau({ pentakill: 'off' }, 'pentakill'), 'off');
  assert.equal(niveau({ pentakill: 'n importe quoi' }, 'pentakill'), 'clip');
  assert.equal(niveau({}, 'moment-inconnu'), 'off');
  assert.equal(cleReglage({ type: 'multikill', niveau: 4 }), 'quadraKill');
  assert.equal(cleReglage({ type: 'vol' }), 'vol');
  assert.deepEqual(
    REGLAGES.map((x) => [x.cle, x.defaut]),
    [
      ['premierSang', 'ecran'],
      ['doubleKill', 'ecran'],
      ['tripleKill', 'ecran'],
      ['quadraKill', 'clip'],
      ['pentakill', 'clip'],
      ['ace', 'ecran'],
      ['vol', 'clip'],
      ['legendaire', 'chat'],
    ]
  );
});

test('horloge de jeu', () => {
  assert.equal(horloge(1421.7), '23:41');
  assert.equal(horloge(5), '0:05');
  assert.equal(horloge(-3), '0:00');
});

test('exemple : premier sang, combat jusqu au penta, Nashor vole, ace', () => {
  const seq = sequenceDemo(champion);
  assert.deepEqual(
    seq.map(({ vue }) => [vue.format, vue.titre]),
    [
      ['carte', 'Premier sang'],
      ['carte', 'Double kill'],
      ['carte', 'Triple kill'],
      ['carte', 'Quadra kill'],
      ['annonce', 'Pentakill'],
      ['annonce', 'Nashor volé'],
      ['carte', 'Ace'],
    ]
  );
  assert.ok(
    seq.every((s, i) => i === 0 || s.apresMs > seq[i - 1].apresMs),
    'dans l ordre'
  );
});
