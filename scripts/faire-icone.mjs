// Genere l'icone de l'application : src/assets/icone.png (256x256).
//
//   node scripts/faire-icone.mjs
//
// Aucune bibliotheque d'images n'est installee, et on ne va pas ajouter une
// dependance pour trois rectangles : le PNG est encode a la main (zlib est dans
// Node). electron-builder se charge ensuite de produire le .ico pour Windows.
//
// Rendu en 4x puis reduit : c'est ce qui donne des bords lisses sans avoir a
// ecrire un moteur d'anticrenelage.
//
// Motif : un egaliseur a trois barres. Choisi parce qu'il reste lisible a 16x16
// dans la zone de notification, la ou un dessin detaille deviendrait une bouillie.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TAILLE = 256;
const SUR = 4; // facteur de suréchantillonnage
const W = TAILLE * SUR;

const FOND = [0x17, 0x17, 0x1f, 0xff];
const VIOLET = [0x91, 0x46, 0xff, 0xff]; // accent Twitch
const VERT = [0x1d, 0xb9, 0x54, 0xff]; // accent Spotify

const buf = new Uint8Array(W * W * 4); // RGBA, transparent au depart

function dansArrondi(px, py, x, y, w, h, r) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const gx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const gy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  const dx = px - gx;
  const dy = py - gy;
  return dx * dx + dy * dy <= r * r;
}

// Dessine un rectangle arrondi. Coordonnees donnees dans le repere 256, mises a
// l'echelle ici : le code du motif reste lisible.
function arrondi(x, y, w, h, r, couleur) {
  const [X, Y, L, H, R] = [x * SUR, y * SUR, w * SUR, h * SUR, r * SUR];
  const x0 = Math.max(0, Math.floor(X));
  const y0 = Math.max(0, Math.floor(Y));
  const x1 = Math.min(W, Math.ceil(X + L));
  const y1 = Math.min(W, Math.ceil(Y + H));

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (!dansArrondi(px + 0.5, py + 0.5, X, Y, L, H, R)) continue;
      const i = (py * W + px) * 4;
      buf[i] = couleur[0];
      buf[i + 1] = couleur[1];
      buf[i + 2] = couleur[2];
      buf[i + 3] = couleur[3];
    }
  }
}

// --- Le motif ---------------------------------------------------------------

arrondi(0, 0, 256, 256, 56, FOND);

// Trois barres en pilule, hauteurs differentes = egaliseur.
const LARGEUR = 34;
const RAYON = LARGEUR / 2;
const BAS = 196;
const barres = [
  { x: 54, hauteur: 74, couleur: VIOLET },
  { x: 111, hauteur: 132, couleur: VERT },
  { x: 168, hauteur: 102, couleur: VIOLET },
];
for (const b of barres) {
  arrondi(b.x, BAS - b.hauteur, LARGEUR, b.hauteur, RAYON, b.couleur);
}

// --- Reduction 4x -> 1x (moyenne des sous-pixels) ---------------------------

const sortie = new Uint8Array(TAILLE * TAILLE * 4);
for (let y = 0; y < TAILLE; y++) {
  for (let x = 0; x < TAILLE; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SUR; sy++) {
      for (let sx = 0; sx < SUR; sx++) {
        const i = ((y * SUR + sy) * W + (x * SUR + sx)) * 4;
        r += buf[i];
        g += buf[i + 1];
        b += buf[i + 2];
        a += buf[i + 3];
      }
    }
    const n = SUR * SUR;
    const j = (y * TAILLE + x) * 4;
    sortie[j] = Math.round(r / n);
    sortie[j + 1] = Math.round(g / n);
    sortie[j + 2] = Math.round(b / n);
    sortie[j + 3] = Math.round(a / n);
  }
}

// --- Encodage PNG -----------------------------------------------------------

const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(octets) {
  let c = 0xffffffff;
  for (const o of octets) c = TABLE_CRC[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function morceau(type, donnees) {
  const corps = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(donnees)]);
  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(donnees.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([taille, corps, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(TAILLE, 0);
ihdr.writeUInt32BE(TAILLE, 4);
ihdr[8] = 8; // 8 bits par canal
ihdr[9] = 6; // RGBA
ihdr[10] = 0; // compression deflate
ihdr[11] = 0; // filtrage standard
ihdr[12] = 0; // pas d'entrelacement

// Chaque ligne est precedee de son octet de filtre (0 = aucun).
const lignes = Buffer.alloc(TAILLE * (TAILLE * 4 + 1));
for (let y = 0; y < TAILLE; y++) {
  const depart = y * (TAILLE * 4 + 1);
  lignes[depart] = 0;
  Buffer.from(sortie.buffer, y * TAILLE * 4, TAILLE * 4).copy(lignes, depart + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  morceau('IHDR', ihdr),
  morceau('IDAT', deflateSync(lignes, { level: 9 })),
  morceau('IEND', Buffer.alloc(0)),
]);

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(RACINE, 'src', 'assets'), { recursive: true });
// Dans src/ et pas build/ : build/ est le dossier de ressources d'electron-builder,
// il sert a fabriquer l'installeur et n'est PAS embarque dans l'application.
// L'icone doit etre lisible a l'execution (icone pres de l'horloge, fenetre).
const cible = join(RACINE, 'src', 'assets', 'icone.png');
writeFileSync(cible, png);

console.log('Icone ecrite : ' + cible + '  (' + TAILLE + 'x' + TAILLE + ', ' + png.length + ' octets)');
