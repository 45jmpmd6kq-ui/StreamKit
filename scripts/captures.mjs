// Captures d'ecran du dashboard, pour la documentation.
//
// Pourquoi Electron et pas un simple « chrome --screenshot » : la moitie des
// ecrans a montrer n'existe qu'apres un clic (l'assistant Twitch, la carte
// Spotify depliee, le journal ouvert). Ici on pilote la page avant de capturer.
//
//   node_modules\.bin\electron scripts/captures.mjs
//
// L'instance visee est celle du dossier de donnees isole (port 4466) : un
// StreamKit fraichement installe, rien de configure. C'est exactement ce que
// voit celui qui suit le mode operatoire.

import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// La fenetre de mise a jour est remplie a la main : elle ne s'ouvre que quand
// une version plus recente existe vraiment. Les numeros viennent donc de
// package.json plutot que d'etre ecrits en dur — sinon la capture ment des la
// version suivante.
const VERSION = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
const PRECEDENTE = process.env.SK_MAJ_AVANT || VERSION.replace(/(\d+)$/, (n) => Math.max(0, Number(n) - 1));

const BASE = process.env.SK_URL || 'http://127.0.0.1:4466';
const SORTIE = process.env.SK_OUT || join(process.cwd(), 'doc', 'captures');
const LARGEUR = 1440;
const HAUTEUR = 900;

// Le rendu se fait en pixels logiques ; ce facteur double la densite du PNG
// pour qu'une capture reste nette une fois posee sur une slide.
app.commandLine.appendSwitch('force-device-scale-factor', '2');

const attendre = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

// Chaque prise : un nom de fichier et le script qui amene la page dans l'etat
// voulu. Retour a l'accueil entre deux prises, sinon l'etat fuit de l'une a
// l'autre.
const PRISES = [
  {
    fichier: '01-accueil.png',
    js: `document.querySelector('#entree-accueil').click(); 'ok'`,
  },
  {
    // Twitch se configure sur l'ecran Connecteurs comme les autres services :
    // la fenetre qui doublonnait avec cette carte a ete supprimee.
    fichier: '02-twitch.png',
    js: `
      document.querySelector('#etat-twitch').click();
      await new Promise((r) => setTimeout(r, 700));
      'ok'`,
  },
  {
    fichier: '03-connecteurs.png',
    js: `
      document.querySelector('#entree-connecteurs').click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelector('[data-conn="spotify"]').click();
      await new Promise((r) => setTimeout(r, 200));
      // Le pli est memorise d'un dessin a l'autre : si le clic vient de le
      // refermer, on le rouvre.
      if (!document.querySelector('#retour-spotify')) document.querySelector('[data-conn="spotify"]').click();
      'ok'`,
  },
  {
    fichier: '04-module.png',
    js: `document.querySelector('[data-module="musique"]').click(); 'ok'`,
  },
  {
    fichier: '05-overlays.png',
    js: `
      document.querySelector('[data-module="roue-rl"]').click();
      await new Promise((r) => setTimeout(r, 250));
      const h = [...document.querySelectorAll('#detail h3')].find((x) => x.textContent.includes('Overlays'));
      if (h) h.scrollIntoView({ block: 'start' });
      'ok'`,
  },
  {
    fichier: '06-journal.png',
    js: `
      const t = document.querySelector('#tiroir');
      if (t.classList.contains('replie')) document.querySelector('#bascule-tiroir').click();
      'ok'`,
  },
  {
    fichier: '07-maj.png',
    // La vraie fenetre de mise a jour, remplie avec le saut qui vient d'avoir
    // lieu pour de bon. Rien d'invente : c'est le composant tel qu'il s'affiche.
    js: `
      document.querySelector('#maj-avant').textContent = '${PRECEDENTE}';
      document.querySelector('#maj-apres').textContent = '${VERSION}';
      const n = document.querySelector('#maj-notes');
      n.hidden = false;
      n.textContent = 'Le module de démonstration est masqué du rail.\\nDeux accents corrigés dans l’état Twitch.';
      document.querySelector('#modale-maj').showModal();
      'ok'`,
  },
];

// Tout est enferme dans une fonction : executeJavaScript evalue dans la portee
// globale, et un `const` au premier niveau survit d'un appel a l'autre — le
// deuxieme passage planterait sur « Identifier already declared ».
async function reinitialiser(w) {
  await w.webContents.executeJavaScript(`
    (() => {
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      const t = document.querySelector('#tiroir');
      if (!t.classList.contains('replie')) document.querySelector('#bascule-tiroir').click();
      document.querySelector('#entree-accueil').click();
      window.scrollTo(0, 0);
      document.querySelector('.detail')?.scrollTo(0, 0);
      return 'ok';
    })()
  `);
  await attendre(250);
}

app.whenReady().then(async () => {
  mkdirSync(SORTIE, { recursive: true });

  const win = new BrowserWindow({
    width: LARGEUR,
    height: HAUTEUR,
    useContentSize: true,
    show: false,
    backgroundColor: '#14121A',
  });

  await win.loadURL(BASE);
  // Le dashboard remplit son etat par des appels reseau apres le chargement.
  await attendre(2500);

  for (const prise of PRISES) {
    await reinitialiser(win);
    await win.webContents.executeJavaScript(`(async () => { ${prise.js} })()`);
    await attendre(700);
    const image = await win.webContents.capturePage();
    const chemin = join(SORTIE, prise.fichier);
    writeFileSync(chemin, image.toPNG());
    const t = image.getSize();
    console.log(prise.fichier + '  ' + t.width + 'x' + t.height);
  }

  app.exit(0);
});
