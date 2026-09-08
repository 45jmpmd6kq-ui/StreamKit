# Écrire un module StreamKit

Un module = un dossier dans `src/modules/<id>/` avec un `module.js` qui exporte
un manifeste. Le socle s'occupe du reste : connexion Twitch, écran de réglages,
journal, overlays, persistance, mises à jour.

Le modèle de référence est `src/modules/exemple/` — copie-le et vide ce qui ne
sert pas.

```
src/modules/mon-module/
  module.js          le manifeste (obligatoire)
  overlay/           les pages servies dans OBS (optionnel)
    vue.html
  assets/            images, sons... (optionnel)
```

## Le manifeste

```js
export default {
  id: 'mon-module',        // DOIT être le nom du dossier
  nom: 'Mon module',       // affiché dans le dashboard
  description: '...',
  icone: '🎮',
  categorie: 'rocket-league',   // regroupement dans le rail — voir plus bas

  scopes: ['chat:read'],   // droits Twitch nécessaires

  config: { version: 1, champs: [ /* voir plus bas */ ] },
  migrations: {},
  overlays: [ { chemin: 'vue', nom: 'Ma vue', fichier: 'vue.html' } ],
  pages:    [ { chemin: 'reglage', nom: 'Mon écran', fichier: 'reglage.html' } ],

  libellesActions: { tester: 'Tester' },   // ← ce qui devient un bouton
  actions: {
    async tester(ctx) { /* bouton dans le dashboard */ },
    async interne(ctx, corps) { /* appelé par une page, pas de bouton */ },
  },

  async demarrer(ctx) {
    // ... brancher ce qu'il faut
    return { async arreter() { /* libérer ce qui ne l'est pas tout seul */ } };
  },
};
```

## Les catégories

Le dashboard groupe les modules par catégorie, en sections repliables. Les
catégories connues sont dans `core/categories.js` :

| `categorie` | rail |
|---|---|
| `twitch` | 🟣 Twitch |
| `rocket-league` | 🚀 Rocket League |
| `lol` | ⚔️ League of Legends |
| `valorant` | 🔫 Valorant |
| `outils` | 🧰 Outils *(fourre-tout, toujours en dernier)* |

**Une catégorie est un regroupement d'affichage, pas une hiérarchie de code.**
Un module reste un dossier plat avec un identifiant unique, et c'est délibéré :

- les adresses d'overlay restent courtes — `/overlay/roue-rl/roue` plutôt que
  `/overlay/rocket-league/roue-rl/roue`. C'est ce que le streamer colle dans
  OBS ;
- un module peut changer de catégorie sans casser ses réglages ni les adresses
  déjà placées dans OBS ;
- le contrat ne gagne pas un cran d'imbrication.

Catégorie absente ou inconnue : le module atterrit dans **Outils** avec un
avertissement dans le journal. Une faute de frappe ne doit jamais le rendre
invisible.

Pour ajouter une catégorie, une ligne dans `CATEGORIES` (`id`, `label`, `icone`,
`ordre`). Rien d'autre à toucher.

> À venir quand ce sera nécessaire : des **réglages partagés au niveau de la
> catégorie**. Le tracker RL et le compteur 1v1 liront tous les deux
> `Launch.log` — leur demander deux fois le même chemin serait absurde. La
> structure de `categories.js` est prête à l'accueillir.

## Les réglages : jamais de formulaire à la main

Tu décris les champs, **le dashboard fabrique l'écran**. Ajouter une option =
une ligne dans `config.champs`, rien d'autre.

| type | rendu | contraintes |
|---|---|---|
| `texte` | une ligne | `max` |
| `commande` | commande de chat (le `!` est ajouté tout seul) | vide = désactivée |
| `texteLong` | plusieurs lignes | |
| `secret` | points, jamais renvoyé en clair au navigateur | |
| `nombre` | champ numérique borné | `min`, `max`, `pas` |
| `bool` | interrupteur | |
| `choix` | liste déroulante | `options: [{valeur, label}]` |
| `couleur` | sélecteur `#rrggbb` | |
| `liste` | une valeur par ligne | |

Options communes : `cle`, `label`, `aide`, `defaut`, `groupe`, `requis`.

Un champ `requis: true` encore vide empêche le module de démarrer : il passe en
état **incomplet** et le dashboard dit précisément quoi remplir — plutôt qu'un
plantage obscur en plein live.

### Changer un schéma sans casser les réglages des streamers

Incrémente `config.version` et fournis la migration correspondante :

```js
config: { version: 2, champs: [ /* ... */ ] },
migrations: {
  2: (r) => ({ ...r, rythme: r.intervalle }),  // renommage
},
```

Les migrations manquantes s'appliquent en cascade au chargement. **C'est ce qui
permet de publier une mise à jour sans que personne ne reconfigure quoi que ce
soit** — la raison d'être de StreamKit.

## Le contexte (`ctx`)

Seul point de contact entre un module et le reste du monde.

