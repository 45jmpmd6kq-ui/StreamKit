// Suivi d'une prediction Twitch, sans rien savoir de Twitch ni d'OBS.
//
// Le module branche les evenements EventSub ; ce fichier les traduit en un
// objet simple que l'overlay sait afficher, et decide de ce qui reste a
// l'ecran. Tout ce qui peut mal tourner en direct est ici, donc testable :
//
//   - EventSub ne garantit PAS l'ordre de livraison. Une « progression » qui
//     arrive apres le « verrou » ne doit pas rouvrir les votes a l'ecran, et
//     une progression tardive ne doit pas ressusciter une prediction terminee.
//   - Les pourcentages doivent faire 100. Arrondir chaque issue a part donne
//     vite 99 ou 101 (33,3 + 33,3 + 33,3), ce qui se voit sur un overlay.
//   - Une prediction terminee reste affichee le temps de lire le resultat,
//     puis la carte disparait : au repos, l'overlay est invisible.

// Ordre de vie d'une prediction. Terminee = resolue ou annulee.
const RANG = { active: 0, verrouillee: 1, resolue: 2, annulee: 2 };

export const estTerminee = (p) => p?.statut === 'resolue' || p?.statut === 'annulee';

const temps = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null);
const entier = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : 0);

// Pourcentages entiers dont la somme fait exactement 100 (methode du plus fort
// reste). Twitch calcule ses pourcentages sur les POINTS, pas sur les votants :
// 13 421 points contre 4 444 = 75 % / 25 %, meme a 14 votants contre 3.
export function pourcentages(valeurs) {
  const total = valeurs.reduce((s, v) => s + v, 0);
  if (total <= 0) return valeurs.map(() => 0);

  const bruts = valeurs.map((v) => (v * 100) / total);
  const parts = bruts.map(Math.floor);
  let reste = 100 - parts.reduce((s, v) => s + v, 0);

  const ordre = bruts.map((b, i) => ({ i, frac: b - Math.floor(b) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of ordre) {
    if (reste <= 0) break;
    parts[i]++;
    reste--;
  }
  return parts;
}

// Forme commune, qu'elle vienne d'EventSub, de l'API Helix ou de la simulation.
function assembler({ id, titre, statut, verrouA, fermeeA = null, gagnant, issues, simulation = false }) {
  const propres = issues.map((o) => ({
    id: String(o.id),
    titre: String(o.titre ?? ''),
    // Twitch ne connait que deux couleurs : bleu pour la premiere issue, rose
    // pour la seconde quand il n'y en a que deux, bleu partout au-dela.
    couleur: String(o.couleur ?? '').toLowerCase() === 'pink' ? 'rose' : 'bleu',
    votants: entier(o.votants),
    points: entier(o.points),
  }));
  const parts = pourcentages(propres.map((o) => o.points));
  propres.forEach((o, i) => (o.pourcent = parts[i]));

  return {
    id: String(id),
    titre: String(titre ?? ''),
    statut,
    verrouA: statut === 'active' ? verrouA : null,
    // Heure REELLE de fermeture des votes : c'est d'elle que part le delai avant
    // de masquer le scoreboard, pas de l'instant ou StreamKit l'apprend.
    fermeeA: statut === 'verrouillee' ? fermeeA : null,
    gagnant: statut === 'resolue' ? (gagnant ?? null) : null,
    issues: propres,
    totalPoints: propres.reduce((s, o) => s + o.points, 0),
    totalVotants: propres.reduce((s, o) => s + o.votants, 0),
    simulation,
  };
}

// Evenement EventSub (Twurple) -> prediction affichable.
// `phase` : 'debut' | 'progression' | 'verrou' | 'fin'.
export function depuisEvenement(e, phase) {
  let statut = 'active';
  if (phase === 'verrou') statut = 'verrouillee';
  if (phase === 'fin') statut = e.status === 'canceled' ? 'annulee' : 'resolue';

  return assembler({
    id: e.id,
    titre: e.title,
    statut,
    // Sur debut et progression, lockDate est l'heure PREVUE de fermeture ; sur
    // le verrou, l'heure a laquelle les votes ont reellement ferme.
    verrouA: temps(e.lockDate),
    fermeeA: phase === 'verrou' ? temps(e.lockDate) : null,
    gagnant: phase === 'fin' ? e.winningOutcomeId : null,
    issues: (e.outcomes ?? []).map((o) => ({
      id: o.id,
      titre: o.title,
      couleur: o.color,
      // L'evenement de debut n'a pas encore de votes : Twurple n'expose
      // simplement pas ces champs.
      votants: o.users,
      points: o.channelPoints,
    })),
  });
}

// Prediction lue par l'API (au demarrage, quand StreamKit se lance alors qu'une
// prediction tourne deja : les evenements ne disent que les transitions).
const STATUTS_HELIX = { ACTIVE: 'active', LOCKED: 'verrouillee', RESOLVED: 'resolue', CANCELED: 'annulee' };

export function depuisHelix(p) {
  const statut = STATUTS_HELIX[p.status];
  if (!statut) return null;
  const creee = temps(p.creationDate);
  return assembler({
    id: p.id,
    titre: p.title,
    statut,
    // L'API ne donne pas l'heure de fermeture prevue : on la deduit.
    verrouA: creee != null ? creee + entier(p.autoLockAfter) * 1000 : null,
    fermeeA: temps(p.lockDate),
    gagnant: p.winningOutcomeId,
    issues: (p.outcomes ?? []).map((o) => ({
      id: o.id,
      titre: o.title,
      couleur: o.color,
      votants: o.users,
      points: o.totalChannelPoints,
    })),
  });
}

// --- Ce qui reste a l'ecran -----------------------------------------------
//
// publier(p | null)      pousse l'etat vers l'overlay
// planifier(fn, ms)      -> fonction d'annulation (ctx.minuteur en vrai)
// dureeResultatMs        combien de temps le resultat reste affiche
// masquerVerrouApresMs   null = le scoreboard reste pendant que les votes sont
//                        fermes ; sinon il s'efface ce delai APRES LA FERMETURE
//                        et revient pour le resultat (ou l'annulation)
// maintenant()           horloge, injectable pour les tests
// surNouvelle(p)         premiere fois qu'on voit cette prediction (compteurs)
// surTerminee(p)         une prediction se termine, une seule fois par id
// (les deux sont aussi appeles pour une simulation : p.simulation le dit)
export function creerSuivi({
  publier,
  planifier,
  dureeResultatMs = 15000,
  masquerVerrouApresMs = null,
  maintenant = Date.now,
  surNouvelle = () => {},
  surTerminee = () => {},
}) {
  let courante = null;
  let visible = false;
  let annulerMinuteur = null;
  const vues = new Set(); // ids deja comptes au debut
  const finies = new Set(); // ids deja comptes a la fin

  function arreterMinuteur() {
    annulerMinuteur?.();
    annulerMinuteur = null;
  }

  function montrer(p) {
    visible = true;
    publier(p);
  }

  function masquer() {
    arreterMinuteur();
    visible = false;
    publier(null);
  }

  // Renvoie true si l'evenement a change ce qui est suivi.
  function recevoir(p) {
    if (!p) return false;

    if (courante && p.id === courante.id) {
      // Livraison dans le desordre : on ne recule jamais dans le cycle de vie.
      if (RANG[p.statut] < RANG[courante.statut]) return false;
      // Une fin deja traitee (evenement rejoue apres une reconnexion) : rien a
      // refaire, surtout pas relancer le minuteur de masquage.
      if (estTerminee(courante) && estTerminee(p)) return false;
      // Pareil pour un verrou deja recu : il ferait ressortir un scoreboard
      // masque, et les votes fermes n'ont plus rien de neuf a montrer.
      if (courante.statut === 'verrouillee' && p.statut === 'verrouillee') return false;
    } else if (finies.has(p.id)) {
      // Une prediction deja terminee et masquee, qui revient par un evenement
      // tardif : elle n'a plus rien a faire a l'ecran.
      return false;
    }

    if (!vues.has(p.id)) {
      vues.add(p.id);
      surNouvelle(p);
    }

    arreterMinuteur();
    courante = p;

    if (estTerminee(p)) {
      finies.add(p.id);
      surTerminee(p);
      if (dureeResultatMs <= 0) {
        masquer();
      } else {
        montrer(p);
        annulerMinuteur = planifier(masquer, dureeResultatMs);
      }
      return true;
    }

    if (p.statut === 'verrouillee' && masquerVerrouApresMs != null) {
      // Votes fermes depuis longtemps (module relance en pleine partie, apres un
      // reglage enregistre) : le delai est deja passe, on ne ressort pas le
      // scoreboard 15 s au milieu du jeu.
      const ecoule = p.fermeeA != null ? Math.max(0, maintenant() - p.fermeeA) : 0;
      const reste = masquerVerrouApresMs - ecoule;
      if (reste <= 0) {
        masquer();
      } else {
        montrer(p);
        annulerMinuteur = planifier(masquer, reste);
      }
      return true;
    }

    montrer(p);
    return true;
  }

  return {
    recevoir,
    masquer,
    courante: () => courante,
    visible: () => visible,
  };
}

// --- Simulation ------------------------------------------------------------
//
// Deroule une prediction factice complete a travers le MEME chemin que les
// vrais evenements : lancee, votes qui montent, votes fermes, resultat. Sert a
// regler l'overlay, et a verifier la chaine sans chaine Affiliee (Twitch
// reserve les predictions aux Affilies et Partenaires).
//
// pauseAvantResultatMs : entre la fermeture des votes et le resultat. Le module
// la cale au-dela du delai de masquage, pour que la simulation montre tout : le
// scoreboard qui s'efface pendant la « partie », puis qui revient au resultat.
//
// Renvoie les etapes [{ apresMs, prediction }] ; le module les planifie.
export function scenarioSimulation({
  maintenant = Date.now(),
  fenetreSec = 20,
  pauseAvantResultatMs = 4000,
} = {}) {
  const id = 'simulation-' + maintenant;
  const titre = 'Victoire ou défaite ?';
  const verrouA = maintenant + fenetreSec * 1000;

  // Votes cumules a chaque etape [points bleu, votants bleu, points rose, votants rose].
  // La defaite mene au debut, la victoire remonte : c'est ce qui fait bouger
  // les barres et changer la couleur de tete a l'ecran.
  const votes = [
    [0, 0, 0, 0],
    [500, 1, 1200, 1],
    [2100, 3, 2300, 2],
    [4800, 6, 2900, 2],
    [8200, 9, 3600, 3],
    [11000, 12, 4100, 3],
    [13421, 14, 4444, 3],
  ];

  const issues = (v) => [
    { id: id + '-bleu', titre: '✅ Victoire', couleur: 'blue', points: v[0], votants: v[1] },
    { id: id + '-rose', titre: '❌ Défaite', couleur: 'pink', points: v[2], votants: v[3] },
  ];

  const pas = Math.floor((fenetreSec * 1000) / votes.length);
  const etapes = votes.map((v, i) => ({
    apresMs: i * pas,
    prediction: assembler({ id, titre, statut: 'active', verrouA, issues: issues(v), simulation: true }),
  }));

  const final = votes[votes.length - 1];
  etapes.push({
    apresMs: fenetreSec * 1000,
    prediction: assembler({
      id,
      titre,
      statut: 'verrouillee',
      fermeeA: verrouA,
      issues: issues(final),
      simulation: true,
    }),
  });
  etapes.push({
    apresMs: fenetreSec * 1000 + pauseAvantResultatMs,
    prediction: assembler({
      id,
      titre,
      statut: 'resolue',
      gagnant: id + '-bleu',
      issues: issues(final),
      simulation: true,
    }),
  });
  return etapes;
}
