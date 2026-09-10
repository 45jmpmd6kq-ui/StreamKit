// Chiffrement des secrets au repos (safeStorage).
//
// Deux exigences opposees, et c'est tout l'interet du test :
//
//   1. les secrets ne doivent plus etre lisibles dans tokens.json ;
//   2. StreamKit ne doit JAMAIS perdre un jeton a cause du chiffrement --
//      un fichier deja en clair se lit, un coffre absent n'empeche rien de
//      demarrer, et un echec de chiffrement ecrit en clair plutot que de
//      rendre la chaine inaccessible.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const coffre = await import('../src/core/coffre.js');
const store = await import('../src/core/store.js');
const { preparerDossiers, TOKENS_PATH } = await import('../src/core/paths.js');

preparerDossiers();

// Faux safeStorage : DPAPI en carton, mais il se comporte comme le vrai --
// il rend un Buffer, et il refuse ce qu'il n'a pas chiffre lui-meme.
const MARQUE = 'DPAPI:';
const coffreFactice = {
  isEncryptionAvailable: () => true,
  encryptString: (texte) => Buffer.from(MARQUE + texte, 'utf8'),
  decryptString: (tampon) => {
    const brut = tampon.toString('utf8');
    if (!brut.startsWith(MARQUE)) throw new Error('cle inconnue sur cette machine');
    return brut.slice(MARQUE.length);
  },
};

// Ecrit tokens.json a la main, en forcant une date differente : sans ca, le
// cache memoire du store (indexe sur la mtime) resservirait l'ancien contenu.
function poserFichier(objet) {
  writeFileSync(TOKENS_PATH, JSON.stringify(objet, null, 2), 'utf8');
  const jadis = new Date(Date.now() - 60000);
  utimesSync(TOKENS_PATH, jadis, jadis);
}

const surLeDisque = () => JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));

afterEach(() => coffre.brancher(null));
after(() => nettoyer(DONNEES));

// --- Sans coffre : la ligne de commande -----------------------------------

test('sans coffre, les secrets restent en clair comme avant', () => {
  coffre.brancher(null);
  assert.equal(coffre.disponible(), false);
  assert.equal(coffre.chiffrer('mon-secret'), 'mon-secret');
  assert.equal(coffre.dechiffrer('mon-secret'), 'mon-secret');
});

test('sans coffre, un secret chiffre est rendu vide plutot que faux', () => {
  // Cas reel : « npm run dev » sur un dossier de donnees rempli par
  // l'application Electron. Mieux vaut un champ vide, qui envoie le streamer
  // se reconnecter, qu'une chaine « enc:... » passee telle quelle a Twitch.
  coffre.brancher(null);
  assert.equal(coffre.dechiffrer('enc:blabla'), '');
});

test('un coffre qui se declare indisponible est ignore', () => {
  assert.equal(coffre.brancher({ isEncryptionAvailable: () => false }), false);
  assert.equal(coffre.chiffrer('mon-secret'), 'mon-secret');
});

test('un coffre qui jette a l interrogation ne recoit rien', () => {
  assert.equal(
    coffre.brancher({
      isEncryptionAvailable: () => {
        throw new Error('boum');
      },
    }),
    false
  );
  assert.equal(coffre.disponible(), false);
});

// --- Avec coffre ----------------------------------------------------------

test('un secret chiffre porte le prefixe et se relit a l identique', () => {
  coffre.brancher(coffreFactice);

  const chiffre = coffre.chiffrer('mon-secret-twitch');
  assert.ok(chiffre.startsWith('enc:'), 'prefixe attendu : ' + chiffre);
  assert.ok(!chiffre.includes('mon-secret-twitch'), 'le secret ne doit plus etre lisible');
  assert.equal(coffre.dechiffrer(chiffre), 'mon-secret-twitch');
});

test('on ne chiffre pas deux fois la meme valeur', () => {
  coffre.brancher(coffreFactice);
  const une = coffre.chiffrer('mon-secret');
  assert.equal(coffre.chiffrer(une), une, 'un rechiffrement rendrait la valeur illisible');
});

test('une valeur vide ou non textuelle traverse sans etre touchee', () => {
  coffre.brancher(coffreFactice);
  assert.equal(coffre.chiffrer(''), '');
  assert.equal(coffre.chiffrer(undefined), undefined);
  assert.equal(coffre.chiffrer(1234), 1234);
  assert.equal(coffre.dechiffrer(null), null);
});

test('un secret venu d une autre machine est rendu vide, sans planter', () => {
  // DPAPI est lie au compte Windows : un dossier de donnees recopie depuis un
  // autre PC ne peut PAS etre dechiffre. Il faut le dire, pas s'y casser.
  coffre.brancher(coffreFactice);
  const etranger = 'enc:' + Buffer.from('AUTRE-CLE:secret', 'utf8').toString('base64');
  assert.equal(coffre.dechiffrer(etranger), '');
});

// --- Ce qui atterrit vraiment dans tokens.json ----------------------------

