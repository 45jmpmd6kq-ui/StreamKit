# StreamKit — guide d'installation

StreamKit rassemble des outils pour ton live dans une seule application Windows :
musique demandée par les viewers, clips au chat, prédictions et sondages Twitch en
direct à l'écran, annonce des pubs, voiture au hasard, compteur de victoires et moments forts sur Rocket League, bandeau
de session Valorant, suivi de session et moments forts League of Legends. Tout tourne **sur ton PC** : pas de compte
à créer chez nous, pas de serveur, et tes accès restent chez toi.

Compte une vingtaine de minutes la première fois. Ensuite, StreamKit se met à
jour tout seul.

---

## Avant de commencer

Tu n'as pas besoin de tout : seulement de ce qui correspond aux modules que tu
veux utiliser.

| Pour…                              | Il te faut                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Tous les modules                   | Windows 10 ou 11, et OBS Studio pour afficher les overlays                 |
| Clips, Bot Musique, Random Car, Prédictions, Sondages, Annonce de pub | Ton compte Twitch, avec la **double authentification activée** (Twitch l'exige pour créer une application) |
| Bot Musique, Random Car, Prédictions, Sondages, Annonce de pub | Le statut **Affilié ou Partenaire** Twitch (points de chaîne, prédictions, sondages et pubs leur sont réservés) |
| Bot Musique                        | **Spotify Premium**, et Spotify ouvert sur un appareil pendant le live     |
| Clips                              | Rien de plus — mais on ne peut clipper que **pendant un live**             |
| Overlay W/L (Valorant)             | Valorant installé sur le même PC                                           |
| Compteur de session (Rocket League) | Rocket League installé sur le même PC (Epic ou Steam). **Pas de BakkesMod** : le module passe par l'API officielle du jeu, compatible anti-triche |
| Moments forts (Rocket League) | La même API que le compteur de session, à activer une fois (bouton dans le module **Compteur de session**, même s'il reste éteint). Rien sur Twitch |
| Suivi de session (League of Legends) | League of Legends installé sur le même PC. Rien à connecter : le module lit le client du jeu, sans clé Riot ni compte à relier |
| Moments forts (League of Legends) | League of Legends installé sur le même PC. Twitch seulement pour les messages dans le chat et les clips (un clip ne se crée que **pendant un live**) |

---

## 1. Installer

1. Ouvre la page des versions :
   **https://github.com/45jmpmd6kq-ui/StreamKit/releases/latest**
2. Dans la partie **Assets**, télécharge **uniquement** `StreamKit-Setup-x.y.z.exe`.
   Les autres fichiers (`latest.yml`, `.blockmap`, `Source code`) ne te servent
   à rien : ils sont là pour les mises à jour automatiques et pour le code.
3. Lance le fichier téléchargé.

**Windows va probablement afficher « Windows a protégé votre ordinateur ».**
C'est normal : l'installeur n'est pas signé (un certificat coûte plusieurs
centaines d'euros par an). Clique sur **Informations complémentaires**, puis sur
**Exécuter quand même**.

L'installation se fait en un clic, sans question, et StreamKit s'ouvre tout
seul. Tu trouveras aussi un raccourci sur le bureau et dans le menu Démarrer.

> **Fermer la fenêtre ne quitte pas StreamKit.** Il continue de tourner près de
> l'horloge (flèche ^ en bas à droite de l'écran). Clic droit sur l'icône :
> **Ouvrir le dashboard** ou **Quitter StreamKit**.

---

## 2. Connecter Twitch

Dans StreamKit, clique sur **Connecteurs** (à gauche), puis sur la carte
**Twitch** pour la déplier. Tout se fait depuis cette carte.

**Côté Twitch :**

1. Clique sur **Ouvrir la console développeur** et connecte-toi.
2. **Nom** : `StreamKit`. Si Twitch dit que le nom est déjà pris, ajoute ton
   pseudo : `StreamKit-tonpseudo`.
3. **URL de redirection OAuth** : dans StreamKit, clique sur **Copier** à côté
   de l'adresse de retour, et colle-la. Au caractère près : c'est la cause n°1
   des échecs.
4. **Catégorie** : `Chat Bot`.
5. Si Twitch demande le **type de client**, laisse **Confidentiel**.
6. Valide. Ouvre ensuite l'application (**Gérer**), copie l'**ID client**, puis
   clique sur **Nouveau secret** et copie le **secret client**.

**Côté StreamKit :**

7. Remplis **Nom de ta chaîne** (tel qu'il apparaît dans `twitch.tv/ton-pseudo`),
   **ID client** et **Secret client**.
8. Clique sur **Enregistrer les identifiants**, puis sur **Connecter**.
9. Une page Twitch s'ouvre dans ton navigateur : **Autoriser**. Tu dois voir
   « Autorisation réussie ». Tu peux fermer cette page.

La carte Twitch passe au vert : **chat et EventSub connectés**.

---

## 3. Connecter Spotify (Bot Musique uniquement)

Dans **Connecteurs**, déplie la carte **Spotify**.

1. Clique sur **Ouvrir la console développeur**. Connecte-toi avec **le compte
   Spotify Premium qui joue la musique**.
2. **Create app** : nom et description libres.
3. **Redirect URI** : dans StreamKit, clique sur **Copier** et colle l'adresse.
   Elle commence par `http://127.0.0.1` — c'est voulu, Spotify refuse
   `localhost`.
4. Coche **Web API**, enregistre, puis ouvre les réglages de l'application et
   copie le **Client ID**. **Pas besoin de secret** pour Spotify.
5. Dans StreamKit, colle l'**ID client**, clique sur **Enregistrer les
   identifiants** puis sur **Connecter**, et accepte sur la page Spotify.

---

## 4. Activer tes modules

Les modules sont listés à gauche. Clique sur un module, puis sur
**l'interrupteur à droite de son titre** pour l'allumer. Modifie ses réglages si
tu veux, puis clique sur **Enregistrer** en bas.

- **Bot Musique** et **Random Car** créent **eux-mêmes** leur récompense de
  points de chaîne, avec le nom et le coût indiqués dans leurs réglages. Tu n'as
  rien à créer sur Twitch. Pour changer le nom, le coût ou le délai, fais-le
  dans StreamKit puis **Enregistrer** : la récompense est mise à jour sur Twitch
  dans la foulée. Une modification faite directement sur Twitch serait remplacée
  au prochain démarrage. Si tu avais déjà créé à la main une récompense du même
  nom, supprime-la sur Twitch : StreamKit ne peut piloter que les récompenses
  qu'il a créées lui-même, et le module te le signale.
- **Bot Musique** : active **Afficher le morceau en cours** pour que l'overlay
  « Liste » montre aussi ce qui tourne sur Spotify (pochette, titre, avancement),
  au-dessus des demandes des viewers. Le bloc grandit quand la file se remplit et
  se replie quand elle se vide. Rien à changer dans OBS : c'est la même source.
  Quand la musique est en pause (ou Spotify fermé), tout le bloc disparaît, et
  il revient en entier dès que la musique reprend. **Taille du bloc** : compacte
  (par défaut, 3 demandes affichées au plus) ou normale (grande pochette, temps
  écoulé, vignettes). **Opacité du fond** : baisse-la pour voir le jeu à travers
  les annonces et la liste (0 = plus de fond du tout).
  Après une mise à jour de StreamKit, **actualise la source dans OBS** (clic droit
  → Propriétés → « Actualiser le cache de la page actuelle ») : une source déjà
  ouverte garde l'ancien affichage.
- **Random Car** : dans **Interfaces**, ouvre **Mes voitures** et coche les
  voitures que tu possèdes. Le tirage se fait uniquement parmi elles. **Sans
  voiture cochée, rien ne s'affiche** : chaque utilisation est remboursée. La
  **Vue d'ensemble** le signale, et indique sinon le coût réel de la récompense
  sur Twitch et le nombre de voitures en jeu. La machine à sous est invisible
  entre deux tirages : pour la placer, ajoute `?demo=1` à l'adresse (un tirage
  toutes les 14 secondes), ou clique **Lancer un tirage de test**.
- **Clips** : par défaut, seuls tes modérateurs peuvent taper `!clip`. Ce qui
  suit la commande devient le titre du clip : `!clip pentakill`.
- **Prédictions** : rien à créer. Lance tes prédictions depuis Twitch comme
  d'habitude : un scoreboard apparaît tout seul dans OBS. Quand les votes
  ferment, il reste 15 secondes puis s'efface pendant la partie, et revient tout
  seul avec le résultat (ou l'annulation). Les deux durées se règlent dans le
  module. **Si ta chaîne était déjà connectée avant**, reconnecte-la
  (**Connecteurs** → **Twitch** → **Connecter**) : ce module demande un droit de
  plus. Le bouton **Simuler une prédiction** joue un exemple complet (votes,
  fermeture, résultat) dans l'overlay, sans rien envoyer à Twitch.
- **Sondages** : rien à créer. Lance tes sondages depuis Twitch comme
  d'habitude : le scoreboard apparaît tout seul, suit les votes, affiche le
  résultat 15 secondes (réglable), puis disparaît. Un sondage supprimé du chat
  avant la fin disparaît aussitôt de l'écran. **Si ta chaîne était déjà
  connectée avant**, reconnecte-la : ce module demande un droit de plus.
  **Simuler un sondage** joue un exemple complet dans l'overlay.
- **Annonce de pub** : rien à régler pour démarrer. Une minute avant chaque pub
  automatique, un bandeau annonce « Pause pub dans 0:45 » et un message part dans
  le chat ; pendant la pub, le bandeau affiche le temps restant. Une pub lancée à
  la main n'est pas connue à l'avance : elle s'affiche dès son début. Le délai,
  les phrases et les messages du chat se changent dans le module ; chaque message
  du chat a son interrupteur pour le couper. **Si ta chaîne était déjà connectée avant**, reconnecte-la :
  ce module demande un droit de plus. **Simuler une pub** joue un exemple complet
  dans l'overlay, sans rien écrire dans le chat.
- **Overlay W/L** : rien à connecter. Lance Valorant, le bandeau se remplit tout
  seul.
- **Compteur de session** (Rocket League) : l'API de stats du jeu est livrée
  **éteinte**. Clique une fois sur **Activer l'API dans Rocket League** (StreamKit
  modifie le réglage du jeu et en garde une copie), puis **relance Rocket
  League** : le jeu ne lit ce réglage qu'au démarrage. Ensuite, chaque fin de
  partie classée met le compteur à jour. Les matchs privés, les parties hors
  ligne et les replays ne comptent jamais. **Réinitialiser la session** remet le
  compteur à zéro en début de live.
- **Moments forts** (Rocket League) : même API que le compteur de session (si ce
  n'est pas déjà fait, active-la depuis le module **Compteur de session**, puis
  relance le jeu). Deux moments, sous le score du jeu : la **game de chauffe**,
  annoncée au premier coup d'envoi de ta première partie avec ton texte, puis
  une pastille « CHAUFFE » jusqu'à la fin de cette partie ; l'**overtime**, annoncé
  dès que la prolongation commence, puis une pastille « OVERTIME » et un pouls
  rouge sur les bords de l'écran jusqu'au but en or. Chaque pastille a son
  interrupteur : éteinte, il ne reste que l'annonce (le pouls a le sien). La
  chauffe revient après 3 h sans jouer ; entre deux lives rapprochés, **Réarmer
  la game de chauffe** la relance. L'entraînement libre et les replays ne
  comptent pas. **Afficher un exemple** joue les deux (16 secondes) pour placer la
  source dans OBS.
- **Suivi de session** (League of Legends) : rien à connecter, lance le jeu.
  Deux éléments, dans la même source OBS : un **bandeau** (rang, LP gagnés sur la
  session, bilan, série) et un **tableau de bord** (courbe des LP, dernières
  parties, champions joués, meilleure partie, moyennes). Le réglage **Affichage**
  choisit ce qui apparaît : les deux (le bandeau en partie, le tableau de bord
  entre les parties), le bandeau seul, ou le tableau de bord seul. Pendant la
  sélection des champions, le tableau de bord se cache pour laisser voir les
  choix. Une partie compte dès qu'elle apparaît dans ton historique ; ses LP
  s'affichent quelques secondes plus tard, le temps que Riot les publie. Seules
  les **classées Solo/Duo** comptent par défaut (la Flexible est au choix), et
  une partie refaite (remake) ne compte jamais. **Afficher un exemple** montre le
  bandeau et le tableau de bord pendant 30 secondes, pour les placer dans OBS.
  **Réinitialiser la session** remet tout à zéro en début de live.
- **Moments forts** (League of Legends) : rien à connecter, lance une partie.
  Premier sang, double, triple et quadra kill, et ace de ton équipe s'affichent en
  **carte** sur le côté : pendant un combat, la même carte monte en grade (double,
  triple, quadra). Pentakill, dragon, Héraut ou Nashor **volé par toi**, et
  légendaire (8 kills sans mourir) passent en **annonce** au centre. Chaque moment
  se règle à part : ignoré, à l'écran, à l'écran + message dans le chat, ou à
  l'écran + message + clip (par défaut : clip pour le quadra, le penta et les
  vols). Le clip part 5 secondes après le moment, avec un titre du genre
  « Pentakill · Ahri · 23:41 », et seulement pendant un live ; un pentakill juste
  après un quadra ne donne qu'un clip. Le mode streamer du jeu ne gêne pas. Si la
  Vue d'ensemble demande de reconnecter ta chaîne, fais-le : le module a besoin
  du droit de créer des clips. **Afficher un exemple** joue une séquence complète
  (25 secondes) pour placer la source dans OBS, sans rien écrire dans le chat.

