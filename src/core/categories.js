// Catalogue des categories de modules.
//
// Une categorie est un REGROUPEMENT D'AFFICHAGE, pas une hierarchie de code :
// un module reste un dossier plat avec un identifiant unique. C'est voulu.
//   - les adresses d'overlay restent courtes -- /overlay/roue-rl/roue plutot que
//     /overlay/rocket-league/roue-rl/roue. C'est ce que le streamer colle dans
//     OBS, autant que ce soit lisible ;
//   - un module peut changer de categorie sans casser ses reglages ni ses
//     adresses deja placees dans OBS ;
//   - le contrat de module ne gagne pas un cran d'imbrication.
//
// Un module declare simplement `categorie: 'rocket-league'` dans son manifeste.
//
// A VENIR (quand ce sera necessaire, pas avant) : des reglages partages au
// niveau de la categorie. Le tracker RL et le compteur 1v1 liront tous les deux
// Launch.log — leur demander deux fois le meme chemin serait absurde. La
// structure ci-dessous est prete a accueillir un champ `champs` par categorie.

export const CATEGORIES = [
  { id: 'twitch', label: 'Twitch', icone: '🟣', ordre: 10 },
  { id: 'rocket-league', label: 'Rocket League', icone: '🚀', ordre: 20 },
  { id: 'lol', label: 'League of Legends', icone: '⚔️', ordre: 30 },
  { id: 'valorant', label: 'Valorant', icone: '🔫', ordre: 40 },
  // Fourre-tout volontaire, toujours en dernier : ce qui ne depend d'aucun jeu
  // ni de Twitch (module de demonstration, futurs utilitaires).
  { id: 'outils', label: 'Outils', icone: '🧰', ordre: 90 },
];

const PAR_DEFAUT = CATEGORIES.find((c) => c.id === 'outils');

// Un module dont la categorie est absente ou inconnue atterrit dans « Outils »
// plutot que de disparaitre du rail. Une faute de frappe dans un manifeste ne
// doit jamais rendre un module invisible.
export function resoudre(id) {
  if (!id) return PAR_DEFAUT;
  return CATEGORIES.find((c) => c.id === id) ?? PAR_DEFAUT;
}

export function existe(id) {
  return CATEGORIES.some((c) => c.id === id);
}
