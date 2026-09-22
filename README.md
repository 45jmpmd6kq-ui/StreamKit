# StreamKit

> **Tu es streamer et tu veux installer StreamKit ?** Tout est dans
> **[GUIDE-STREAMER.md](GUIDE-STREAMER.md)**. La suite de cette page s'adresse
> aux développeurs.

Socle commun des outils de stream. Un seul service local, des modules
activables, et **un canal de mise à jour** — c'est la raison d'être du projet :
corriger un bug une fois, et que tous les streamers l'aient sans rien
réinstaller ni reconfigurer.

Remplace à terme les projets séparés `Bot-Musique-Twitch-V2`, `Roue-Voitures-RL`,
`RL-Tracker`, `Valorant-Overlay`, `RL-Challenge-1v1`, qui réimplémentaient
chacun le même socle (config, .bat, serveur web local, overlay OBS).

## Ce que c'est, ce que ce n'est pas

- **100 % local.** Aucun serveur, aucun hébergement, aucun compte à gérer.
  Chaque streamer crée sa propre application Twitch (assistant intégré) : il n'y
  a donc aucun secret partagé à protéger. Bonus : le quota Spotify des 25
  utilisateurs ne s'applique jamais, chacun ayant sa propre app.
- **Pas un bot Twitch généraliste.** Firebot, Streamer.bot et Mix It Up font déjà
  ça, mieux et gratuitement. L'angle de StreamKit, c'est la **couche jeu** :
  Rocket League, Valorant, LoL — ce qu'aucun d'eux ne sait faire.
- **Le service n'écoute que sur les boucles locales** (`127.0.0.1` et `::1`).
  Rien n'est exposé au réseau, jamais de `0.0.0.0`.

## Démarrer

```bash
npm install
npm start          # application Electron
npm run dev        # noyau seul, sans Electron (http://127.0.0.1:47455)
npm test           # la suite de tests (~1 s, aucune dépendance)
```

Ou double-clic sur `lancer-dev.bat`.

> Sous PowerShell, `npm` peut echouer avec « l'execution de scripts est
> desactivee sur ce systeme » : c'est le wrapper `npm.ps1` que bloque la
> strategie d'execution. Utiliser `npm.cmd` a la place — inutile de modifier la
> strategie du poste. Et `&&` n'existe pas en PowerShell 5.1 : enchainer avec `;`.

Le streamer, lui, reçoit un installeur `.exe` : ni Node.js, ni ligne de commande,
ni fenêtre noire — une icône près de l’horloge.

## Architecture

```
src/
  main.js               processus Electron : fenêtre, icône, mises à jour
  index.js              lancement en ligne de commande (dev)
  noyau.js              tout ce qui tourne, commun aux deux entrées
  core/
    paths.js            code vs données : la séparation qui rend l'update sûr
    journal.js          journal central (console + dashboard + fichier)
    store.js            config / tokens / état, écriture atomique
    schema.js           schéma de config -> formulaire généré + migrations
    registre.js         découverte, validation, cycle de vie des modules
    twitch.js           UNE connexion chat + UN EventSub partagés
    auth.js             OAuth Twitch (l'app appartient au streamer)
    diffusion.js        SSE (overlays + flux du journal)
    serveur.js          serveur HTTP unique : dashboard, API, overlays
    maj.js              mise à jour depuis les releases GitHub
    connecteurs.js      services externes : identifiants + autorisation
    compteurs.js        compteurs d usage (session + total)
  dashboard/            l'interface (aucune dépendance, aucun build)
  modules/
    exemple/            module de diagnostic (masqué du rail)
    musique/            bot musique Spotify (portage de la V2)
    clips/              commande !clip, extraite du bot musique
    predictions/        carte OBS de la prédiction Twitch en cours
    pub/                annonce des pubs Twitch : bandeau avant/pendant + chat
    sondages/           scoreboard OBS du sondage Twitch en cours
    roue-rl/            roue des voitures Rocket League (portage)
    rl-session/         compteur V/D Rocket League (API de stats officielle + Launch.log)
    valorant/           bandeau de session Valorant (réécriture Python -> Node)
    lol-session/        suivi de session LoL : bandeau et tableau de bord, deux sources (API locale du client)
    lol-moments/        moments forts LoL : cartes et annonces, chat, clips (API de la partie, port 2999)

scripts/                icône de l'app, emblèmes de rang LoL — rien ne part chez le streamer
GUIDE-STREAMER.md       LA documentation du streamer : prérequis, installation, dépannage
```