---

## 5. Ajouter les overlays dans OBS

1. Dans StreamKit, ouvre le module. Dans **Overlays OBS**, clique sur **Copier**.
2. Dans OBS : **Sources** → **+** → **Navigateur**, et colle l'adresse dans
   **URL**. Règle **Largeur** et **Hauteur** comme indiqué sous l'adresse, dans
   StreamKit. Pour la taille :
   - **Bot Musique, Random Car, Clips, Prédictions, Sondages, Compteur de session, Moments forts RL, Annonce de pub, Suivi de session LoL, Moments forts LoL** : la taille de ta scène (par exemple
     1920 × 1080). L'overlay se place tout seul dans le coin choisi dans les
     réglages du module (pour le suivi LoL, une position pour le bandeau et une
     pour le tableau de bord ; pour les moments forts, une pour les cartes et une
     pour les annonces) ;
   - **Overlay W/L** : 900 × 70, puis déplace la source où tu veux.
3. Pour le placer sans attendre un vrai événement, ajoute `?demo=1` à la fin de
   l'adresse (collé, sans espace). Tant que l'exemple est à l'écran, change la
   position dans les réglages du module et clique **Enregistrer** : l'exemple se
   déplace aussitôt. **Retire** `?demo=1` une fois que c'est calé. Pour le suivi de
   session LoL et les moments forts (LoL et Rocket League), le bouton **Afficher
   un exemple** du module montre aussi un exemple, sans toucher à l'adresse.

