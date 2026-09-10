// Configuration ESLint (flat config).
//
// Ce que StreamKit attend d'un linter, concretement : reperer une variable
// morte, un `await` oublie devant un appel asynchrone, et surtout un global
// implicite dans un overlay — un `x = 1` sans `const` y passe inapercu jusqu'a
// ce que deux overlays se marchent dessus dans la meme source OBS.
//
// Trois familles de fichiers, trois environnements :
//   src/**, tests/**, scripts/**   Node (le socle et les modules)
//   src/dashboard/**               navigateur (le renderer n'a pas Node)
//   **/*.html                      navigateur aussi : toute la logique des
//                                  overlays vit dans un <script> inline, c'est
//                                  eslint-plugin-html qui va l'y chercher.
//
// La mise en forme n'est PAS le travail d'ESLint ici : eslint-config-prettier
// eteint toutes les regles de style, Prettier s'en charge seul.

import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';
import prettier from 'eslint-config-prettier';

export default [
  {
    // Rien de tout cela n'est a nous : produits de build, dependances, paquets.
    ignores: ['node_modules/**', 'livraison/**', 'doc/**'],
  },

  js.configs.recommended,

  // --- Le socle et les modules : Node ---------------------------------------
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Un catch vide est un choix assume et frequent ici (« deja ferme »,
      // « rien de critique ») : le commentaire porte l'intention, la variable
      // d'erreur non utilisee n'apporte rien.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],

      // Le piege que le projet a deja paye : un appel asynchrone sans await
      // dans une boucle de module, dont le rejet part dans le vide.
      'require-atomic-updates': 'off', // trop de faux positifs sur les fabriques
      'no-promise-executor-return': 'error',

      // Deux erreurs silencieuses qui coutent cher en direct.
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },

  // --- Le dashboard : navigateur, sans Node --------------------------------
  {
    files: ['src/dashboard/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  // --- Les overlays et les pages de module : <script> inline ---------------
  {
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script', // un <script> sans type="module"
      globals: globals.browser,
    },
    rules: {
      // Sans `const`, une affectation cree un global sur window : deux overlays
      // ouverts dans la meme source OBS se piétinent alors en silence.
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // --- Les tests -----------------------------------------------------------
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Toujours en dernier : eteint tout ce que Prettier gere deja.
  prettier,
];
