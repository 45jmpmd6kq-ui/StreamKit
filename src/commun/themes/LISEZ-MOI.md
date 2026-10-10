# Thèmes d'overlay

Un thème habille **tous** les overlays du streamer d'un coup. Il se choisit dans
le dashboard, page **Personnalisation**. Le catalogue est dans `src/core/themes.js`.

## Mécanique

Le serveur pose sur chaque overlay (voir `poserTheme` dans `src/core/serveur.js`) :

- l'attribut `data-sk-theme="<id>"` sur `<html>` ;
- la feuille `/commun/themes/<id>.css`, en fin de `<head>`, après le `<style>` de l'overlay ;
- `/commun/theme.js`, qui remplace la feuille à chaud quand le streamer change de thème.

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

## Polices

Dans `polices/`, sous-ensemble latin (Google Fonts, licence SIL Open Font License 1.1) :
Inter, Oxanium, Exo 2, Press Start 2P, VT323. Rien n'est chargé depuis internet en live.

## Ajouter un thème

1. `src/commun/themes/<id>.css` : les jetons, puis les trois classes ;
2. une entrée dans `THEMES` de `src/core/themes.js` ;
3. vérifier `/apercu-theme/<id>` et quelques overlays en `?demo=1`.
