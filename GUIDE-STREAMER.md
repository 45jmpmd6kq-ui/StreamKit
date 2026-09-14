# StreamKit — guide d'installation

StreamKit rassemble des outils pour ton live dans une seule application Windows :
musique demandée par les viewers, clips au chat, prédictions et sondages Twitch en
direct à l'écran, annonce des pubs, voiture au hasard et compteur de victoires sur Rocket League, bandeau
de session Valorant. Tout tourne **sur ton PC** : pas de compte
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
  rien à créer sur Twitch.
- **Random Car** : dans **Interfaces**, ouvre **Mes voitures** et coche les
  voitures que tu possèdes. Le tirage se fait uniquement parmi elles.
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
  résultat 15 secondes (réglable), puis disparaît. **Si ta chaîne était déjà
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

---

## 5. Ajouter les overlays dans OBS

1. Dans StreamKit, ouvre le module. Dans **Overlays OBS**, clique sur **Copier**.
2. Dans OBS : **Sources** → **+** → **Navigateur**, et colle l'adresse dans
   **URL**. Pour la taille :
   - **Bot Musique, Random Car, Clips, Prédictions, Sondages, Compteur de session, Annonce de pub** : la taille de ta scène (par exemple
     1920 × 1080). L'overlay se place tout seul dans le coin choisi dans les
     réglages du module ;
   - **Overlay W/L** : 900 × 70, puis déplace la source où tu veux.
3. Pour le placer sans attendre un vrai événement, ajoute `?demo=1` à la fin de
   l'adresse. **Retire-le** une fois que c'est calé.

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
