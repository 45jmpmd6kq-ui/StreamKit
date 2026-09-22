# Nouveautés de StreamKit

Ce que chaque version change, **écrit pour les streamers** — pas des messages de
commit. Ce texte est ce qu'ils lisent dans la fenêtre de mise à jour, dans la
release GitHub, et dans « Quoi de neuf » au redémarrage.

Une section `## <version>` par version publiée, avec au choix `### Nouveautés`
et `### Corrections`. Une ligne par point, à la deuxième personne, en disant ce
que ça change pour lui — jamais le nom d'un fichier ni d'une fonction.

`npm run publier` refuse de partir si la version publiée n'a pas sa section
ici, et un test le vérifie aussi à chaque `npm test`.

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
