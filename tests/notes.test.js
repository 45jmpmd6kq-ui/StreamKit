// Les notes de version : le seul texte de StreamKit que le streamer lit
// VRAIMENT, parce qu'il lui arrive au moment ou il clique.
//
// Deux chemins, un seul decoupage a tenir :
//   - Markdown, quand elles voyagent dans latest.yml (build.releaseInfo) ;
//   - HTML, quand elles viennent du corps de la release GitHub, que le
//     fournisseur d'electron-updater rend en HTML.
//
// Et une garantie de publication : la version en cours a toujours sa section
// dans NOUVEAUTES.md -- sinon `npm run publier` s'arrete, autant le savoir des
// `npm test`.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { decouper, enTexte, notesLocales, sectionDe, vide } = await import('../src/core/notes.js');
const { versionActuelle } = await import('../src/core/maj.js');

after(() => nettoyer(DONNEES));

const FICHIER = `# Nouveautés

Du blabla d'en-tête, qui ne doit jamais finir dans une version.

## 0.28.0

### Nouveautés

- **Signaler un bug** sans sortir de StreamKit : tu colles ta capture,
  ton journal part avec.
- Tu vois ce qui part avant d'envoyer.

### Corrections

- Le coût d'une récompense part bien sur Twitch.

## 0.27.0

### Nouveautés

- Vue d'ensemble revue.
`;

test('sectionDe prend la bonne version, et rien de la suivante', () => {
  const s = sectionDe(FICHIER, '0.28.0');
  assert.match(s, /Signaler un bug/);
  assert.match(s, /Le coût d'une récompense/);
  assert.doesNotMatch(s, /Vue d'ensemble revue/, 'la version suivante ne doit pas déborder');
  assert.doesNotMatch(s, /blabla/, "l'en-tête du fichier non plus");

  assert.equal(sectionDe(FICHIER, '0.27.0').trim().endsWith("Vue d'ensemble revue."), true);
  assert.equal(sectionDe(FICHIER, '9.9.9'), '', 'version absente : rien, pas une approximation');
  // « 0.28.0 » ne doit pas etre trouvee par « 0 28 0 » : le point est un point.
  assert.equal(sectionDe(FICHIER, '0x28x0'), '');
});

test('decouper : le Markdown de latest.yml devient deux listes', () => {
  const b = decouper(sectionDe(FICHIER, '0.28.0'));
  assert.equal(b.nouveautes.length, 2);
  assert.equal(b.corrections.length, 1);
  assert.equal(b.autres.length, 0);
  // Une puce coupee sur deux lignes reste UN point, sans etoiles de Markdown.
  assert.equal(
    b.nouveautes[0],
    'Signaler un bug sans sortir de StreamKit : tu colles ta capture, ton journal part avec.'
  );
  assert.match(b.corrections[0], /^Le coût d'une récompense/);
});

test('decouper : le HTML de la release GitHub donne le meme resultat', () => {
  const html =
    '<h3>Nouveautés</h3><ul><li>Signaler un bug &amp; joindre le journal</li>' +
    '<li>Tu vois ce qui part</li></ul><h3>Corrections</h3><ul><li>Le co&#39;ut part bien</li></ul>';
  const b = decouper(html);
  assert.deepEqual(b.nouveautes, ['Signaler un bug & joindre le journal', 'Tu vois ce qui part']);
  assert.equal(b.corrections.length, 1);
  assert.doesNotMatch(JSON.stringify(b), /</, 'aucune balise ne doit survivre');
});

test('des notes sans rubrique restent lisibles, et le vide est reconnu', () => {
  const b = decouper('On a corrigé deux ou trois choses.');
  assert.deepEqual(b.autres, ['On a corrigé deux ou trois choses.']);
  assert.equal(vide(b), false);
  assert.equal(vide(decouper('')), true);
  assert.equal(vide(decouper(null)), true);
  assert.equal(enTexte(null), '');
});

test('la version en cours a sa section dans NOUVEAUTES.md', () => {
  const version = versionActuelle();
  const notes = notesLocales(version);
  assert.notEqual(notes, '', 'écris la section « ## ' + version + ' » dans NOUVEAUTES.md');
  assert.equal(vide(decouper(notes)), false, 'la section « ## ' + version + ' » ne dit rien');
  // Le fichier lu est bien celui du depot, pas un reste de test.
  assert.match(
    readFileSync('NOUVEAUTES.md', 'utf8'),
    new RegExp('^## ' + version.replace(/\./g, '\\.') + '$', 'm')
  );
});
