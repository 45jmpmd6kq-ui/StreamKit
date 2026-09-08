// Schema de configuration d'un module.
//
// C'est LA piece qui rend l'ajout d'un module bon marche : un module DECRIT ses
// reglages, et le dashboard fabrique l'ecran correspondant tout seul. On n'ecrit
// jamais un ecran de reglages a la main. Ajouter une option a un module = une
// ligne dans son schema, rien d'autre.
//
// Un champ :
//   { cle, type, label, aide?, defaut?, groupe?, ...contraintes }
//
// Types reconnus (le dashboard sait dessiner chacun) :
//   texte       une ligne                      (max?)
//   commande    une commande de chat           (vide = commande desactivee)
//   texteLong   plusieurs lignes
//   secret      affiche en points, jamais renvoye en clair au dashboard
//   nombre      (min?, max?, pas?)
//   bool        interrupteur
//   choix       (options: [{ valeur, label }])
//   couleur     selecteur de couleur (#rrggbb)
//   liste       liste de textes (blocklist, pseudos exemptes...)

export const TYPES = new Set([
  'texte',
  'commande',
  'texteLong',
  'secret',
  'nombre',
  'bool',
  'choix',
  'couleur',
  'liste',
]);

export function validerSchema(champs = []) {
  const erreurs = [];
  const vues = new Set();
  for (const [i, c] of champs.entries()) {
    if (!c.cle) erreurs.push('champ #' + i + ' : "cle" manquante');
    else if (vues.has(c.cle)) erreurs.push('cle en double : ' + c.cle);
    else vues.add(c.cle);

    if (!TYPES.has(c.type)) erreurs.push('champ ' + c.cle + ' : type inconnu (' + c.type + ')');
    if (c.type === 'choix' && !Array.isArray(c.options)) {
      erreurs.push('champ ' + c.cle + ' : "options" est obligatoire pour un choix');
    }
  }
  return erreurs;
}

function defautDeType(type) {
  switch (type) {
    case 'bool':
      return false;
    case 'nombre':
      return 0;
    case 'liste':
      return [];
    case 'couleur':
      return '#ffffff';
    default:
      return '';
  }
}

export function valeursParDefaut(champs = []) {
  const out = {};
  for (const c of champs) out[c.cle] = c.defaut ?? defautDeType(c.type);
  return out;
}

// Nettoie ce qui arrive du dashboard : on ne fait jamais confiance a la forme
// recue, meme quand elle vient de notre propre page.
export function normaliser(champs, brut = {}) {
  const out = {};
  const erreurs = [];

  for (const c of champs) {
    const v = brut[c.cle];
    const nom = c.label ?? c.cle;

    if (v === undefined || v === null || v === '') {
      // Un champ vide reprend son defaut, SAUF les textes ou le vide a un sens :
      // une commande vide veut dire "commande desactivee", c'est volontaire.
      const videAutorise = c.type === 'texte' || c.type === 'commande' || c.type === 'texteLong' || c.type === 'secret';
      out[c.cle] = videAutorise && v === '' ? '' : c.defaut ?? defautDeType(c.type);
      continue;
    }

    switch (c.type) {
      case 'bool':
        out[c.cle] = v === true || v === 'true' || v === 1 || v === '1';
        break;

      case 'nombre': {
        const n = Number(v);
        if (Number.isNaN(n)) {
          erreurs.push(nom + ' : un nombre est attendu');
          break;
        }
        out[c.cle] = Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, n));
        break;
      }

      case 'choix': {
        const ok = c.options.some((o) => String(o.valeur) === String(v));
        if (!ok) {
          erreurs.push(nom + ' : valeur hors liste');
          break;
        }
        out[c.cle] = v;
        break;
      }

      case 'couleur': {
        const s = String(v).trim();
        if (!/^#[0-9a-f]{6}$/i.test(s)) {
          erreurs.push(nom + ' : une couleur au format #rrggbb est attendue');
          break;
        }
        out[c.cle] = s.toLowerCase();
        break;
      }

      case 'liste': {
        const arr = Array.isArray(v) ? v : String(v).split('\n');
        out[c.cle] = arr.map((s) => String(s).trim()).filter(Boolean);
        break;
      }

      case 'commande': {
        let s = String(v).trim().toLowerCase();
        if (s && !s.startsWith('!')) s = '!' + s; // "skip" saisi -> "!skip"
        if (/\s/.test(s)) {
          erreurs.push(nom + " : une commande ne contient pas d'espace");
          break;
        }
        out[c.cle] = s;
        break;
      }

      default:
        out[c.cle] = String(v).slice(0, c.max ?? 2000);
    }
  }

  return { valeurs: out, erreurs };
}

// Le dashboard ne recoit jamais un secret en clair : il recoit un temoin qui dit
// seulement "rempli" ou "vide". S'il nous le renvoie tel quel, on garde
// l'ancienne valeur -- sinon reouvrir la page et sauver effacerait les cles.
export const TEMOIN_SECRET = '__inchange__';

export function masquerSecrets(champs, valeurs) {
  const out = { ...valeurs };
  for (const c of champs) {
    if (c.type === 'secret') out[c.cle] = valeurs[c.cle] ? TEMOIN_SECRET : '';
  }
  return out;
}

export function reinjecterSecrets(champs, nouvelles, anciennes = {}) {
  const out = { ...nouvelles };
  for (const c of champs) {
    if (c.type === 'secret' && out[c.cle] === TEMOIN_SECRET) out[c.cle] = anciennes[c.cle] ?? '';
  }
  return out;
}

// Migration des reglages quand un module change de schema.
// Le module fournit { 2: (r) => r, 3: (r) => r } : on applique en cascade les
// migrations manquantes. Sans ca, la 3e mise a jour casserait les reglages de
// tout le monde -- exactement ce que StreamKit existe pour eviter.
export function migrer(reglages, depuis, vers, migrations = {}) {
  let r = { ...reglages };
  for (let v = (depuis || 0) + 1; v <= vers; v++) {
    const fn = migrations[v];
    if (typeof fn === 'function') r = fn(r) ?? r;
  }
  return r;
}
