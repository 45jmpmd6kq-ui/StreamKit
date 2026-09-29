// Ce que chaque source OBS recoit : des textes prets a poser. Les overlays ne
// calculent rien, ils affichent.

import { bilan, serie, trophees } from './soiree.js';
import { initiales, nomDivision } from './club.js';

const ESPACE_FINE = String.fromCharCode(0x202f);
const MOINS = String.fromCharCode(0x2212);

const TYPES = { championnat: 'Championnat', playoffs: 'Playoffs', amical: 'Amical' };
const RESULTATS = { V: 'Victoire', N: 'Nul', D: 'Défaite' };

const virgule = (n) => n.toFixed(1).replace('.', ',');
const signe = (n) => (n > 0 ? '+' + n : MOINS + Math.abs(n));
const milliers = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_FINE);
// En francais, 0 et 1 restent au singulier.
const nb = (n, un, plusieurs) => n + ' ' + (n > 1 ? plusieurs : un);

// Vert au-dessus de 8, rien de special entre 7 et 8, ambre entre 6 et 7, rouge
// en dessous : seuls les ecarts attirent l'oeil.
export function tonNote(note) {
  if (note >= 8) return 'vert';
  if (note >= 7) return 'neutre';
  return note >= 6 ? 'ambre' : 'rouge';
}

export function vueClub({ club, couleur }) {
  return {
    nom: club?.nom || '',
    initiales: initiales(club?.nom),
    couleur,
    division: nomDivision(club?.division),
  };
}

export function vueBandeau({ club, soiree }) {
  const b = bilan(soiree);
  return {
    visible: true,
    club,
    bilan: {
      v: b.v,
      n: b.n,
      d: b.d,
      libelles: {
        v: b.v > 1 ? 'Victoires' : 'Victoire',
        n: b.n > 1 ? 'Nuls' : 'Nul',
        d: b.d > 1 ? 'Défaites' : 'Défaite',
      },
    },
    serie: serie(soiree),
  };
}

// La ligne sous le nom de chaque joueur : ce qui compte a son poste.
function detailJoueur(j) {
  switch (j.poste) {
    case 'G':
      return nb(j.arrets, 'arrêt', 'arrêts');
    case 'DEF':
      return j.tacles + '/' + j.taclesTentes + ' tacles';
    case 'MIL':
      return j.passes + '/' + j.passesTentees + ' passes';
    default:
      return nb(j.tirs, 'tir', 'tirs');
  }
}

// Le fait marquant du match : un triple, sinon la meilleure precision de passe
// (15 tentatives au moins), sinon un gardien a 4 arrets et plus.
function statDuMatch(joueurs) {
  const buteur = joueurs.filter((j) => j.buts >= 3).sort((x, y) => y.buts - x.buts)[0];
  if (buteur) {
    const exploit = { 3: 'triplé', 4: 'quadruplé' }[buteur.buts] ?? buteur.buts + ' buts';
    return { texte: buteur.nom + ' · ' + exploit, valeur: '', ratio: null };
  }
  const precision = (j) => j.passes / j.passesTentees;
  const passeur = joueurs
    .filter((j) => j.passesTentees >= 15)
    .sort((x, y) => precision(y) - precision(x) || y.passes - x.passes)[0];
  if (passeur) {
    const ratio = precision(passeur);
    return {
      texte: passeur.nom + ' · ' + passeur.passes + ' passes réussies sur ' + passeur.passesTentees,
      valeur: Math.round(ratio * 100) + ESPACE_FINE + '%',
      ratio,
    };
  }
  const gardien = joueurs.filter((j) => j.arrets >= 4).sort((x, y) => y.arrets - x.arrets)[0];
  if (gardien) return { texte: gardien.nom + ' · ' + gardien.arrets + ' arrêts', valeur: '', ratio: null };
  return null;
}

