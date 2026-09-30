# Nouveautés de StreamKit

Ce que chaque version change, **écrit pour les streamers** — pas des messages de
commit. Ce texte est ce qu'ils lisent dans la fenêtre de mise à jour, dans la
release GitHub, et dans « Quoi de neuf » au redémarrage.

Une section `## <version>` par version publiée, avec au choix `### Nouveautés`
et `### Corrections`. Une ligne par point, à la deuxième personne, en disant ce
que ça change pour lui — jamais le nom d'un fichier ni d'une fonction.

`npm run publier` refuse de partir si la version publiée n'a pas sa section
ici, et un test le vérifie aussi à chaque `npm test`.

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
