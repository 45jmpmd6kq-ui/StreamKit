# StreamKit

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
npm run dev        # noyau seul, sans Electron (http://127.0.0.1:4455)
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
  dashboard/            l'interface (aucune dépendance, aucun build)
  modules/
    exemple/            module de référence — voir MODULES.md
    musique/            bot musique Spotify + clips (portage de la V2)
    roue-rl/            roue des voitures Rocket League (portage)
    valorant/           bandeau de session Valorant (réécriture Python -> Node)
```

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

## Publier une mise à jour

```bash
npm version patch          # ou minor / major
npm run dist               # -> livraison\StreamKit Setup <version>.exe
git push && git push --tags
```

Puis créer la release GitHub sur le tag `v<version>` et y joindre **tout le
contenu de `livraison\`** : l'installeur, `latest.yml` et le `.blockmap`.
`latest.yml` est ce que lit `electron-updater` pour savoir qu'une version
existe ; le `.blockmap` lui permet de ne télécharger que les octets modifiés.
Sans eux, les streamers ne verront jamais la mise à jour.

 fait tout d'un coup — build, création de la release, envoi des
trois fichiers — mais demande un  dans l'environnement (portée
 sur ce seul dépôt suffit).

⚠️ Une variable d'environnement définie pendant que l'application tourne n'est
pas vue par le processus en cours : il faut relancer, ou la relire depuis le
registre utilisateur.

Chez le streamer : un bouton « Mettre à jour » apparaît dans la fenêtre. Un
clic, StreamKit télécharge, se remplace et redémarre — Electron sait remplacer
une application en cours d'exécution, contrairement au lancement Node qui
imposait un `.bat` externe.

Côté streamer, rien à saisir : le dépôt est déclaré dans `build.publish`.

**Le dépôt doit être public.** L'updater lit les releases sans s'authentifier ;
en privé il faudrait distribuer un jeton GitHub à chaque streamer. Le code ne
contient aucun secret : `config.json` et `tokens.json` vivent dans `%APPDATA%`
et sont ignorés par git.

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
- [x] Module de référence `exemple` (sert aussi de banc d'essai)
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
- [ ] Migrer RL-Tracker et RL-Challenge

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
