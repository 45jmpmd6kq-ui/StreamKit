// Ce que l'overlay recoit.
//
// Tout est calcule et mis en forme ici, en francais : l'overlay ne fait que
// poser des textes, des couleurs et des coordonnees. C'est ce qui permet de
// tester chaque affichage (placements, Maitre sans division, LP inconnus...)
// sans ouvrir un navigateur.

import { BASE_MAITRE, FILES, couleur, depuisEchelle, echelle, nomRang } from './rang.js';
import {
  bilan,
  championsJoues,
  courbe,
  dansLaSession,
  evolutionSession,
  meilleurePartie,
  moyennes,
  ratioKda,
  visibilite,
} from './session.js';
import { infoChampion } from './champions.js';

// Espace fine insecable avant « % », comme le veut la typographie francaise.
const FINE = '\u202f';
const MOINS = '\u2212';

const deuxChiffres = (n) => String(n).padStart(2, '0');

export function decimal(v, chiffres) {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(chiffres).replace('.', ',');
}

export function signe(n) {
  if (n > 0) return '+' + n;
  if (n < 0) return MOINS + Math.abs(n);
  return '0';
}

export function duree(secondes) {
  const s = Math.max(0, Math.round(Number(secondes) || 0));
  return Math.floor(s / 60) + ':' + deuxChiffres(s % 60);
}

export function dureeSession(ms) {
  const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  const heures = Math.floor(minutes / 60);
  return heures ? heures + ' h ' + deuxChiffres(minutes % 60) : minutes + ' min';
}

export const kda = (p) => p.k + ' / ' + p.d + ' / ' + p.a;

const pluriel = (n, un, plusieurs) => n + ' ' + (n > 1 ? plusieurs : un);

export function blocRang(rang) {
  const neutre = { nom: '', palier: '', lp: '', progression: null, couleur: couleur('') };
  if (!rang) return neutre;
  if (!rang.palier) {
    if (rang.provisoire && rang.placementsTotal > 0) {
      const joues = Math.max(0, rang.placementsTotal - rang.placementsRestants);
      return {
        ...neutre,
        nom: 'Placements',
        lp: joues + '/' + rang.placementsTotal,
        progression: joues / rang.placementsTotal,
      };
    }
    return { ...neutre, nom: 'Non classé' };
  }
  return {
    nom: nomRang(rang),
    palier: rang.palier.toLowerCase(),
    lp: rang.lp + ' LP',
    // A partir de Maitre, plus de division a remplir : pas de barre.
    progression: echelle(rang) >= BASE_MAITRE ? null : Math.max(0, Math.min(1, rang.lp / 100)),
    couleur: couleur(rang.palier),
  };
}

// Une serie commence a deux : la flamme et la couleur pour une seule victoire
// annonceraient une serie qui n'existe pas. type reste vide en dessous.
function blocSerie(serie) {
  if (!serie) return { type: '', n: 0, texte: '—' };
  const type = serie.n >= 2 ? (serie.victoire ? 'V' : 'D') : '';
  return serie.victoire
    ? { type, n: serie.n, texte: pluriel(serie.n, 'victoire', 'victoires') }
    : { type, n: serie.n, texte: pluriel(serie.n, 'défaite', 'défaites') };
}

function blocLp(b, enAttente) {
  if (b.lpConnu) return { texte: signe(b.lp) + ' LP', signe: Math.sign(b.lp) };
  if (enAttente) return { texte: '… LP', signe: 0 };
  return { texte: b.parties ? '— LP' : '0 LP', signe: 0 };
}

const arrondi = (v) => Math.round(v * 1000) / 1000;

// Coordonnees de 0 a 1 (0 = en haut) : l'overlay les pose dans son cadre.
function blocCourbe(c) {
  if (!c) return null;
  const marge = Math.max(8, (c.max - c.min) * 0.12);
  const bas = c.min - marge;
  const haut = c.max + marge;
  const y = (v) => arrondi(1 - (v - bas) / (haut - bas));
  const dernier = c.points.length - 1;
  return {
    points: c.points.map((p, i) => ({ x: arrondi(i / dernier), y: y(p.valeur), victoire: p.victoire })),
    seuils: c.seuils.map((s) => ({ y: y(s.valeur), nom: s.nom.toUpperCase() })),
    zone: c.zone.toUpperCase(),
    fin: depuisEchelle(c.fin).lp + ' LP',
  };
}

function lpPartie(p) {
  if (p.lpEnAttente) return { lp: '…', signe: 0 };
  if (typeof p.lp !== 'number') return { lp: '—', signe: 0 };
  return { lp: signe(p.lp), signe: Math.sign(p.lp) };
}

// config   reglages du module
// suivi    etat du suivi (client, phase, rang)
// parties  historique persistant du module
// depuis   debut de la session (ms)
// champions table Data Dragon (voir champions.js)
export function construireVue({ config, suivi, parties, depuis, champions }) {
  const file = FILES[config.file] ?? FILES.solo;
  const joues = dansLaSession(parties, depuis);
  const b = bilan(joues);
  const champion = (id) => infoChampion(champions, id);

  const premiere = joues[0];
  const derniere = joues[joues.length - 1];
  const sousTitre = [
    file.nom,
    pluriel(joues.length, 'partie', 'parties'),
    premiere ? dureeSession(derniere.finA - (premiere.finA - premiere.dureeS * 1000)) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const m = moyennes(joues);
  const meilleure = meilleurePartie(joues);
  const ratio = meilleure ? ratioKda(meilleure) : 0;

  return {
    theme: {
      coinBandeau: config.coinBandeau || 'top-left',
      coinTableau: config.coinTableau || 'center',
    },
    visible: visibilite({
      affichage: config.affichage,
      phase: suivi.phase,
      clientOuvert: !!(suivi.clientOuvert && suivi.moi),
      nbParties: joues.length,
    }),
    rang: { ...blocRang(suivi.rang), evolution: evolutionSession(joues) },
    bilan: {
      lp: blocLp(
        b,
        joues.some((p) => p.lpEnAttente)
      ),
      victoires: b.victoires,
      defaites: b.defaites,
      winrate: b.winrate == null ? '' : b.winrate + FINE + '%',
      serie: blocSerie(b.serie),
    },
    tableau: {
      sousTitre,
      courbe: blocCourbe(courbe(joues)),
      parties: joues
        .slice(-6)
        .reverse()
        .map((p) => ({
          ...champion(p.championId),
          victoire: !!p.victoire,
          kda: kda(p),
          duree: duree(p.dureeS),
          ...lpPartie(p),
        })),
      champions: championsJoues(joues)
        .slice(0, 3)
        .map((c) => ({ ...champion(c.championId), victoires: c.victoires, defaites: c.defaites })),
      meilleure: meilleure
        ? {
            ...champion(meilleure.championId),
            kda: kda(meilleure),
            ratio: 'KDA ' + decimal(ratio, ratio >= 10 || Number.isInteger(ratio) ? 0 : 1),
          }
        : null,
      moyennes: {
        kda: decimal(m?.kda, 2),
        csMin: decimal(m?.csMin, 1),
        kp: m?.kp == null ? '—' : m.kp + FINE + '%',
        visionMin: decimal(m?.visionMin, 1),
      },
    },
  };
}