test('les secrets partent chiffres, le reste reste lisible', () => {
  coffre.brancher(coffreFactice);

  store.sauverTokens({
    twitchApp: { clientId: 'id-public', clientSecret: 'secret-twitch' },
    twitch: { accessToken: 'jeton-acces', refreshToken: 'jeton-refresh', scope: ['chat:read'] },
    connecteurs: { spotify: { clientId: 'id-spotify', clientSecret: 'secret-spotify', compte: 'Sylvain' } },
    modules: { valorant: { cleApi: 'cle-riot' } },
  });

  const disque = surLeDisque();

  // Chiffres : tout ce qui ouvre une porte.
  for (const valeur of [
    disque.twitchApp.clientSecret,
    disque.twitch.accessToken,
    disque.twitch.refreshToken,
    disque.connecteurs.spotify.clientSecret,
    disque.modules.valorant.cleApi,
  ]) {
    assert.ok(String(valeur).startsWith('enc:'), 'devrait etre chiffre : ' + valeur);
  }

  // Le fichier entier ne doit contenir aucun secret en clair.
  const brut = readFileSync(TOKENS_PATH, 'utf8');
  for (const secret of ['secret-twitch', 'jeton-acces', 'jeton-refresh', 'secret-spotify', 'cle-riot']) {
    assert.ok(!brut.includes(secret), 'secret lisible dans tokens.json : ' + secret);
  }

  // En clair : ce qui n'est pas un secret. Un tokens.json totalement opaque
  // serait indiagnostiquable, et l'identifiant client circule de toute facon
  // dans l'URL d'autorisation.
  assert.equal(disque.twitchApp.clientId, 'id-public');
  assert.equal(disque.connecteurs.spotify.compte, 'Sylvain');
  assert.deepEqual(disque.twitch.scope, ['chat:read']);
});

test('le reste du code continue de lire des jetons utilisables', () => {
  coffre.brancher(coffreFactice);
  store.sauverTokens({ twitch: { refreshToken: 'jeton-refresh' } });

  // Juste apres l'ecriture (cache memoire)...
  assert.equal(store.lireTokens().twitch.refreshToken, 'jeton-refresh');

  // ...et apres une relecture depuis le disque.
  const jadis = new Date(Date.now() - 60000);
  utimesSync(TOKENS_PATH, jadis, jadis);
  assert.equal(store.lireTokens().twitch.refreshToken, 'jeton-refresh');
});

test('majTokens ne rechiffre pas ce qui l est deja', () => {
  coffre.brancher(coffreFactice);
  store.sauverTokens({ twitch: { refreshToken: 'jeton-refresh' } });

  store.majTokens((t) => {
    t.twitchApp = { clientId: 'id', clientSecret: 'secret-tardif' };
  });

  assert.equal(store.lireTokens().twitch.refreshToken, 'jeton-refresh', 'le jeton existant doit survivre');
  assert.equal(store.lireTokens().twitchApp.clientSecret, 'secret-tardif');
});

// --- Migration ------------------------------------------------------------

test('un tokens.json en clair se lit sans rien changer', () => {
  // Le fichier d'un streamer qui vient d'une version anterieure.
  coffre.brancher(coffreFactice);
  poserFichier({ twitchApp: { clientId: 'id', clientSecret: 'secret-en-clair' } });

  assert.equal(store.lireTokens().twitchApp.clientSecret, 'secret-en-clair');
});

test('la migration chiffre le fichier existant, une seule fois', () => {
  coffre.brancher(coffreFactice);
  poserFichier({
    twitchApp: { clientId: 'id', clientSecret: 'secret-en-clair' },
    twitch: { refreshToken: 'refresh-en-clair' },
  });

  assert.equal(store.chiffrerSecretsAuRepos(), true, 'il y avait du clair a chiffrer');

  const brut = readFileSync(TOKENS_PATH, 'utf8');
  assert.ok(!brut.includes('secret-en-clair'));
  assert.ok(!brut.includes('refresh-en-clair'));
  assert.equal(store.lireTokens().twitch.refreshToken, 'refresh-en-clair', 'toujours lisible par le code');

  assert.equal(store.chiffrerSecretsAuRepos(), false, 'plus rien a faire au demarrage suivant');
});

test('sans coffre, la migration ne touche a rien', () => {
  coffre.brancher(null);
  poserFichier({ twitchApp: { clientId: 'id', clientSecret: 'secret-en-clair' } });

  assert.equal(store.chiffrerSecretsAuRepos(), false);
  assert.equal(surLeDisque().twitchApp.clientSecret, 'secret-en-clair', 'le fichier doit etre intact');
});

test('un fichier a moitie migre finit de se chiffrer', () => {
  // Cas d'une coupure de courant pile pendant la migration.
  coffre.brancher(coffreFactice);
  poserFichier({
    twitchApp: {
      clientId: 'id',
      clientSecret: 'enc:' + Buffer.from(MARQUE + 'deja', 'utf8').toString('base64'),
    },
    twitch: { refreshToken: 'reste-en-clair' },
  });

  assert.equal(store.chiffrerSecretsAuRepos(), true);
  assert.ok(!readFileSync(TOKENS_PATH, 'utf8').includes('reste-en-clair'));
  assert.equal(store.lireTokens().twitchApp.clientSecret, 'deja', 'la partie deja chiffree doit survivre');
});

test('un tokens.json absent ne fait pas trebucher la migration', () => {
  coffre.brancher(coffreFactice);
  poserFichier({});
  assert.equal(store.chiffrerSecretsAuRepos(), false);
  assert.doesNotThrow(() => store.lireTokens());
});

test('le chemin du fichier est bien celui des donnees de test', () => {
  // Garde-fou : une erreur ici ferait ecrire les tests dans le vrai
  // %APPDATA%\StreamKit, donc sur les jetons du streamer qui lance la suite.
  assert.equal(TOKENS_PATH, join(DONNEES, 'tokens.json'));
});
