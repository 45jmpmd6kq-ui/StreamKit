# Thèmes d'overlay

> **En suspens depuis le 18/10/2026** (choix du développeur) : `disponible()` dans
> `src/core/themes.js` renvoie faux, la page Personnalisation est floutée avec la
> mention « à venir », et le serveur ne pose aucun thème. `STREAMKIT_THEMES=1` la rouvre
> en développement (c'est ce que font les tests) ; pour la rouvrir à tous, faire renvoyer
> `true` à `disponible()`. Les styles d'overlay des modules (`style`, `aVenir: true`) sont
> suspendus de la même façon.

Un thème habille les overlays **Twitch** du streamer (modules de `categorie: 'twitch'` :
Bot Musique, Sondages, Prédictions, Pub, Clips). Il se choisit dans le dashboard, page
**Personnalisation**. Les overlays des jeux ne se personnalisent pas : le serveur ne leur
pose rien. Le catalogue et le réglage sont dans `src/core/themes.js`.

## Mécanique

Le serveur pose sur chaque overlay Twitch (voir `poserTheme` dans `src/core/serveur.js`) :

- sur `<html>` : `data-sk-theme="<id>"` et les couleurs du Néon en variables
  (`style="--sk-neon-1: …"`) ;
- la feuille `/commun/themes/<id>.css`, en fin de `<head>`, après le `<style>` de l'overlay ;
- `/commun/theme.js`, qui suit les réglages à chaud (canal `themes`) : il remplace la feuille
  quand le thème change, et les couleurs quand le Néon change.

`?theme=<id>` fige une source sur un thème (`data-sk-fige`) ; elle suit encore les couleurs
du Néon. `?apercu=1` : la vignette de la page Personnalisation — l'overlay peut alors être
encadré par le dashboard, et `flux.js` ne se branche pas (la vignette ne compte pas comme
une source OBS).

## Aperçus de la page Personnalisation

`src/dashboard/apercu-twitch.html` (route `/apercu-twitch?theme=<id>`) assemble les cinq
overlays Twitch en démo. La carte du Néon l'affiche en direct (elle suit les couleurs
choisies) ; les autres cartes montrent une image, `src/dashboard/apercus/twitch-<id>.jpg`,
refaite par `npm run captures` — cinq scènes vivantes feraient vingt-cinq overlays ouverts
à la fois.

Une feuille de thème définit des **jetons** `--sk-*` sur `:root`. Chaque overlay les
lit en gardant **ses** valeurs d'origine en repli :

```css
--fond: rgba(var(--sk-fond-rvb, 8, 13, 22), var(--sk-fond-alpha, 0.92));
--texte: rgb(var(--sk-encre, 242, 244, 247));
--typo: var(--sk-typo, Bahnschrift, "Segoe UI", system-ui, sans-serif);
```

`standard.css` ne définit **aucun** jeton : chaque overlay garde exactement son
rendu d'avant les thèmes.

## Jetons

| Jeton | Contenu | Rôle |
|---|---|---|
| `--sk-fond-rvb` | `r, g, b` | fond des panneaux |
| `--sk-fond-alpha` | nombre | opacité des panneaux |
| `--sk-encre` | `r, g, b` | texte ; aussi filets et voiles : `rgba(var(--sk-encre), 0.1)` |
| `--sk-attenue` | couleur | texte secondaire |
| `--sk-accent`, `--sk-accent-rvb` | couleur, `r, g, b` | accent principal (barres, égaliseur, liserés) |
| `--sk-accent2`, `--sk-accent2-rvb` | couleur, `r, g, b` | accent secondaire (pseudos, numéros) |
| `--sk-sur-accent2` | couleur | texte posé sur l'accent secondaire |
| `--sk-or` | couleur | mise en valeur (record, meilleure partie, chiffres forts) |
| `--sk-victoire`, `--sk-defaite` | couleur | **thème clair seulement** : vert et rouge plus foncés, même sens |
| `--sk-typo` | familles | police du texte |
| `--sk-typo-titre` | familles | police des gros titres |

## Classes communes

À poser dans le balisage des overlays. Le thème les habille, avec `!important` : ce sont
les seules règles d'un thème qui passent devant celles de l'overlay.

| Classe | Sur quoi | Ce que le thème y change |
|---|---|---|
| `sk-panneau` | chaque cadre visible | arrondi, ombre, contour, coupe des coins, flou |
| `sk-titre` | les gros titres (titre du morceau, « TRIPLE KILL »…) | police, casse, espacement, lueur |
| `sk-remplissage` | la partie remplie d'une barre de progression | dégradé, lueur |
| `sk-silhouette` | l'enveloppe d'un overlay à formes biseautées (`clip-path`) : pub, prédictions, sondages | une ombre `filter: drop-shadow` qui épouse la forme (lueur néon, ombre pixel…) |

Sur un élément découpé par `clip-path`, ne pas mettre `sk-panneau` : le thème remplacerait la
découpe, qui fait le dessin de l'overlay. `sk-silhouette` va sur son parent.

Un thème ne touche **ni** à la taille, **ni** à la position, **ni** à l'opacité des éléments :
les animations des overlays restent les leurs. Il ne pose pas de vrai `border` (ça décalerait
la mise en page d'un pixel) : les contours passent par `box-shadow`.

## Ce qu'un thème ne remplace jamais

Les couleurs qui portent un sens : victoire et défaite, couleurs de rang, couleur du club FC,
équipes bleu et rose des prédictions, températures de Rocket League, rouge Valorant.

## Couleurs du Néon

Le streamer choisit deux couleurs (une palette proposée, ou deux sélecteurs libres).
`core/themes.js` (`variablesNeon`) en tire `--sk-neon-1`, `--sk-neon-2`, leurs triplets
`-rvb`, le fond, l'encre et le texte atténué ; `neon.css` les lit avec la palette d'origine
(magenta, cyan) en repli. Les autres thèmes ne lisent pas ces variables : elles sont posées
sur tous les overlays.

## Polices

Dans `polices/`, sous-ensemble latin (Google Fonts, licence SIL Open Font License 1.1) :
Inter, Oxanium, Exo 2, VT323. Rien n'est chargé depuis internet en live.

## Ajouter un thème

1. `src/commun/themes/<id>.css` : les jetons, puis les trois classes ;
2. une entrée dans `THEMES` de `src/core/themes.js` ;
3. `npm run captures` pour son image d'aperçu, puis vérifier la page Personnalisation et
   quelques overlays Twitch en `?demo=1&theme=<id>`.