Pour vérifier : dans **Vue d'ensemble**, la carte **OBS** compte les sources
connectées.

---

## 6. Au quotidien

- **Avant le live**, jette un œil à la **Vue d'ensemble** : une carte verte, ça
  marche ; orange ou rouge, lis le texte en dessous, il dit quoi faire.
- **Démarrer avec Windows** : roue dentée en haut à droite → **Réglages de
  StreamKit** → **Démarrer avec Windows**. StreamKit se lance alors tout seul,
  près de l'horloge, sans ouvrir de fenêtre.
- **Mises à jour** : quand une version sort, un bouton **Mettre à jour → x.y.z**
  apparaît en haut. Clique dessus puis **Mettre à jour maintenant** : StreamKit
  redémarre, et tes réglages et comptes sont conservés. **Pas pendant un
  live** : attends la fin.

---

## 7. En cas de souci

**Une carte est rouge ou orange dans la Vue d'ensemble.**
Lis le texte gris sous la carte : il indique la marche à suivre.

**« Autorisation échouée » après avoir cliqué sur Connecter.**
Presque toujours l'adresse de retour. Recopie-la avec le bouton **Copier** dans
l'application Twitch ou Spotify, sans espace ni caractère en trop.

**Le Bot Musique ne met rien dans la file.**
Vérifie que Spotify est ouvert **et** a joué quelque chose récemment sur un
appareil, et que le compte est bien Premium.

