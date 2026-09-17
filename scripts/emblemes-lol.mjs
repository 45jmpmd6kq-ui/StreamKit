// Emblemes de rang League of Legends pour l'overlay du module lol-session.
//
//   npx electron scripts/emblemes-lol.mjs
//
// Produit src/modules/lol-session/overlay/rangs/<palier>.png : l'embleme seul,
// recadre au carre et reduit a 112 x 112.
//
// Pourquoi ne pas les charger en ligne depuis l'overlay : les originaux publies
// par CommunityDragon (le miroir des fichiers du client) mesurent jusqu'a
// 2560 x 1440, et l'embleme n'en occupe qu'un quart au centre. Il faudrait
// charger 230 Ko pour une icone de 46 px, deviner le recadrage en CSS, et
// dependre d'un site communautaire pendant le live.
//
// Pourquoi Electron et pas Node : nativeImage sait decoder, recadrer et reduire
// un PNG. Aucune bibliotheque d'images a ajouter pour un script lance une fois
// par saison, quand Riot redessine les emblemes.
//
// Les images appartiennent a Riot Games ; leur usage dans un outil gratuit pour
// streamers entre dans sa politique pour les projets de fans.

import { app, nativeImage } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, 'src', 'modules', 'lol-session', 'overlay', 'rangs');
const SOURCE =
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-';

const PALIERS = [
  'iron',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'emerald',
  'diamond',
  'master',
  'grandmaster',
  'challenger',
];
const COTE = 112;

// Le halo lumineux fait partie de l'embleme ; le vide presque transparent qui
// l'entoure, non. Sous ce seuil d'opacite, un pixel ne compte pas pour le cadre.
const SEUIL_ALPHA = 12;
const MARGE = 0.04;

function carreAutourDeLEmbleme(image) {
  const { width, height } = image.getSize();
  const pixels = image.toBitmap(); // BGRA : l'opacite est le 4e octet
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= SEUIL_ALPHA) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('image entierement transparente');

  const cote = Math.min(Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * (1 + 2 * MARGE)), width, height);
  const borner = (v, max) => Math.max(0, Math.min(v, max));
  return {
    x: borner(Math.round((x0 + x1) / 2 - cote / 2), width - cote),
    y: borner(Math.round((y0 + y1) / 2 - cote / 2), height - cote),
    width: cote,
    height: cote,
  };
}

async function traiter(palier) {
  const r = await fetch(SOURCE + palier + '.png', { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(palier + ' : HTTP ' + r.status);
  const image = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
  if (image.isEmpty()) throw new Error(palier + ' : PNG illisible');

  const cadre = carreAutourDeLEmbleme(image);
  const png = image.crop(cadre).resize({ width: COTE, height: COTE, quality: 'best' }).toPNG();
  writeFileSync(join(SORTIE, palier + '.png'), png);
  console.log(palier.padEnd(12), cadre.width + ' px -> ' + COTE + ' px, ' + png.length + ' octets');
}

app
  .whenReady()
  .then(async () => {
    mkdirSync(SORTIE, { recursive: true });
    for (const palier of PALIERS) await traiter(palier);
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