```js
ctx.config            // réglages, déjà migrés et complétés par leurs défauts
ctx.log               // .debug .info .ok .warn .err — étiquetés au nom du module
ctx.nom, ctx.id

ctx.twitch.api                       // client @twurple/api complet
ctx.twitch.channel / .broadcasterId
ctx.twitch.dire(msg)                 // écrire dans le chat
ctx.twitch.surMessage(fn)
ctx.twitch.surCommande('!skip', fn, { qui: 'mods' })   // 'tous'|'mods'|'streamer'
ctx.twitch.surRecompense(rewardId, fn)
ctx.twitch.statutRedemption(e, 'FULFILLED' | 'CANCELED')
ctx.twitch.assurerRecompense({ titre, cout, prompt, saisieRequise })
ctx.twitch.aLeDroit('clips:edit')

ctx.overlay.etat(vue, data)          // état mémorisé : une source OBS qui se
                                     // reconnecte le retrouve immédiatement
ctx.overlay.diffuser(vue, type, data)// notification ponctuelle
ctx.overlay.nbSources(vue)           // combien de sources OBS écoutent
ctx.overlay.url(vue)

ctx.etat.lire(defaut) / ctx.etat.sauver(v)   // mémoire persistante du module
ctx.secrets.lire(cle) / ctx.secrets.ecrire(cle, v)   // rangés dans tokens.json

ctx.minuteur.intervalle(fn, ms)      // coupés automatiquement à l'arrêt
ctx.minuteur.delai(fn, ms)
```

### Ce dont tu n'as pas à t'occuper

Les abonnements pris via `ctx.twitch.*` et les minuteurs pris via
`ctx.minuteur.*` sont **retirés automatiquement** quand le module s'arrête.
`arreter()` ne sert qu'à sauver un état ou fermer une ressource externe.

## Les overlays

Une page HTML par vue, dans `overlay/`. Elle s'abonne au flux du module :

```js
const flux = new EventSource(location.pathname.replace(/\/$/, "") + "/flux");
flux.addEventListener("etat", (e) => appliquer(JSON.parse(e.data)));
flux.addEventListener("notification", (e) => afficher(JSON.parse(e.data)));
```

⚠️ **N'écris pas `new EventSource("flux")`.** L'URL de l'overlay n'a pas de
slash final : un chemin relatif remplacerait le dernier segment et appellerait
`/overlay/<module>/flux` au lieu de `/overlay/<module>/<vue>/flux`. L'overlay
resterait désespérément vide, sans erreur visible dans OBS.

Trois règles apprises sur les projets précédents :

1. **Fond transparent** — jamais de `background` sur `<body>`.
2. **`?demo=1`** — affiche un contenu factice pour placer la source dans OBS
   sans lancer StreamKit. Le streamer place, puis retire le paramètre.
3. **`EventSource` reconnecte tout seul** : un redémarrage de StreamKit (ou une
   mise à jour) ne casse pas l'overlay en plein live.

Dans OBS : Source ▸ Navigateur ▸ `http://127.0.0.1:4455/overlay/<module>/<vue>`
(`127.0.0.1` plutôt que `localhost` : le navigateur d'OBS préfère parfois l'IPv6
et n'affiche alors rien).

## Les actions, et lesquelles deviennent des boutons

Une action est une fonction appelable en `POST /api/modules/<id>/action/<nom>`.

**Seules les actions listées dans `libellesActions` apparaissent en bouton** dans
le dashboard. Les autres restent appelables — par les pages du module — mais
invisibles.

Ce n'est pas cosmétique. La roue expose une action `enregistrer` que sa page de
sélection appelle avec la liste des voitures cochées. Si elle était un bouton,
un clic l'appellerait **sans données** et viderait la sélection du streamer.

## Les pages : quand le formulaire généré ne suffit pas

Certains modules ont besoin d'une interface que le schéma ne peut pas produire :
cocher 137 voitures dans une grille d'icônes, par exemple.

```js
pages: [{ chemin: 'voitures', nom: 'Mes voitures', fichier: 'voitures.html' }]
```

Le fichier va dans `pages/`, StreamKit le sert sous
`/module/<module>/<chemin>`, et le dashboard y met un bouton **Ouvrir**.

Une page dialogue avec son module **par ses actions**, exactement comme le
dashboard — elle n'a aucune route à elle :

```js
const r = await fetch('/api/modules/mon-module/action/enregistrer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ noms: [...] }),
});
```

**Les fichiers d'une page sont cherchés dans `pages/`, puis dans `overlay/`.**
Une page et un overlay partagent souvent les mêmes images — les 137 icônes de
voitures pèsent 1,5 Mo, on ne va pas les dupliquer pour une question de dossier.
Là aussi, construis l'adresse depuis `location.pathname` et non en relatif.

## Le journal

`ctx.log` écrit d'un coup vers la console, le dashboard (en direct) et le
fichier du jour. **Un module n'appelle jamais `console.log`** : la ligne perdrait
son étiquette et disparaîtrait du filtre par module.

Niveaux : `debug` (dashboard seulement) · `info` · `ok` · `warn` · `err`.

Écris pour le streamer, pas pour toi : « Aucun appareil Spotify actif — ouvre
Spotify et lance une musique » plutôt que « NO_ACTIVE_DEVICE ».

## Un module qui plante ne coupe pas le stream

Le socle isole chaque module : une erreur au démarrage le marque **en erreur**,
les autres continuent, et le dashboard affiche le message. En plein live, on ne
coupe jamais tout à cause d'un module.

Corollaire : ne laisse pas remonter une exception pour une erreur normale
(Spotify momentanément indisponible, message non envoyé). Journalise et continue.
