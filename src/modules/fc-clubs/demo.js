// Une soiree d'exemple, pour placer les trois sources dans OBS sans attendre un
// vrai match : celle des maquettes (FC Les Potes, 3 V 1 N 1 D). Elle passe par
// les memes fonctions que les vrais matchs, donc l'exemple montre exactement ce
// que le streamer verra.

const joueur = (nom, poste, note, stats = {}) => ({
  nom,
  poste,
  note,
  buts: 0,
  pd: 0,
  tirs: 0,
  passes: 0,
  passesTentees: 0,
  tacles: 0,
  taclesTentes: 0,
  arrets: 0,
  hdm: false,
  rouge: 0,
  ...stats,
});

const MATCHS = [
  {
    type: 'championnat',
    adversaire: 'Sporting Manette',
    buts: 1,
    encaisses: 1,
    resultat: 'N',
    joueurs: [
      joueur('Tomzer', 'ATT', 8.0, { buts: 1, tirs: 4, passes: 12, passesTentees: 16, hdm: true }),
      joueur('Yass', 'ATT', 7.6, { tirs: 2, passes: 14, passesTentees: 18 }),
      joueur('Kev', 'MIL', 7.3, { passes: 26, passesTentees: 31 }),
      joueur('Juju', 'DEF', 7.0, { tacles: 5, taclesTentes: 7 }),
      joueur('Maxou', 'MIL', 7.2, { pd: 1, tirs: 1, passes: 19, passesTentees: 24 }),
      joueur('Nico', 'G', 7.0, { arrets: 3 }),
    ],
  },
  {
    type: 'championnat',
    adversaire: 'Olympique Canapé',
    buts: 0,
    encaisses: 2,
    resultat: 'D',
    joueurs: [
      joueur('Tomzer', 'ATT', 6.5, { tirs: 3, passes: 9, passesTentees: 15 }),
      joueur('Yass', 'ATT', 7.8, { tirs: 2, passes: 15, passesTentees: 19 }),
      joueur('Kev', 'MIL', 6.8, { passes: 22, passesTentees: 30 }),
      joueur('Juju', 'DEF', 7.3, { tacles: 6, taclesTentes: 9 }),
      joueur('Nico', 'G', 6.2, { arrets: 4 }),
    ],
  },
  {
    type: 'championnat',
    adversaire: 'AS Dimanche',
    buts: 2,
    encaisses: 1,
    resultat: 'V',
    joueurs: [
      joueur('Tomzer', 'ATT', 7.8, { buts: 1, tirs: 4, passes: 11, passesTentees: 15 }),
      joueur('Yass', 'ATT', 7.9, { buts: 1, tirs: 3, passes: 13, passesTentees: 17 }),
      joueur('Kev', 'MIL', 8.3, { pd: 1, passes: 29, passesTentees: 33, hdm: true }),
      joueur('Juju', 'DEF', 7.1, { tacles: 4, taclesTentes: 6 }),
      joueur('Maxou', 'MIL', 6.5, { tirs: 1, passes: 17, passesTentees: 25 }),
      joueur('Nico', 'G', 6.9, { arrets: 3 }),
    ],
  },
  {
    type: 'championnat',
    adversaire: 'Racing Tacos',
    buts: 3,
    encaisses: 1,
    resultat: 'V',
    joueurs: [
      joueur('Tomzer', 'ATT', 8.1, { buts: 1, tirs: 5, passes: 10, passesTentees: 14 }),
      joueur('Yass', 'ATT', 8.6, { buts: 1, pd: 2, tirs: 3, passes: 16, passesTentees: 19, hdm: true }),
      joueur('Kev', 'MIL', 7.6, { buts: 1, pd: 1, tirs: 2, passes: 27, passesTentees: 32 }),
      joueur('Juju', 'DEF', 6.9, { tacles: 3, taclesTentes: 6 }),
      joueur('Maxou', 'MIL', 7.0, { tirs: 1, passes: 21, passesTentees: 26 }),
      joueur('Nico', 'G', 7.2, { arrets: 1 }),
    ],
  },
  {
    type: 'championnat',
    adversaire: 'Inter Pantoufle',
    buts: 4,
    encaisses: 2,
    resultat: 'V',
    joueurs: [
      joueur('Tomzer', 'ATT', 8.9, { buts: 2, pd: 1, tirs: 5, passes: 14, passesTentees: 19, hdm: true }),
      joueur('Yass', 'ATT', 8.1, { buts: 1, pd: 1, tirs: 3, passes: 12, passesTentees: 16 }),
      joueur('Kev', 'MIL', 7.6, { pd: 2, passes: 31, passesTentees: 35 }),
      joueur('Juju', 'DEF', 7.2, { tacles: 6, taclesTentes: 8 }),
      joueur('Maxou', 'MIL', 7.0, { buts: 1, tirs: 2, passes: 18, passesTentees: 23 }),
      joueur('Nico', 'G', 6.4, { arrets: 3 }),
    ],
  },
];

export const CLUB_DEMO = { id: 'demo', nom: 'FC Les Potes', division: 4, kit: null };

// Skill rating : 1 448 avant la soiree, 1 486 apres (+12 sur le dernier match).
export const SR_DEMO = { debut: 1448, actuel: 1486, dernierMatch: 12 };

// Un match toutes les 22 minutes, le dernier fini il y a 4 minutes.
export function soireeDemo(maintenant = Date.now()) {
  return MATCHS.map((m, i) => ({
    ...m,
    id: 'demo-' + (i + 1),
    a: maintenant - 4 * 60_000 - (MATCHS.length - 1 - i) * 22 * 60_000,
    abandon: false,
    dureeS: 16 * 60,
  }));
}
