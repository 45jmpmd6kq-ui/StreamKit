// Echappement du HTML (audit U7).
//
// La fonction d'echappement existe en plusieurs exemplaires : une par overlay,
// une par page de module, une pour le dashboard, une pour la page de retour
// OAuth. C'est un choix : un overlay est charge SEUL par OBS, et un module ne
// depend jamais d'une URL du socle. Le prix de ce choix, c'est la derive -- une
// copie qui oublie l'apostrophe, un overlay neuf qui oublie la fonction.
//
// C'est ce que ce test empeche, sans rien a declarer a la main :
//   1. tout fichier qui ecrit du HTML (innerHTML, outerHTML, insertAdjacentHTML)
//      est trouve automatiquement, et doit avoir sa fonction d'echappement et
//      s'en servir ;
//   2. chaque exemplaire est extrait du fichier et execute : tous doivent
//      neutraliser les memes attaques, et rendre exactement la meme chose.
//
// Ce que le test ne peut pas voir : une valeur injectee SANS passer par la
// fonction. Ca, c'est la relecture -- et la CSP, qui bloque les scripts injectes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(RACINE, 'src');

// Ecrire du HTML a partir d'une chaine, dans le navigateur.
const PUITS_HTML = /\.(?:inner|outer)HTML\s*=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write\s*\(/;

// Du HTML construit cote serveur, qu'aucune regle ci-dessus ne detecte : la
// page de retour OAuth recopie le message d'erreur renvoye par Twitch ou Spotify.
const HTML_SERVEUR = ['src/core/auth.js'];

function fichiersSource(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
    return /\.(js|html)$/.test(nom) ? [chemin] : [];
  });
}

const aSurveiller = [
  ...new Set([
    ...fichiersSource(SRC)
      .filter((f) => PUITS_HTML.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RACINE, f).split(sep).join('/')),
    ...HTML_SERVEUR,
  ]),
].sort();

// Extrait « function esc(s) { ... } » (ou echapper) avec ses accolades.
function extraireEchappement(source) {
  const m = source.match(/function (esc|echapper)\(s\) \{/);
  if (!m) return null;
  let profondeur = 0;
  for (let i = source.indexOf('{', m.index); i < source.length; i++) {
    if (source[i] === '{') profondeur++;
    else if (source[i] === '}' && --profondeur === 0) {
      return { nom: m[1], code: source.slice(m.index, i + 1) };
    }
  }
  return null;
}

const exemplaires = aSurveiller.map((f) => {
  const source = readFileSync(join(RACINE, f), 'utf8');
  const e = extraireEchappement(source);
  return {
    fichier: f,
    source,
    ...e,
    // Execute dans un bac a sable : c'est le code REEL du fichier qui est juge.
    fn: e ? vm.runInNewContext('(' + e.code + ')') : null,
  };
});

// --- 1. Qui ecrit du HTML doit echapper -----------------------------------

test('la detection trouve bien les fichiers qui ecrivent du HTML', () => {
  // Garde-fou du garde-fou : si la recherche ne trouvait plus rien (dossier
  // deplace, regle cassee), tous les tests suivants passeraient a vide.
  for (const attendu of [
    'src/dashboard/app.js',
    'src/modules/musique/overlay/overlay.html',
    'src/modules/roue-rl/overlay/roue.html',
    'src/modules/valorant/overlay/bandeau.html',
  ]) {
    assert.ok(aSurveiller.includes(attendu), 'non detecte : ' + attendu);
  }
});

for (const e of exemplaires) {
  test('echappe ce qu il ecrit : ' + e.fichier, () => {
    assert.ok(e.fn, 'ce fichier ecrit du HTML sans fonction esc(s) ni echapper(s)');

    // Definie mais jamais appelee, elle ne protegerait rien.
    const appels = e.source.split(e.nom + '(').length - 2; // moins la definition
    assert.ok(appels >= 1, e.nom + '() est definie mais jamais utilisee');
  });
}

// --- 2. Tous les exemplaires neutralisent les memes attaques ---------------

const ATTAQUES = {
  'balise injectee': '<img src=x onerror=alert(1)>',
  'sortie d attribut entre guillemets': '" onmouseover="alert(1)',
  'sortie d attribut entre apostrophes': "' onmouseover='alert(1)",
  'entite deja presente': '&lt;b&gt;',
};

for (const e of exemplaires.filter((x) => x.fn)) {
  test('neutralise les attaques : ' + e.fichier, () => {
    for (const [nom, attaque] of Object.entries(ATTAQUES)) {
      const sortie = e.fn(attaque);
      assert.doesNotMatch(sortie, /[<>"']/, nom + ' : caractere actif restant dans ' + sortie);
    }
    // & d'abord, sinon « &lt; » ecrit par un viewer s'afficherait « < ».
    assert.equal(e.fn('&lt;'), '&amp;lt;');
  });

  test('ni « null » ni « undefined » a l ecran, mais le zero reste : ' + e.fichier, () => {
    // Un pseudo absent ne doit pas s'afficher « undefined a demande » -- mais
    // « 0 RR » doit rester « 0 », piege classique d'un `s || ''`.
    assert.equal(e.fn(null), '');
    assert.equal(e.fn(undefined), '');
    assert.equal(e.fn(0), '0');
  });
}

test('tous les exemplaires rendent exactement la meme chose', () => {
  const avecFonction = exemplaires.filter((x) => x.fn);
  const entrees = [...Object.values(ATTAQUES), 'Daft Punk — One More Time', "L'Octane", 42, null, 'a&b'];
  const reference = avecFonction[0];
  for (const e of avecFonction.slice(1)) {
    for (const entree of entrees) {
      assert.equal(
        e.fn(entree),
        reference.fn(entree),
        e.fichier + ' et ' + reference.fichier + ' different sur ' + JSON.stringify(entree)
      );
    }
  }
});
