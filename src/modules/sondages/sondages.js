// Suivi d'un sondage Twitch, sans rien savoir de Twitch ni d'OBS.
//
// Meme logique que le module Predictions, en plus simple (pas de phase « votes
// fermes ») :
//   - EventSub ne garantit pas l'ordre : une progression tardive ne rouvre pas
//     un sondage termine, et un evenement rejoue ne relance rien ;
//   - les pourcentages font toujours 100 ;
//   - le resultat reste affiche un moment, puis la carte disparait.
//
// Twitch envoie parfois DEUX fins pour le meme sondage : « completed » (ou
// « terminated » s'il est clos a la main), puis « archived » quand il sort de
// l'historique. La seconde ne doit ni rallonger ni couper l'affichage.

// Copie volontaire de celle du module Predictions : un module ne depend jamais
// d'un autre (chacun se desactive seul).
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

const temps = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null);
const entier = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : 0);

export const estTermine = (s) => s?.statut === 'termine';

function assembler({ id, titre, statut, finA, cloture = false, choix, simulation = false }) {
  const propres = choix.map((c) => ({
    id: String(c.id),
    titre: String(c.titre ?? ''),
    votes: entier(c.votes),
  }));
  const parts = pourcentages(propres.map((c) => c.votes));
  propres.forEach((c, i) => (c.pourcent = parts[i]));

  const meilleur = Math.max(0, ...propres.map((c) => c.votes));
  return {
    id: String(id),
    titre: String(titre ?? ''),
    statut,
    finA: statut === 'actif' ? finA : null,
    cloture: statut === 'termine' && cloture,
    // Egalite en tete : tous les ex aequo sont gagnants. Sans aucun vote, personne.
    gagnants:
      statut === 'termine' && meilleur > 0
        ? propres.filter((c) => c.votes === meilleur).map((c) => c.id)
        : [],
    choix: propres,
    totalVotes: propres.reduce((s, c) => s + c.votes, 0),
    simulation,
  };
}

// Evenement EventSub (Twurple) -> sondage affichable. `phase` : 'debut' | 'progression' | 'fin'.
export function depuisEvenement(e, phase) {
  let statut = 'actif';
  if (phase === 'fin') statut = e.status === 'archived' ? 'archive' : 'termine';
  return assembler({
    id: e.id,
    titre: e.title,
    statut,
    finA: temps(e.endDate),
    cloture: e.status === 'terminated',
    choix: (e.choices ?? []).map((c) => ({ id: c.id, titre: c.title, votes: c.totalVotes })),
  });
}

// Sondage lu par l'API au demarrage (StreamKit relance pendant un sondage).
const STATUTS_HELIX = { ACTIVE: 'actif', COMPLETED: 'termine', TERMINATED: 'termine' };

export function depuisHelix(s) {
  const statut = STATUTS_HELIX[s.status];
  if (!statut) return null; // archive, modere, invalide : rien a montrer
  return assembler({
    id: s.id,
    titre: s.title,
    statut,
    finA: temps(s.endDate),
    cloture: s.status === 'TERMINATED',
    choix: (s.choices ?? []).map((c) => ({ id: c.id, titre: c.title, votes: c.totalVotes })),
  });
}

// publier(s | null), planifier(fn, ms) -> annulation, dureeResultatMs
// surNouveau(s) une fois par id ; surTermine(s) une fois par id
export function creerSuivi({
  publier,
  planifier,
  dureeResultatMs = 15000,
  surNouveau = () => {},
  surTermine = () => {},
}) {
  let courant = null;
  let annulerMinuteur = null;
  const vus = new Set();
  const finis = new Set();

  const arreterMinuteur = () => {
    annulerMinuteur?.();
    annulerMinuteur = null;
  };
  const masquer = () => {
    arreterMinuteur();
    publier(null);
  };

  function recevoir(s) {
    if (!s) return false;

    // « archived » : le sondage sort de l'historique Twitch. Rien a montrer, et
    // surtout rien a couper si son resultat est encore a l'ecran.
    if (s.statut === 'archive') return false;

    if (finis.has(s.id)) return false; // fin rejouee, ou progression tardive
    if (courant && s.id === courant.id && estTermine(courant)) return false;

    if (!vus.has(s.id)) {
      vus.add(s.id);
      surNouveau(s);
    }
    arreterMinuteur();
    courant = s;

    if (estTermine(s)) {
      finis.add(s.id);
      surTermine(s);
      if (dureeResultatMs <= 0) {
        masquer();
      } else {
        publier(s);
        annulerMinuteur = planifier(masquer, dureeResultatMs);
      }
      return true;
    }
    publier(s);
    return true;
  }

  return { recevoir, masquer, courant: () => courant };
}

// Sondage factice complet, par le meme chemin que les vrais evenements.
export function scenarioSimulation({ maintenant = Date.now(), dureeSec = 20 } = {}) {
  const id = 'simulation-' + maintenant;
  const titre = 'Quelle voiture pour la suite ?';
  const finA = maintenant + dureeSec * 1000;
  const noms = ['Octane', 'Fennec', 'Dominus'];
  // Votes cumules : le Fennec mene au debut, l'Octane le rattrape.
  const votes = [
    [0, 0, 0],
    [3, 6, 1],
    [12, 14, 5],
    [26, 24, 9],
    [41, 34, 15],
    [60, 43, 21],
  ];
  const choix = (v) => noms.map((titreChoix, i) => ({ id: id + '-' + i, titre: titreChoix, votes: v[i] }));
  const pas = Math.floor((dureeSec * 1000) / votes.length);
  const etapes = votes.map((v, i) => ({
    apresMs: i * pas,
    sondage: assembler({ id, titre, statut: 'actif', finA, choix: choix(v), simulation: true }),
  }));
  etapes.push({
    apresMs: dureeSec * 1000,
    sondage: assembler({ id, titre, statut: 'termine', choix: choix(votes.at(-1)), simulation: true }),
  });
  return etapes;
}
