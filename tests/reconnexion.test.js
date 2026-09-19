// Twitch injoignable au lancement : StreamKit retente seul.
//
// Avec « Démarrer avec Windows », StreamKit part souvent avant le reseau. Un
// seul echec laissait alors tous les modules Twitch eteints pour la soiree. On
// verifie ici QUAND on retente (le reseau, une panne de Twitch) et quand on ne
// retente pas (une autorisation retiree, une chaine introuvable), et a quel
// rythme.

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerReconnexion, natureErreurTwitch, PAUSES_MS, resumeErreur } from '../src/core/reconnexion.js';

// Les erreurs telles que Node et Twurple les levent.
const reseauCoupe = () =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
  });
const http = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const jetonInvalide = () => {
  const e = new Error('Invalid token supplied');
  Object.defineProperty(e, 'name', { value: 'InvalidTokenError' });
  return e;
};

test('ce qui peut s arranger seul, et ce qui attend le streamer', () => {
  assert.equal(natureErreurTwitch(reseauCoupe()), 'passagere', 'réseau pas encore là');
  assert.equal(natureErreurTwitch(http(503, 'Service Unavailable')), 'passagere', 'Twitch en panne');
  assert.equal(natureErreurTwitch(http(429, 'Too Many Requests')), 'passagere');
  assert.equal(natureErreurTwitch(http(400, 'Invalid refresh token')), 'autorisation');
  assert.equal(natureErreurTwitch(http(401, 'invalid access token')), 'autorisation');
  assert.equal(natureErreurTwitch(jetonInvalide()), 'autorisation');
  assert.equal(
    natureErreurTwitch(Object.assign(new Error('chaîne Twitch introuvable : x'), { permanente: true })),
    'configuration'
  );
});

test('le journal dit la cause en une ligne', () => {
  assert.equal(resumeErreur(reseauCoupe()), 'fetch failed (ENOTFOUND)');
  // Vu au banc contre le vrai Twitch, avec de faux identifiants.
  const refus = Object.assign(new Error('Encountered HTTP status code 400: Bad Request\n\nURL: ...'), {
    statusCode: 400,
    body: JSON.stringify({ status: 400, message: 'invalid client' }),
  });
  assert.equal(resumeErreur(refus), '400 invalid client');
  assert.equal(
    resumeErreur(new Error('Encountered HTTP status code 503\n\nURL: ...')),
    'Encountered HTTP status code 503'
  );
});

function banc({ echecs = [], pausesMs = PAUSES_MS } = {}) {
  const lignes = [];
  const log = Object.fromEntries(
    ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => lignes.push([n, m])])
  );
  const planifies = [];
  let essais = 0;
  const r = creerReconnexion({
    log,
    pausesMs,
    connecter: async () => {
      essais++;
      const e = echecs.shift();
      if (e) throw e;
      return true;
    },
    planifier: (fn, ms) => {
      planifies.push({ fn, ms });
      return planifies.length;
    },
    annuler: () => {},
  });
  // Fait tourner l'essai planifie le plus recent.
  const suivant = () => planifies.at(-1).fn();
  return {
    r,
    lignes,
    planifies,
    suivant,
    essais: () => essais,
    de: (n) => lignes.filter(([x]) => x === n).map(([, m]) => m),
  };
}

test('reseau pas encore la : on retente, de plus en plus espace, jusqu a ce que ca passe', async () => {
  const b = banc({ echecs: [reseauCoupe(), reseauCoupe(), reseauCoupe(), reseauCoupe()] });
  assert.equal(b.r.apresEchec(reseauCoupe()), true);
  assert.match(b.de('warn')[0], /Twitch injoignable \(fetch failed \(ENOTFOUND\)\) : nouvel essai dans 10 s/);

  for (let i = 0; i < 4; i++) await b.suivant(); // quatre essais rates...
  assert.deepEqual(
    b.planifies.map((p) => p.ms),
    [10000, 20000, 30000, 60000, 60000],
    'puis une fois par minute'
  );

  await b.suivant(); // ...le cinquieme passe
  assert.equal(b.essais(), 5);
  assert.equal(b.planifies.length, 5, 'plus rien de planifie');
  assert.match(
    b.de('ok')[0],
    /Twitch répond de nouveau : les modules Twitch démarrent \(5 essais automatiques\)/
  );
  assert.equal(b.r.prevu(), false);
});

test('une autorisation refusee ne se retente pas', async () => {
  const b = banc();
  assert.equal(b.r.apresEchec(http(400, 'Invalid refresh token')), false);
  assert.equal(b.planifies.length, 0);

  // Et si elle tombe en cours de route (jeton retire entre deux essais) : on s'arrete.
  const c = banc({ echecs: [jetonInvalide()] });
  c.r.apresEchec(reseauCoupe());
  await c.suivant();
  assert.equal(c.planifies.length, 1, 'aucun nouvel essai');
  assert.match(
    c.de('err')[0],
    /Twitch refuse la connexion : Invalid token supplied\. Plus de nouvel essai automatique\./
  );
});

test('un reglage manquant arrete aussi les essais, sans bruit', async () => {
  // connecter() resout faux : Twitch n'est pas configure, rien a retenter.
  const b = banc();
  const r = creerReconnexion({
    log: Object.fromEntries(['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, () => {}])),
    connecter: async () => false,
    planifier: (fn) => b.planifies.push({ fn }),
    annuler: () => {},
  });
  r.apresEchec(reseauCoupe());
  await b.planifies[0].fn();
  assert.equal(b.planifies.length, 1);
  assert.equal(r.prevu(), false);
});

test('une panne longue ne noie pas le journal', async () => {
  const b = banc({ echecs: Array.from({ length: 30 }, reseauCoupe) });
  b.r.apresEchec(reseauCoupe());
  for (let i = 0; i < 30; i++) await b.suivant();
  // L'echec du lancement, les 3 premiers essais, puis un rappel tous les 10.
  assert.equal(b.de('warn').length, 1 + 3 + 3);
});

test('arreter annule l essai prevu', () => {
  const annules = [];
  const r = creerReconnexion({
    log: Object.fromEntries(['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, () => {}])),
    connecter: async () => true,
    planifier: () => 'minuteur-1',
    annuler: (t) => annules.push(t),
  });
  r.apresEchec(reseauCoupe());
  assert.equal(r.prevu(), true);
  r.arreter();
  assert.deepEqual(annules, ['minuteur-1']);
  assert.equal(r.prevu(), false);
});
