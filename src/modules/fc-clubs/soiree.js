// La soiree Clubs : les matchs qui s'enchainent sans pause de plus de quelques
// heures, et ce qu'on en tire (bilan, serie, trophees).
//
// Elle se calcule depuis l'heure des matchs chez EA, pas depuis le lancement de
// StreamKit : une mise a jour qui le relance en plein live ne doit pas remettre
// le bilan a zero (meme choix que la game de chauffe Rocket League). Le bouton
// « Nouvelle soirée » pose une date avant laquelle plus rien ne compte.

// Les matchs de la soiree en cours, du plus ancien au plus recent. Vide si le
// dernier match date de plus d'une pause : la soiree precedente est finie, la
// suivante n'a pas commence.
export function matchsDeLaSoiree(matchs, { pauseMs, reinitA = 0, maintenant = Date.now() }) {
  const tries = matchs.filter((m) => m.a >= reinitA).sort((x, y) => x.a - y.a);
  if (!tries.length || maintenant - tries.at(-1).a > pauseMs) return [];
  let debut = tries.length - 1;
  while (debut > 0 && tries[debut].a - tries[debut - 1].a <= pauseMs) debut--;
  return tries.slice(debut);
}

// Un match compte d'apres le bilan du club (`provisoire`, voir bilan-club.js)
// entre dans le bilan et la serie, mais pas dans les buts ni les trophees : EA
// n'en donne ni le score ni les joueurs.
export function bilan(soiree) {
  const compte = (r) => soiree.filter((m) => m.resultat === r).length;
  return {
    v: compte('V'),
    n: compte('N'),
    d: compte('D'),
    pour: soiree.reduce((s, m) => s + (m.buts ?? 0), 0),
    contre: soiree.reduce((s, m) => s + (m.encaisses ?? 0), 0),
  };
}

// La ligne sous le bilan. Une serie compte a partir de 2 (comme le compteur
// Rocket League) ; « sans défaite » a partir de 3, sinon un nul au milieu de
// victoires effacerait tout.
export function serie(soiree) {
  if (!soiree.length) return { texte: 'En attente du premier match', ton: 'neutre', icone: '' };
  const resultats = soiree.map((m) => m.resultat);
  const dernier = resultats.at(-1);
  const enFin = (garder) => {
    let n = 0;
    for (let i = resultats.length - 1; i >= 0 && garder(resultats[i]); i--) n++;
    return n;
  };

  const n = enFin((r) => r === dernier);
  if (dernier === 'V' && n >= 2) return { texte: n + ' victoires d’affilée', ton: 'or', icone: 'flamme' };
  if (dernier === 'D' && n >= 2) return { texte: n + ' défaites d’affilée', ton: 'rouge', icone: 'baisse' };
  const invaincu = enFin((r) => r !== 'D');
  if (invaincu >= 3) return { texte: invaincu + ' matchs sans défaite', ton: 'or', icone: 'flamme' };

  const m = soiree.at(-1);
  const mot = { V: 'victoire', N: 'nul', D: 'défaite' }[dernier];
  const score = m.provisoire ? '' : ' ' + m.buts + '–' + m.encaisses;
  return { texte: 'Dernier match : ' + mot + score, ton: 'neutre', icone: '' };
}

// Les chiffres de chaque joueur sur la soiree.
export function statsJoueurs(soiree) {
  const parNom = new Map();
  for (const m of soiree) {
    for (const j of m.joueurs) {
      const s = parNom.get(j.nom) ?? {
        nom: j.nom,
        matchs: 0,
        buts: 0,
        pd: 0,
        notes: 0,
        hdm: 0,
        arrets: 0,
        tacles: 0,
        postes: {},
      };
      s.matchs++;
      s.buts += j.buts;
      s.pd += j.pd;
      s.notes += j.note;
      s.hdm += j.hdm ? 1 : 0;
      s.arrets += j.arrets;
      s.tacles += j.tacles;
      if (j.poste) s.postes[j.poste] = (s.postes[j.poste] ?? 0) + 1;
      parNom.set(j.nom, s);
    }
  }
  return [...parNom.values()].map((s) => {
    const poste = Object.entries(s.postes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
    return { ...s, moyenne: s.notes / s.matchs, poste };
  });
}

// Le premier selon `valeur`, a egalite departage par `puis`. Null si personne
// n'a mieux que zero : un Soulier d'or a 0 but n'a pas de sens.
function premier(joueurs, valeur, puis) {
  const candidats = joueurs.filter((j) => valeur(j) > 0);
  if (!candidats.length) return null;
  return candidats.sort((x, y) => valeur(y) - valeur(x) || puis(y) - puis(x))[0];
}

// Les quatre trophees du tableau de fin de soiree. Le MVP est la meilleure note
// moyenne parmi ceux qui ont joue au moins la moitie des matchs : un 9 sur un
// seul match ne doit pas battre une soiree entiere a 8.
export function trophees(soiree) {
  const detailles = soiree.filter((m) => !m.provisoire);
  const joueurs = statsJoueurs(detailles);
  const assidus = joueurs.filter((j) => j.matchs >= Math.max(1, Math.ceil(detailles.length / 2)));
  const parNote = (j) => j.moyenne;
  const parMatchs = (j) => j.matchs;

  // Le mur : le gardien, sinon le meilleur tacleur des defenseurs, puis des
  // milieux. Jamais un attaquant -- vu sur une vraie soiree, un buteur a 114
  // tacles raflait le Soulier d'or, le Maitre passeur ET le mur.
  const gardien = premier(joueurs, (j) => j.arrets, parNote);
  const tacleur = (poste) =>
    premier(
      joueurs.filter((j) => j.poste === poste),
      (j) => j.tacles,
      parNote
    );
  const roc = gardien ? null : (tacleur('DEF') ?? tacleur('MIL'));
  let mur = null;
  if (gardien) mur = { ...gardien, exploit: 'arrets' };
  else if (roc) mur = { ...roc, exploit: 'tacles' };

  return {
    mvp: premier(assidus, parNote, parMatchs),
    buteur: premier(joueurs, (j) => j.buts, parNote),
    passeur: premier(joueurs, (j) => j.pd, parNote),
    mur,
  };
}
