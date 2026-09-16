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
//
// Mais « archived » peut aussi etre la SEULE fin : sondage arrete et retire du
// chat d'un coup, sans resultat. La carte part alors avec lui.
//
// Et une fin peut se perdre (EventSub reconnecte au mauvais moment) : passe
// l'heure de fin, un filet redemande le sondage a l'API.
//
// Sans ces deux gardes, constate en live chez un streamer : la carte restait
// figee sur « Cloture… », sans jamais partir.

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

// Filet : delai laisse a EventSub apres l'heure de fin avant de demander a
// l'API, puis relances tant que l'API ne tranche pas. Au bout du compte (une
// petite minute apres la fin), la carte part quand meme.
export const ATTENTE_FIN_MS = 10_000;
export const RELANCE_MS = 15_000;
export const ESSAIS_MAX = 4;

// publier(s | null), planifier(fn, ms) -> annulation, dureeResultatMs
// relire(id) -> le sondage selon l'API (null = plus sur Twitch) ; leve sans reponse
// surNouveau(s) une fois par id ; surTermine(s) une fois par id, avec resultat
// surRetire(s, raison) une fois par id, parti SANS resultat : 'retire' (retire
// du chat sur Twitch) ou 'sans-nouvelles' (fin jamais confirmee)
export function creerSuivi({
  publier,
  planifier,
  dureeResultatMs = 15000,
  relire = null,
  maintenant = Date.now,
  surNouveau = () => {},
  surTermine = () => {},
  surRetire = () => {},
}) {
  let courant = null;
  let annulerMinuteur = null;
  let annulerFilet = null;
  let generationFilet = 0; // un filet rearme ou coupe rend caduc le precedent
  const vus = new Set();
  const finis = new Set();

  const arreterMinuteur = () => {
    annulerMinuteur?.();
    annulerMinuteur = null;
  };
  const arreterFilet = () => {
    generationFilet++;
    annulerFilet?.();
    annulerFilet = null;
  };
  const masquer = () => {
    arreterMinuteur();
    publier(null);
  };

  // Parti sans resultat : la carte quitte l'ecran, et rien ne la fait revenir.
  function retirer(s, raison) {
    finis.add(s.id);
    arreterFilet();
    courant = null;
    masquer();
    surRetire(s, raison);
  }

  // Pose a chaque etat « actif » : si aucune fin n'est arrivee a l'heure, on
  // demande a l'API. Une fin normale le coupe avant qu'il ne serve.
  function armerFilet(s) {
    arreterFilet();
    if (s.simulation || s.finA == null) return;
    const generation = generationFilet;
    const toujoursUtile = () => generation === generationFilet;

    const essayer = async (essai) => {
      if (!toujoursUtile()) return;
      let lu;
      try {
        lu = relire ? await relire(s.id) : undefined;
      } catch {
        lu = undefined; // pas de reponse : on retentera
      }
      if (!toujoursUtile()) return; // la fin est arrivee pendant la lecture
      if (lu === null) return retirer(s, 'retire');
      if (estTermine(lu)) return void recevoir(lu);
      if (essai >= ESSAIS_MAX) return retirer(s, 'sans-nouvelles');
      annulerFilet = planifier(() => essayer(essai + 1), RELANCE_MS);
    };
    annulerFilet = planifier(() => essayer(1), Math.max(0, s.finA - maintenant()) + ATTENTE_FIN_MS);
  }

  function recevoir(s) {
    if (!s) return false;

    // Fin rejouee, progression tardive, ou « archived » apres le resultat :
    // rien a relancer, et surtout rien a couper si le resultat est a l'ecran.
    if (finis.has(s.id)) return false;
    if (courant && s.id === courant.id && estTermine(courant)) return false;

    // « archived » sans fin avant lui : arrete et retire du chat d'un coup.
    if (s.statut === 'archive') {
      if (courant?.id === s.id) {
        retirer(s, 'retire');
        return true;
      }
      finis.add(s.id); // jamais affiche : rien a retirer ni a compter
      return false;
    }

    if (!vus.has(s.id)) {
      vus.add(s.id);
      surNouveau(s);
    }
    arreterMinuteur();
    courant = s;

    if (estTermine(s)) {
      arreterFilet();
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
    armerFilet(s);
    publier(s);
    return true;
  }

  // Module arrete : une lecture de l'API encore en route ne republie rien.
  function arreter() {
    arreterFilet();
    arreterMinuteur();
  }

  return { recevoir, masquer, arreter, courant: () => courant };
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