**Un clip est refusé.**
Tu n'es pas en live, ou le délai entre deux clips n'est pas écoulé.

**Le compteur Rocket League ne bouge pas.**
Regarde la carte **Rocket League** de la Vue d'ensemble, elle dit quoi faire :
« API du jeu désactivée » (clique sur **Activer l'API**, puis relance le jeu),
« jeu lancé, mais l'API ne répond pas » (relance le jeu), ou « joueur non
identifié » (renseigne ton pseudo en jeu tout en bas des réglages du module).
Seules les parties **classées** comptent par défaut : c'est réglable.

**Le suivi League of Legends ne bouge pas.**
Regarde la carte **League of Legends** de la Vue d'ensemble : « client fermé »
(lance le jeu), ou « League of Legends introuvable » (indique le dossier du jeu
tout en bas des réglages du module, par exemple `C:\Riot Games\League of Legends`).
Vérifie aussi **Parties comptées** : une Flexible ne compte pas si le module suit
la Solo/Duo. Rien à l'écran quand le client est fermé : c'est voulu.

**Les moments forts LoL n'apparaissent pas.**
Clique sur **Afficher un exemple** dans le module. S'il s'affiche, la source OBS
est bonne : regarde alors, pendant une partie, la carte **Partie de League of
Legends** de la Vue d'ensemble, qui doit dire « en partie » avec ton champion.
Seuls **tes** moments comptent (et l'ace de ton équipe), et un moment réglé sur
« Ignoré » ne s'affiche pas. Pas de clip : tu n'étais pas en live, ou ta chaîne
doit être reconnectée.

**Random Car : la machine à sous n'apparaît pas.**
Clique sur **Lancer un tirage de test** dans le module. Si le message ajoute
« aucune source OBS n'affiche la machine à sous », c'est la source OBS : recopie
son adresse, à la taille de ta scène. Si la machine s'affiche au test mais pas
quand un viewer utilise la récompense, regarde la ligne **Random Car** de la
carte **Rocket League**, dans la Vue d'ensemble (aucune voiture cochée ?), puis
le journal : chaque utilisation y laisse une ligne, et un souci de connexion
avec Twitch aussi.

**Le coût de la récompense n'est pas celui de StreamKit.**
Clique sur **Enregistrer** dans le module : StreamKit remet le nom, le coût et
le délai de ses réglages sur Twitch. Si le module affiche « existe déjà sur ta
chaîne, mais StreamKit ne l'a pas créée », supprime cette récompense sur Twitch
(ou donne un autre nom dans le module), puis **Enregistrer**.

**Le scoreboard de sondage n'apparaît pas.**
Clique sur **Simuler un sondage** dans le module. S'il s'affiche, la source OBS
est bonne : regarde alors la carte **Sondages** de la Vue d'ensemble (droit
manquant : reconnecte ta chaîne), puis le journal. Un sondage lancé y laisse la
ligne « Sondage lancé » ; sans elle, Twitch n'a rien transmis, et le journal dit
pourquoi (abonnement refusé, ou horloge du PC en avance : remets Windows à
l'heure). Si rien ne s'affiche à la simulation, c'est la source OBS : recopie son
adresse.

**Le scoreboard de prédiction n'apparaît pas.**
Clique sur **Simuler une prédiction** dans le module. S'il s'affiche,
l'overlay est bien placé : regarde alors la carte **Prédictions** de la Vue
d'ensemble — droit manquant (reconnecte ta chaîne) ou chaîne ni Affiliée ni
Partenaire. Si rien ne s'affiche, c'est la source OBS : recopie son adresse.

**Tu dois demander de l'aide.**
Envoie le journal : en bas de la fenêtre, dans la barre **Journal**, clique sur
**⤓** (Télécharger le journal du jour), et envoie le fichier. Tes secrets et tes
jetons de connexion y sont masqués.

**Tu changes de PC ou de compte Windows.**
Réinstalle StreamKit et reconnecte Twitch et Spotify : tes accès sont chiffrés
avec une clé liée à ta session Windows, ils ne se recopient pas d'un PC à
l'autre.

**Tes données.**
Tes réglages et tes accès sont dans `%APPDATA%\StreamKit`. Désinstaller
StreamKit les conserve. N'envoie jamais le fichier `tokens.json` à personne.
