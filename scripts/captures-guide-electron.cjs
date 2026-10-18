// Photographie les apercus des themes Twitch puis les ecrans du dashboard
// pour le guide (lance par scripts/captures-guide.mjs, qui a demarre une
// installation vierge).
//
// Fenetre 1280 x 820 rendue hors ecran. Deux overlays sont ouverts dans des
// fenetres cachees : ils comptent comme des sources OBS, et la Vue d'ensemble
// montre alors sa liste « Overlays OBS ».

/* global process, setTimeout, console */

const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

// APERCUS vide : la personnalisation est en suspens, pas d'apercus a refaire.
const { SORTIE, APERCUS, BASE } = process.env;
const THEMES = ['standard', 'esport', 'neon', 'minimal', 'arcade'];

const ECRANS = [
  { nom: 'accueil', js: "document.getElementById('entree-accueil').click()" },
  { nom: 'connecteurs', js: "document.getElementById('entree-connecteurs').click()" },
  { nom: 'module', js: 'document.querySelector(\'[data-module="rl-session"]\').click()' },
  {
    nom: 'module-overlays',
    js:
      'document.querySelector(\'[data-module="rl-session"]\').click();' +
      "setTimeout(() => [...document.querySelectorAll('.section h3')].find((h) => /Overlays/.test(h.textContent))?.scrollIntoView(), 600)",
  },
  { nom: 'activite', js: "document.getElementById('entree-activite').click()" },
  { nom: 'metriques', js: "document.getElementById('entree-metriques').click()" },
  { nom: 'bug', js: "document.getElementById('btn-bug').click()" },
];

const attendre = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

// Apercus de la page Personnalisation : la scene des cinq overlays Twitch
// (/apercu-twitch), animations terminees -- sinon on photographie un fondu.
async function apercus() {
  mkdirSync(APERCUS, { recursive: true });
  const scene = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: { offscreen: true },
  });
  scene.webContents.setFrameRate(30);
  for (const t of THEMES) {
    await scene.loadURL(BASE + '/apercu-twitch?theme=' + t);
    await attendre(3000);
    await scene.webContents.executeJavaScript(`(() => {
      for (const f of document.querySelectorAll('iframe')) {
        for (const a of f.contentDocument?.getAnimations() ?? []) {
          if (/sortie/.test(a.animationName || '')) a.cancel();
          else { try { a.finish(); } catch { a.pause(); } }
        }
      }
    })(); 1`);
    await attendre(300);
    writeFileSync(join(APERCUS, 'twitch-' + t + '.jpg'), (await scene.webContents.capturePage()).toJPEG(86));
    console.log('  apercus/twitch-' + t + '.jpg');
  }
  scene.destroy();
}

app.disableHardwareAcceleration();
// Entre deux series de captures, aucune fenetre n'est ouverte : sans ceci,
// Electron quitterait l'application en plein milieu.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  if (APERCUS) await apercus();

  const sources = [];
  for (const chemin of ['/overlay/musique/liste', '/overlay/lol-session/bandeau']) {
    const s = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await s.loadURL(BASE + chemin);
    sources.push(s);
  }

  const w = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { offscreen: true } });
  w.webContents.setFrameRate(30);
  for (const e of ECRANS) {
    await w.loadURL(BASE + '/');
    await attendre(2500);
    // Ni « Quoi de neuf » ni assistant par-dessus l'ecran photographie.
    await w.webContents.executeJavaScript(
      "document.querySelectorAll('dialog[open]').forEach((d) => d.close()); 1"
    );
    await w.webContents.executeJavaScript(e.js + '; 1');
    await attendre(e.attente || 2000);
    const image = await w.webContents.capturePage();
    writeFileSync(join(SORTIE, e.nom + '.jpg'), image.toJPEG(84));
    console.log('  ' + e.nom + '.jpg');
  }
  for (const s of sources) s.destroy();
  app.quit();
});
