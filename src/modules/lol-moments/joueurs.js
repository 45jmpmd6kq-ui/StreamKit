// Qui est qui dans la partie.
//
// Les evenements ne designent les joueurs que par un NOM, et ce nom change de
// forme selon les cas :
//  - depuis les Riot ID, les evenements portent le nom de jeu SANS le #TAG,
//    alors que la liste des joueurs donne les deux ;
//  - en mode streamer (reglage du jeu, tres courant chez les streamers), les
//    evenements portent le nom du CHAMPION a la place de celui du joueur.
// Chaque joueur est donc retrouvable sous tous ses noms. Un nom de joueur passe
// avant un nom de champion : quelqu'un peut s'appeler « Ahri » sans jouer Ahri.

const PREFIXE_CHAMPION = 'game_character_displayname_';

export function normaliser(nom) {
  return String(nom ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase();
}

const sansTag = (nom) => String(nom ?? '').split('#')[0];

// « game_character_displayname_MonkeyKing » -> « MonkeyKing » : la cle interne
// du champion, celle de Data Dragon (a la casse pres, voir module.js).
export function cleChampion(joueur) {
  const brut = String(joueur?.rawChampionName || '');
  return brut.startsWith(PREFIXE_CHAMPION) ? brut.slice(PREFIXE_CHAMPION.length) : '';
}

export function creerRoster(liste, nomActif) {
  const joueurs = (Array.isArray(liste) ? liste : []).map((j) => ({
    nom: sansTag(j.riotIdGameName || j.riotId || j.summonerName || ''),
    champion: String(j.championName || ''),
    cle: cleChampion(j),
    equipe: String(j.team || ''),
    noms: [j.riotId, j.riotIdGameName, j.summonerName],
  }));

  const parNom = new Map();
  const parChampion = new Map();
  const noter = (table, nom, joueur) => {
    const k = normaliser(nom);
    if (k && !table.has(k)) table.set(k, joueur);
  };
  for (const j of joueurs) {
    for (const n of j.noms) {
      noter(parNom, n, j);
      noter(parNom, sansTag(n), j);
    }
    noter(parChampion, j.champion, j);
    noter(parChampion, j.cle, j);
  }

  const trouver = (nom) => {
    const k = normaliser(nom);
    if (!k) return null;
    return parNom.get(k) ?? parNom.get(normaliser(sansTag(nom))) ?? parChampion.get(k) ?? null;
  };

  const moi = trouver(nomActif);
  return {
    joueurs,
    moi,
    trouver,
    estMoi: (nom) => Boolean(moi) && trouver(nom) === moi,
  };
}
