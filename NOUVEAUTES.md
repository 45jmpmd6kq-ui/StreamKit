# Nouveautés de StreamKit

Ce que chaque version change, **écrit pour les streamers** — pas des messages de
commit. Ce texte est ce qu'ils lisent dans la fenêtre de mise à jour, dans la
release GitHub, et dans « Quoi de neuf » au redémarrage.

Une section `## <version>` par version publiée, avec au choix `### Nouveautés`
et `### Corrections`. Une ligne par point, à la deuxième personne, en disant ce
que ça change pour lui — jamais le nom d'un fichier ni d'une fonction.

`npm run publier` refuse de partir si la version publiée n'a pas sa section
ici, et un test le vérifie aussi à chaque `npm test`.

## 0.32.0

### Nouveautés

- **Nouvelle page « Activité récente »**, juste sous la vue d'ensemble : le fil
  de ton live, du plus récent au plus ancien — clips créés, musiques demandées,
  sondages et prédictions, pubs, parties RL et LoL, moments forts, matchs de
  ton club, voitures tirées, début et fin du live. Change de jour avec les
  flèches, « Hier » ou le calendrier (60 jours gardés), filtre par jeu, cherche
  un pseudo ou un titre. « + technique » y ajoute le journal du même jour.
- **Pastille orange pour un module en attente** : jeu fermé, client fermé, pas
  de partie en cours. Ce n'est pas une alerte, juste « rien à suivre pour
  l'instant ».
- **Overlays OBS** : chaque ligne porte l'univers (Twitch, RL, LoL, VLR, EA FC),
  et la liste montre toutes les sources branchées dans OBS — y compris celles
  d'un module désactivé, signalées en orange : elles sont dans tes scènes mais
  n'affichent rien.
- **Les jeux sont toujours dépliés** sur la vue d'ensemble : active un module
  directement avec son interrupteur.
- **Le journal technique quitte le bas de la fenêtre.** Ce qui compte est dans
  « Activité récente » ; une erreur y apparaît en rouge et reste une heure dans
  les alertes de la vue d'ensemble. Le journal part tout seul avec « Signaler
  un bug », et les réglages (⚙️) gardent un bouton pour ouvrir son dossier.
- Une entrée « Métriques » apparaît dans le menu : les statistiques de tes
  lives y arrivent dans une prochaine version.

## 0.31.1

### Corrections

- **Vue d'ensemble : les panneaux de jeux se rangent mieux.** Ils se placent
  de gauche à droite puis comblent la colonne la plus courte : plus de colonne
  vide ni de grand trou sous un petit panneau.
- **Des cartes plus compactes.** Les overlays ne sont plus répétés sous chaque
  module : ils restent listés dans « Overlays OBS », à droite, avec l'icône du
  module pour distinguer deux overlays du même nom.

## 0.31.0

### Nouveautés

- **Une nouvelle vue d'ensemble, façon tableau de bord.** En haut, une jauge
  te dit d'un coup d'œil si tu es prêt pour le live, et pourquoi pas encore.
  En dessous : tes connexions, puis un panneau par jeu avec chacun de tes
  modules, son état en clair et ses overlays allumés quand OBS les affiche.
- **Active ou coupe un module sans quitter l'accueil**, avec son interrupteur.
  Un clic sur un module ouvre ses réglages.
- **Les alertes rassemblées à droite**, avec un bouton pour aller droit au
  module ou à la connexion à régler, la liste des overlays branchés dans OBS
  et les derniers événements.
- Les compteurs d'utilisation (clips créés, victoires…) ne s'affichent plus
  sur l'accueil.

## 0.30.12

### Nouveautés

- **Formation du club : la carte atterrit.** Après son retournement, la carte
  retombe sur le terrain avec un petit impact et tremble un instant avant de
  se poser.

## 0.30.11

### Nouveautés

- **Formation du club : un retournement de carte digne d'un pack.** La carte
  tirée s'envole, fait plusieurs tours sur elle-même en ralentissant, une onde
  dorée part et un reflet holographique balaie le recto au moment où le
  joueur apparaît. « Tout retourner » enchaîne les cartes une demi-seconde
  l'une après l'autre.
- **Formation du club : les buteurs d'abord.** Sans poste imposé, le tirage
  remplit maintenant les places de BU en premier, puis celle de MOC, avant les
  autres milieux et les ailiers. À trois joueurs en 4-1-2-1-2, ce sont donc
  deux BU et un MOC ; un poste que tu imposes reste prioritaire.

## 0.30.8

### Nouveautés