> Il n'y a plus de `LISEZ-MOI.txt` : l'installeur n'embarque que `src/**` et
> `package.json` (`build.files`), donc ce fichier ne quittait jamais le dépôt.
> La documentation du streamer est **un seul fichier**, `GUIDE-STREAMER.md`,
> lisible sur GitHub par un simple lien. Le deck PowerPoint qui la précédait
> (et ses captures) a été retiré en 0.15.2 : resté figé en 0.10.1, il
> contredisait l'application. Deux documentations finissent toujours par
> diverger ; une seule, tenue à jour avec le code, ne le peut pas.

### La règle qui structure tout

**Le code et les données ne vivent jamais au même endroit.**

| | où |
|---|---|
| code | le dossier d'installation — *remplacé* à chaque mise à jour |
| données | `%APPDATA%\StreamKit\` — *jamais touché* |

`config.json`, `tokens.json`, `etat/`, `journaux/` sont dans les données. Sans
cette séparation, chaque mise à jour effacerait les réglages du streamer, et le
projet perdrait sa seule raison d'exister.

`STREAMKIT_DATA` permet de forcer un autre dossier (tests, plusieurs profils).

## Écrire un module

Voir **[MODULES.md](MODULES.md)**. En résumé : un dossier, un `module.js` qui
exporte un manifeste, et le socle fournit Twitch, les réglages, le journal, les
overlays et la persistance.

Le manifeste décrit les réglages ; **le dashboard fabrique le formulaire**. On
n'écrit jamais d'écran de réglages à la main — c'est ce qui rend le 7ᵉ module
aussi bon marché que le 2ᵉ.

## Tests

```bash
npm test
```

`node --test` intégré, aucune dépendance, une seconde. Les tests vivent dans
`tests\` et pas dans `src\` : l'installeur n'embarque que `src\**`, ils ne
partent donc pas chez le streamer.

Ce n'est pas une suite exhaustive, et ce n'est pas le but. Elle tient les
endroits où une régression se paie cher :

| Fichier | Ce qu'il protège |
|---|---|
| `serveur.test.js` | Le garde-fou de l'API locale — trois failles réellement exploitables autrefois : CSRF depuis un onglet ouvert, rebinding DNS, script injecté dans la page de retour OAuth. |
| `store.test.js` | Les deux promesses du stockage : une mise à jour ne perd jamais les réglages, un fichier abîmé n'empêche jamais de démarrer. |
| `schema.test.js` | La frontière de confiance des réglages, dont l'aller-retour qui doit laisser les secrets intacts. |
| `registre.test.js` | Le contrat des modules livrés : manifestes valides, overlays qui existent, boutons qui font quelque chose, aucun secret vers le dashboard. |
| `maj.test.js` | La comparaison de versions — celle qui décide si une release est proposée ou non. |

Un test qui touche au disque pose `STREAMKIT_DATA` sur un dossier jetable
**avant** d'importer le code : `paths.js` lit cette variable au chargement, pas
à l'appel. Sans cette précaution, la suite écrirait dans le vrai
`%APPDATA%\StreamKit` — donc sur la configuration et les jetons de qui la
lance. C'est le rôle de `tests\aide.js`.

La CI (`.github\workflows\ci.yml`) rejoue tout ça sous Windows à chaque
poussée, et reconstruit l'installeur sur `main`. Elle ne publie jamais :
`--publish never` est explicite, une release ne part qu'à la main.

## Tester sur son PC avant de publier

Le streamer ne reçoit pas une branche : il reçoit la release GitHub marquée
« Latest », que son application consulte. Une branche seule ne le protège donc
de rien — c'est la **publication** qui doit attendre le test.

| Branche | Contenu |
|---|---|
| `main` | Exactement ce qu'ont les streamers : la dernière version publiée. |
| `test` | Le travail en cours. Tout développement commence ici. |

```bash
git switch test
# développement, npm test, npm run lint, commits
npm version minor --no-git-tag-version    # ou patch : le numéro qui SERA publié, sans tag
git commit -m 0.23.0 package.json package-lock.json
npm run dist                               # livraison\StreamKit-Setup-0.23.0.exe, rien n'est publié
```

Sur le PC de test : quitter StreamKit (icône près de l'horloge ▸ Quitter), puis
lancer l'installeur. Il remplace l'application et garde les réglages, qui vivent
dans `%APPDATA%\StreamKit`. Un bug ? On corrige sur `test`, on relance
`npm run dist` — même numéro tant que rien n'est publié — et on réinstalle.

Une fois validé :

```bash
git switch main
git merge --ff-only test                   # main rattrape test, sans commit de fusion
git tag -a v0.23.0 -m 0.23.0               # sur le commit TESTÉ
git push origin main --follow-tags
# puis « Publier une mise à jour » ci-dessous, depuis main
git switch test
```

- **On ne publie que le commit testé.** `npm run publier` reconstruit
  l'installeur : parti d'un autre commit, il livrerait ce que personne n'a
  essayé.
- **Pas de numéro de pré-version** (`0.23.0-beta.1`). `comparer()` le juge égal
  à `0.23.0` : le PC de test ne verrait jamais le bouton pour passer à la
  version publiée. Le numéro définitif sert pendant tout le test.
- **Correctif urgent** (bug vu en plein live) : il peut partir de `main`
  directement, en renonçant au test. Ensuite `git switch test` puis
  `git merge main`, sinon la prochaine fusion `--ff-only` sera refusée.

## Publier une mise à jour

```bash
# sur main, au commit testé, tagué et poussé (section précédente)
# créer la release en BROUILLON, vide, sur le tag (voir le troisième piège)
npm run publier            # build + envoi des fichiers dans ce brouillon
# vérifier les 3 fichiers, puis publier le brouillon
```

`npm run publier` fait tout d'un coup. Il lui faut un jeton dans la variable
d'environnement `GH_TOKEN` — un jeton *fine-grained* limité à ce dépôt avec la
seule permission **Contents : Read and write** suffit (sur GitHub, les releases
et leurs fichiers relèvent de « Contents »).

Sans jeton, `npm run dist` construit dans `livraison\` et il reste à créer la
release à la main en y joignant **l'installeur, `latest.yml` et le `.blockmap`**.
`latest.yml` est ce que lit `electron-updater` pour savoir qu'une version
existe ; le `.blockmap` lui permet de ne télécharger que les octets modifiés.
Sans eux, les streamers ne verront jamais la mise à jour.

Quatre pièges rencontrés :

- **Une variable d'environnement définie pendant que l'application tourne n'est
  pas vue du processus en cours.** Il faut relancer, ou la relire depuis le
  registre utilisateur (`[Environment]::GetEnvironmentVariable('GH_TOKEN','User')`).
- **`electron-builder` crée la release en brouillon par défaut.** Un brouillon
  est invisible des streamers : `latest.yml` n'est pas joignable, donc aucune
  mise à jour ne part. D'où `releaseType: "release"` dans `build.publish`.
- **`npm run publier` seul crée DEUX releases sur le même tag** (0.13.0, 0.14.1).
  Deux envois courent en parallèle, chacun constate l'absence de release et la
  crée ; GitHub ne résout alors plus les téléchargements et tout répond 404 —
  aucun streamer ne reçoit la mise à jour. Parade, validée en 0.15.0 et 0.15.1 :
  créer d'abord la release **en brouillon**, vide, sur le tag (API GitHub,
  `POST /repos/<dépôt>/releases` avec `"draft": true`). `electron-builder`
  réutilise un brouillon du même tag : les deux envois y déposent leurs
  fichiers. Il ne le publie pas lui-même : vérifier `latest.yml`, l'installeur
  et le `.blockmap`, puis passer `"draft": false`. Bonus : la version n'est
  jamais visible sans ses fichiers.

- **L'envoi d'un fichier peut se bloquer, ou finir en 500.** Vécu en 0.24.0 :
  `npm run publier` a déposé le `.blockmap`, puis plus rien pendant vingt minutes
  — connexion ouverte, aucun octet qui circule (les compteurs d’E/S du processus
  node le montrent tout de suite). Il faut couper et reprendre l’envoi à la main,
  avec deux précautions. `npm run publier` **reconstruit** l’installeur : le
  `latest.yml` laissé par `npm run dist` ne lui correspond plus, il faut le
  régénérer sur l’exe réellement présent dans `livraison` (sha512 en base64 +
  taille), sinon chaque streamer se verra refuser la mise à jour. Et l’API a
  répondu « 500 » deux fois avant d’accepter l’installeur : réessayer, en
  supprimant le fichier incomplet entre deux tentatives. Pour vérifier sans
  retélécharger 113 Mo, chaque fichier d’une release porte un champ `digest`
  (sha256) à comparer au `Get-FileHash` local.

  **Ce n'est presque jamais toi.** Revecu en 0.24.2, mesure de bout en bout
  cette fois : cinq 500 d'affilee avec curl, un 500 avec .NET (PowerShell), et
  une connexion restee ouverte a 0,13 Mo sans plus rien transferer. Le client n'y
  est pour rien, le protocole non plus -- `--http1.1` avait coincide une fois
  avec un envoi qui passait, ce n'etait qu'une coincidence.

  Le test qui tranche en trente secondes, sur le brouillon lui-meme :

  ```bash
  head -c 200000 livraison/StreamKit-Setup-0.24.2.exe > essai.bin
  curl ... "?name=essai-200ko.bin"     # 201 : l'API repond
  head -c 10000000 livraison/StreamKit-Setup-0.24.2.exe > essai.bin
  curl ... "?name=essai-10mo.bin"      # 500 « Error saving asset »
  ```

  200 Ko passe et 10 Mo non : c'est chez eux, et leur page d'etat peut afficher
  « All Systems Operational » pendant ce temps-la. Supprimer les fichiers
  d'essai du brouillon ensuite.

  Pour les tentatives, `--max-time` et rien d'autre : `--speed-limit` /
  `--speed-time` ne se declenchent PAS sur une connexion ouverte qui ne
  transfere rien du tout, curl n'y voit pas un transfert lent. Et supprimer le
  fichier incomplet entre deux essais, sinon le nom reste pris.

  **Ce qui a fini par marcher : l'interface web.** Ouvrir le brouillon sur
  github.com, y glisser l'installeur -- un autre chemin d'envoi, qui passe quand
  l'API refuse. La verification des empreintes et le passage en visible se font
  ensuite normalement. Enfin, si les trois fichiers laisses par `npm run dist`
  sont coherents entre eux -- sha512 et taille du `latest.yml` verifies contre
  l'exe present -- les envoyer tels quels evite la reconstruction, donc le piege
  du `latest.yml` decale ci-dessus.

Chez le streamer : un bouton « Mettre à jour » apparaît dans la fenêtre. Un
clic, StreamKit télécharge, se remplace et redémarre — Electron sait remplacer
une application en cours d'exécution, contrairement au lancement Node qui
imposait un `.bat` externe.

Côté streamer, rien à saisir : le dépôt est déclaré dans `build.publish`.

**Le dépôt doit être public.** L'updater lit les releases sans s'authentifier ;
en privé il faudrait distribuer un jeton GitHub à chaque streamer. Le code ne
contient aucun secret : `config.json` et `tokens.json` vivent dans `%APPDATA%`
et sont ignorés par git. L'adresse du salon des rapports de bug non plus : voir
ci-dessous.

### Rapports de bug : le salon Discord

Le bouton **🐞 Signaler un bug** des streamers poste dans un salon Discord
privé, par un webhook (`core/signalement.js`). À mettre en place une fois :

1. Sur le serveur Discord, un salon privé — de préférence un salon **Forum** :
   chaque rapport y ouvre son propre fil, titré « module — description ·
   pseudo », où l'on peut répondre et que l'on peut clore. Un salon texte marche
   aussi : StreamKit le détecte au premier envoi.
2. Paramètres du salon ▸ Intégrations ▸ Webhooks ▸ Nouveau webhook ▸ Copier
   l'URL du webhook.
3. La ranger dans une variable d'environnement utilisateur, comme `GH_TOKEN` :

   ```powershell
   [Environment]::SetEnvironmentVariable('STREAMKIT_WEBHOOK_BUGS', '<URL du webhook>', 'User')
   ```

**Jamais dans le dépôt** : il est public, et des robots parcourent GitHub à la
recherche de webhooks Discord pour les inonder ou les supprimer.
`scripts/cible-signalement.mjs` la glisse, brouillée, dans
`src/core/signalement-cible.json` (ignoré par git) juste avant chaque
construction. Il relit aussi le registre : une variable posée après l'ouverture
du terminal est vue quand même.

- `npm run dist` sans adresse : l'installeur se construit, et les rapports sont
  seulement enregistrés sur le PC (`%APPDATA%\StreamKit\signalements`), le
  dashboard le disant d'emblée ;
- `npm run publier` sans adresse : **refusé**. Les streamers recevraient une
  version incapable d'envoyer quoi que ce soit.

L'adresse reste lisible par qui décortique l'installeur : il pourrait poster
dans le salon ou supprimer le webhook, pas lire ce qui s'y trouve. Si ça
arrive : nouveau webhook, nouvelle variable, une version publiée. Les rapports
faits entre-temps ne sont pas perdus, ils attendent sur les PC.

### Un correctif d'update ne se voit qu'une version plus tard

Le code qui pilote une mise à jour est **toujours celui de la version qu'on
quitte**. Un correctif touchant à la façon dont une mise à jour est présentée ou
exécutée ne peut donc jamais être constaté sur sa propre livraison : il faut une
version de plus.

Vécu sur la série 0.2.x — installeur silencieux, fenêtre d'annonce, relance
automatique, conversion des notes : chacun n'a été visible qu'au cycle suivant.
Le dire d'emblée évite de croire à une régression.

### Construire l'installeur : le pré-requis Windows

`electron-builder` extrait un paquet contenant des liens symboliques macOS
(`libcrypto.dylib`…). Sous Windows, créer un lien symbolique demande le
privilège `SeCreateSymbolicLinkPrivilege`, que n'a pas un compte standard :

```
ERROR: Cannot create symbolic link : Le client ne dispose pas d'un privilège nécessaire.
```

Il faut donc **activer le mode développeur** une fois — Paramètres ▸
Confidentialité et sécurité ▸ Pour les développeurs ▸ Mode développeur — ou
lancer `npm run dist` depuis un terminal administrateur. Pré-remplir le cache à
la main ne marche pas : `app-builder` réextrait dans un dossier temporaire
aléatoire à chaque exécution.

Cela ne concerne que la machine qui **construit** l'installeur. Les streamers ne
sont pas concernés.

### Changer un schéma de config sans rien casser

Incrémenter `config.version` **et** fournir la migration correspondante dans
`migrations`. Elles s'appliquent en cascade au chargement. Oublier ça, c'est
casser les réglages de tout le monde à la 3ᵉ mise à jour.

## État d'avancement

- [x] Socle : journal, registre, schéma + migrations, Twitch partagé, serveur,
      diffusion SSE, updater
- [x] Dashboard : modules, formulaire généré (9 types de champs), overlays,
      journal en tiroir (filtres, direct, pause, téléchargement)
- [x] Assistant de connexion Twitch
- [x] Module `exemple` — banc d'essai du socle, masqué du rail depuis 0.9.0
- [x] **Bot musique migré** depuis Bot-Musique-Twitch-V2, sans perte de fonction
- [x] Script de packaging
- [x] Dépôt GitHub + release `v0.1.0` avec le zip joint
- [x] **Mise à jour vérifiée de bout en bout** — une install en 0.0.9 détecte la
      release, télécharge, se remplace (`node_modules` compris) et **conserve
      tous les réglages du streamer**. C'est la thèse du projet, elle tient.
- [x] **Passage à Electron** : application installable, icône près de l'horloge,
      fenêtre refermable sans rien couper, plus de Node.js à installer, plus de
      fenêtre noire. Noyau extrait dans `noyau.js`, partagé par les deux entrées.
- [x] Installeur construit et **application empaquetée vérifiée** : modules
      découverts, dashboard affiché, updater qui interroge bien GitHub
- [x] Release Electron publiée et **détection de mise à jour vérifiée en réel** :
      une installation 0.1.0 voit la 0.1.2 et propose le bouton
- [x] **Chaîne de mise à jour validée en réel** : installation silencieuse,
      fenêtre d'annonce, relance automatique, réglages conservés
- [ ] Recette du bot musique avec de vrais identifiants Twitch + Spotify
- [x] **Roue RL migrée** : 2e module porté — a fait émerger les pages sur mesure
      et le partage d assets entre page et overlay
- [x] **Bandeau Valorant migré** : 1re réécriture Python -> Node, validée sur
      des données Riot réelles (rang, RR, 16 matchs classés)
- [x] **Vue d ensemble** : etat de toutes les connexions (Twitch, OBS, Spotify,
      Riot) sur un ecran d accueil, alimente par un hook sante() des modules
- [ ] Migrer RL-Tracker et RL-Challenge
- [x] **Suivi de session LoL** : bandeau en partie, tableau de bord entre les
      parties. API locale du client (lockfile), LP par difference de rangs, noms
      et icones de champions via Data Dragon. Verifie de bout en bout contre un
      faux client ; reste a valider sur le vrai client
- [x] **Suivi de session LoL en deux sources OBS** (demande du user, 19/09) :
      bandeau 840 x 150 et tableau de bord 920 x 620, places librement dans OBS
      (une page, deux adresses) ; reglage « Bandeau » (en partie / tout le temps)
      a la place de « Affichage » et des deux positions (migration v2).
      L'ancienne source unique reste servie, masquee du dashboard (`masque`)
- [ ] Suivi de session LoL valide sur une vraie soiree de classees
- [x] **Moments forts LoL** : premier sang, double a quadra kill et ace en carte
      (la carte du combat monte en grade), pentakill, objectif vole et legendaire
      en annonce ; message et clip au choix par moment. API de la partie en cours
      (Live Client Data, port 2999), mode streamer compris. Verifie contre un faux
      jeu ; reste a valider en vraie partie
- [ ] Moments forts LoL valides en vraie partie (noms des evenements, clip en live)
- [x] **Moments forts RL** : game de chauffe (premier coup d'envoi apres 3 h sans
      jouer, texte du streamer) et overtime (`Game.bOvertime`), une annonce puis
      une pastille, pouls rouge sur les bords en prolongation. Une seule connexion
      a l'API du jeu, partagee avec le compteur de session (`abonner` dans
      `rl-session/flux.js`). Verifie contre un faux jeu ; reste a valider en vraie
      partie
- [ ] Moments forts RL valides en vraie partie (coup d'envoi, overtime,
      entrainement libre ignore)
- [x] **Recompenses tenues a jour** (`core/recompenses.js`) : chaque demarrage
      d'un module aligne sa recompense sur ses reglages (nom, cout, delai...), son
      identifiant est retenu pour la renommer, et une recompense du meme nom faite
      a la main est signalee en clair. Random Car : ligne dans la Vue d'ensemble
      (cout reel, voitures cochees), tirage sans source OBS signale, demo en boucle
- [x] **Abonnements EventSub partages** (`core/abonnements.js`) : un par
      evenement, garde toute la connexion ; un module qui redemarre ne change que
      son gestionnaire (effacer puis reposer perdait les evenements, prouve avec
      le vrai Twurple). Refus, revocations et evenements jetes par Twurple
      (horloge du PC en avance, abonnement inconnu) arrivent au journal
- [x] **Reconnexion automatique a Twitch** (`core/reconnexion.js`) : Twitch
      injoignable au lancement (reseau pas encore la, demarrage avec Windows) est
      retente seul (10 s, 20 s, 30 s, puis chaque minute), et les modules Twitch
      demarrent des qu'il repond. Une autorisation refusee ou une chaine
      introuvable ne se retentent pas ; le dashboard dit pourquoi et quoi faire.
      Verifie au banc contre le vrai Twitch (reseau coupe, puis faux identifiants)
- [ ] Random Car valide en live : cout aligne apres Enregistrer, machine a
      l'ecran sur une vraie utilisation
- [x] **Signaler un bug** (`core/signalement.js`) : bouton dans la barre du
      haut, module de l'ecran preselectionne, partie concernee (overlay, page,
      bouton), captures collees ou glissees. Journal, etat du module, sources
      OBS, abonnements EventSub, `diagnostic()` des modules et etat de StreamKit
      partent dans un salon Discord (un fil par rapport en Forum), secrets
      remplaces avant l'envoi ; rapport enregistre sur le PC si l'envoi echoue.
      Verifie contre un faux Discord (dashboard reel, vrai fetch)
- [ ] Premier rapport reel recu dans le salon Discord

## Pièges rencontrés (à ne pas refaire)

- **`new EventSource("flux")` dans un overlay** résout vers
  `/overlay/<module>/flux`, pas `/overlay/<module>/<vue>/flux` : l'URL n'a pas de
  slash final, donc le dernier segment est remplacé. L'overlay reste vide sans
  erreur visible dans OBS. Construire l'adresse depuis `location.pathname`.
- **Concaténer les morceaux du corps HTTP dans une chaîne** (`brut += c`) casse
  tout caractère accentué tombant à cheval sur deux paquets TCP. Accumuler des
  `Buffer`, décoder une seule fois.
- **Écouter sur `127.0.0.1` seulement ne suffit pas.** Sous Windows, `localhost`
  se résout très souvent en IPv6 d'abord — et Twitch comme Spotify imposent
  `localhost` dans l'URL de redirection OAuth (ils refusent une IP en http). Le
  retour d'autorisation tombait donc dans le vide. `ecouter()` ouvre les deux
  boucles locales, `127.0.0.1` **et** `::1`. Rien n'est exposé au réseau pour
  autant : jamais de `0.0.0.0`.
- **Dans les URL d'overlay, on donne `127.0.0.1`** et pas `localhost` : le
  navigateur interne d'OBS a le même travers, et laisse alors la source vide.
- **Un module ne doit pas garder son état au niveau du fichier.** StreamKit
  redémarre les modules à chaud (changement de réglages) ; avec un état global,
  l'ancienne file d'attente survit et les morceaux fantômes reviennent. D'où
  `creerFile()` en fabrique plutôt que l'ancien `queue.js` à état de module.
- **Un réglage écrit dans les fichiers d'un jeu ne tient pas tout seul.** Rocket
  League est livré avec son API de stats éteinte (`PacketSendRate=0`) ; le bouton
  de StreamKit la rallumait une fois pour toutes… sauf que le lanceur remet
  parfois `DefaultStatsAPI.ini` dans son état d'origine juste avant de démarrer
  le jeu, et que le jeu régénère alors la copie utilisateur à partir de ce
  fichier (le tampon `[IniVersion]` de la copie porte la **date** du fichier du
  jeu). Résultat sur le PC de Sylvain : six semaines sans une seule connexion au
  jeu, pendant que StreamKit affichait « déjà active » et « jeu fermé » (vécu le
  20/09/2026, moments forts RL). Deux leçons : **surveiller** ce qu'on a écrit
  tant que le module tourne, et chercher où le programme visé **déclare ce qu'il
  a vraiment lu** — ici `StatsAPI: PacketSendRate=(0.0000)` dans son `Launch.log`,
  qui tranche entre « ce qu'on a demandé » et « ce qui s'applique ».
- **Une récompense de points de chaîne n'était écrite qu'à sa création.** Allumer
  Random Car la créait aussitôt au coût par défaut : le coût réglé ensuite dans
  StreamKit ne partait jamais sur Twitch (vécu le 19/09/2026). Tout réglage qui
  décrit un objet côté Twitch doit être réappliqué à chaque démarrage du module.
- **Twurple ne signale un abonnement EventSub refusé que par
  `onSubscriptionCreateFailure`.** Sans écouteur, le module paraît démarré et ne
  reçoit rien, sans une ligne au journal.
- **Effacer puis reposer aussitôt le même abonnement EventSub perd ses
  événements.** Twurple range un abonnement sous un nom logique (type +
  condition) ; quand Twitch confirme l'effacement de l'ancien APRÈS la création
  du nouveau, Twurple retire le nouveau de ses tables et jette ce que Twitch
  envoie (« Notification from unknown event received », dans sa console
  seulement). C'est ce que faisait chaque redémarrage de module jusqu'à la
  0.25.0 : sondages et Random Car muets après un Enregistrer (19/09/2026).
  Reproduit avec le vrai Twurple dans `tests/abonnements-twurple.test.js`.
  D'où les abonnements partagés de `core/abonnements.js`, et le journal de
  Twurple branché sur le nôtre.
- **Un seul échec de Twitch au lancement coupait Twitch pour toute la session.**
  Avec le démarrage automatique, StreamKit part souvent avant le réseau : les
  modules Twitch restaient « en attente » jusqu'au lancement suivant, et rien
  ne réessayait. Tout appel réseau du démarrage doit prévoir son nouvel essai.
