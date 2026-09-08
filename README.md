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
- **Le service n'écoute que sur `127.0.0.1`.** Rien n'est exposé au réseau.

## Démarrer

```bash
npm install
npm start          # http://127.0.0.1:4455
```

Pour le streamer : `start.bat` (installe les dépendances au premier lancement et
ouvre le navigateur).

## Architecture

```
src/
  index.js              orchestration + contexte fourni aux modules
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
npm run release            # -> livraison\StreamKit-v<version>.zip
git push && git push --tags
```

Puis créer la release GitHub sur le tag `v<version>` et y **joindre le zip**.
Il embarque `node_modules` : les streamers ne lancent jamais `npm install`, et
l'updater remplace le dossier tel quel.

Chez le streamer : un bouton « Mettre à jour » apparaît dans le dashboard. Un
clic, StreamKit télécharge, se ferme, se remplace et redémarre.

Le remplacement passe par un `.bat` externe : Windows ne permet pas à un
programme de réécrire ses propres fichiers pendant qu'il tourne.

Prérequis côté streamer : le dépôt (`utilisateur/projet`) renseigné dans ⚙️ du
dashboard. **Les releases doivent être lisibles sans authentification** — donc
dépôt public, sinon il faudrait distribuer un jeton GitHub à chaque streamer.

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
- [x] Script de packaging (`npm run release`)
- [ ] Créer le dépôt GitHub distant
- [ ] Publier une release et vérifier la mise à jour de bout en bout ← **le test qui valide le projet**
- [ ] Recette du bot musique avec de vrais identifiants Twitch + Spotify
- [ ] Migrer Roue RL, RL-Tracker, Valorant, RL-Challenge

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