// `sr` : ce que le match a fait gagner ou perdre au skill rating du club, s'il
// est connu. Un amical ne le change pas.
export function vueCarte({ club, match, visible, sr = null, adversaire = true }) {
  if (!match) return { visible: false, club, match: null };
  const joueurs = [...match.joueurs].sort((x, y) => y.note - x.note);
  const attribues = joueurs.reduce((s, j) => s + j.buts, 0);
  const competition = match.type !== 'amical';
  return {
    visible: !!visible,
    club,
    match: {
      resultat: match.resultat,
      libelle: RESULTATS[match.resultat] + (match.abandon ? ' par abandon' : ''),
      contexte: [TYPES[match.type] ?? '', competition ? club.division : ''].filter(Boolean).join(' · '),
      sr: competition && sr ? { texte: signe(sr), signe: Math.sign(sr) } : null,
      buts: match.buts,
      encaisses: match.encaisses,
      adversaire: adversaire ? match.adversaire : '',
      // Au-dela de 8 joueurs, les lignes se resserrent pour tenir dans la source.
      compact: joueurs.length > 8,
      joueurs: joueurs.map((j) => ({
        poste: j.poste || '–',
        nom: j.nom,
        detail: detailJoueur(j),
        buts: j.buts,
        pd: j.pd,
        note: virgule(j.note),
        ton: tonNote(j.note),
        hdm: j.hdm,
        rouge: j.rouge > 0,
      })),
      // Buts d'un coequipier IA, ou contre son camp : EA ne les attribue a personne.
      butsSansJoueur: Math.max(0, match.buts - attribues),
      stat: statDuMatch(joueurs),
    },
  };
}

function duree(soiree) {
  if (!soiree.length) return '';
  const debut = soiree[0].a - soiree[0].dureeS * 1000;
  const minutes = Math.max(0, Math.round((soiree.at(-1).a - debut) / 60_000));
  if (minutes < 60) return minutes + ' min';
  return Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0');
}

// `sr` : { actuel, debut } -- le skill rating du club maintenant, et avant le
// premier match de la soiree s'il a ete lu a temps (StreamKit lance apres le
// premier match ne le connait pas : pas d'ecart affiche plutot qu'un faux).
export function vueTableau({ club, soiree, sr = null, adversaire = true }) {
  const b = bilan(soiree);
  const t = trophees(soiree);
  const trophee = (cle, titre, joueur, detail) =>
    joueur
      ? { cle, titre, nom: joueur.nom, detail }
      : { cle, titre, nom: '—', detail: 'Pas encore attribué' };
  const ecart = sr?.actuel != null && sr?.debut != null ? sr.actuel - sr.debut : 0;

  return {
    visible: true,
    vide: soiree.length === 0,
    club,
    sousTitre: [club.nom, nb(soiree.length, 'match', 'matchs'), duree(soiree)].filter(Boolean).join(' · '),
    bilan: { v: b.v, n: b.n, d: b.d },
    buts: b.pour + ' – ' + b.contre,
    sr:
      sr?.actuel != null
        ? { valeur: milliers(sr.actuel), ecart: ecart ? signe(ecart) : '', signe: Math.sign(ecart) }
        : null,
    trophees: [
      trophee('mvp', 'MVP de la soirée', t.mvp, t.mvp && virgule(t.mvp.moyenne) + ' de note moyenne'),
      trophee('buteur', 'Soulier d’or', t.buteur, t.buteur && nb(t.buteur.buts, 'but', 'buts')),
      trophee(
        'passeur',
        'Maître passeur',
        t.passeur,
        t.passeur && nb(t.passeur.pd, 'passe décisive', 'passes décisives')
      ),
      trophee(
        'mur',
        'Le mur',
        t.mur,
        t.mur &&
          (t.mur.exploit === 'arrets'
            ? nb(t.mur.arrets, 'arrêt', 'arrêts')
            : nb(t.mur.tacles, 'tacle réussi', 'tacles réussis'))
      ),
    ],
    // Les cinq derniers, du plus ancien au plus recent.
    titreMatchs: soiree.length > 5 ? 'Les 5 derniers matchs' : 'Les matchs de la soirée',
    matchs: soiree.slice(-5).map((m) => ({
      resultat: m.resultat,
      score: m.buts + ' – ' + m.encaisses,
      legende: (adversaire && m.adversaire) || TYPES[m.type] || '',
    })),
  };
}