- **Soirée Clubs : la formation de ton club, tirée au sort.** Clique sur
  « ⚽ Formation du club », sous Soirée Clubs dans la colonne de gauche :
  choisis ton schéma (4-3-3, 4-2-3-1, 4-1-2-1-2 serré ou large, 3-5-2…), puis
  clique sur les
  joueurs de ton club (les 12 plus assidus, que StreamKit lit chez EA) ou tape
  leurs pseudos, de 1 à 11. Impose un poste à ceux qui y tiennent ; les autres
  sont tirés au sort, d'abord au milieu et en attaque, puis en défense, dans
  les buts en dernier. Choisir une formation pose aussitôt ses 11 cartes de
  dos sur le terrain, chacune marquée de son poste. Au tirage, des cartes au
  format FC 27 arrivent face cachée, et la roulette les retourne une à une
  pour dévoiler qui joue où. Les places sans joueur ont leur carte argent
  « IA », visible d'emblée. Ta liste de joueurs est gardée d'une soirée à
  l'autre.

## 0.29.2

### Corrections

- **Soirée Clubs : ton bilan reste juste même quand EA oublie un match.** Il
  arrive qu'EA compte un match dans le bilan de ton club sans jamais le publier
  dans son historique : le bandeau restait alors bloqué sur le dernier match
  publié. StreamKit lit maintenant aussi le bilan du club, et compte ces matchs
  (victoire, nul ou défaite) dans le bandeau, la série et le tableau. Sans score
  ni joueurs, ils n'ont pas de carte de fin de match et ne comptent pas pour les
  trophées. Si EA publie le détail plus tard, le match le récupère sans être
  compté deux fois, et sa carte s'affiche si aucun autre match n'a suivi.

## 0.29.1

### Corrections

- **Tes overlays s'affichent tous dans OBS, même quand tu en as beaucoup.** OBS
  n'arrivait à charger que 6 overlays StreamKit à la fois, toutes scènes
  confondues : au-delà, les nouveaux restaient vides, alors qu'ils s'affichaient
  très bien dans ton navigateur. Il n'y a plus de limite. Après la mise à jour,
  clique une fois sur **Actualiser** sous chaque source restée vide.

## 0.29.0

### Nouveautés

- **Soirée Clubs, pour tes soirées Clubs sur EA FC 27.** Un nouveau module qui
  suit ton club : un **bandeau** avec les victoires, les nuls, les défaites et la
  série de la soirée ; une **carte de fin de match** qui apparaît toute seule
  après chaque match, avec le score puis la note, les buts et les passes
  décisives de chaque joueur du club ; et un **tableau de fin de soirée** avec
  les trophées : MVP, Soulier d'or, Maître passeur et Le mur.
- Rien à connecter : écris le nom de ton club dans le module, StreamKit le
  retrouve chez EA. Chaque match arrive quelques minutes après le coup de
  sifflet final, le temps qu'EA le publie. Seul ton club est affiché : de
  l'équipe adverse, juste son nom à côté du score.
- Les overlays prennent la couleur du maillot de ton club, et **Afficher un
  exemple** remplit les trois sources pour les placer dans OBS.

## 0.28.2

### Nouveautés

- Rien qui change à l'écran : cette version prépare un traitement plus rapide
  des bugs que tu envoies avec **🐞 Signaler un bug**.

## 0.28.1

### Corrections

- **Random Car : les images des voitures s'affichent de nouveau dans la
  machine à sous.** Chez certains, la roue tournait avec des cases vides.
  StreamKit demande maintenant à OBS des images fraîches à chaque chargement,
  au lieu de celles qu'il a pu garder en mémoire.
- Si une image ne peut vraiment pas s'afficher, une petite voiture 🚗 prend sa
  place : plus de case vide à l'antenne. Et le problème est noté dans ton
  journal, donc visible dans « Signaler un bug ».

## 0.28.0

### Nouveautés

- **Signaler un bug sans sortir de StreamKit.** Un bouton en haut de la
  fenêtre : tu choisis le module concerné, tu racontes ce qui s'est passé, et tu
  colles ta capture d'écran directement dans la fenêtre (Win+Maj+S, puis
  Ctrl+V). Ton journal du jour et l'état de tes modules partent avec ton
  message — plus besoin d'aller chercher un fichier dans tes dossiers.
- **Tu vois ce qui part avant d'envoyer**, et tes mots de passe et jetons de
  connexion sont masqués. Tu récupères une référence (`SK-1A2B`) pour qu'on
  retrouve ton rapport quand on t'en reparle.
- Si le rapport ne peut pas partir (pas de connexion), il est enregistré sur ton
  PC et StreamKit te propose d'ouvrir le dossier pour l'envoyer à la main.
- **Tu sais enfin ce que chaque mise à jour apporte.** Quand une version sort,
  StreamKit l'annonce avec la liste de ce qui change ; et au redémarrage, il te
  montre ce qu'il vient d'installer.
