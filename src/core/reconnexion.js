// Twitch injoignable au lancement de StreamKit : on retente tout seul.
//
// Avec « Démarrer avec Windows », StreamKit se lance souvent avant le reseau
// (Wi-Fi pas encore connecte, DNS pas encore pret). Jusqu'en 0.25.0, ce seul
// echec laissait tous les modules Twitch eteints pour la session entiere --
// sondages, bot musique, Random Car, predictions... -- avec pour tout signe une
// pastille rouge, dans une fenetre que le streamer n'ouvre pas forcement.
//
// On ne retente que ce qui peut s'arranger seul : le reseau, une panne de
// Twitch. Une autorisation refusee (jeton retire ou expire) ou une chaine
// introuvable attendent le streamer : retenter n'y changerait rien.

// Pauses entre deux essais, la derniere se repetant : vite au debut (le reseau
// arrive en general dans la minute), puis une fois par minute, sans fin.
export const PAUSES_MS = [10_000, 20_000, 30_000, 60_000];

// 'passagere' : reseau, DNS, Twitch en panne -- ca reviendra.
// 'autorisation' : jeton refuse, il faut reconnecter la chaine.
// 'configuration' : reglage faux (chaine introuvable).
export function natureErreurTwitch(e) {
  if (e?.permanente) return 'configuration';
  if (e?.name === 'InvalidTokenError' || e?.name === 'InvalidTokenTypeError') return 'autorisation';
  // Jeton de rafraichissement refuse : 400 « Invalid refresh token ».
  if ([400, 401, 403].includes(e?.statusCode)) return 'autorisation';
  return 'passagere';
}

// Une ligne lisible : « fetch failed (ENOTFOUND) » plutot que la pile, et le
// message de Twitch (« 400 invalid client ») plutot que celui de Twurple, qui
// ne dit que « Bad Request » suivi de l'URL.
export function resumeErreur(e) {
  try {
    const m = JSON.parse(e?.body ?? '')?.message;
    if (m) return (e.statusCode ? e.statusCode + ' ' : '') + m;
  } catch {
    /* corps absent ou pas en JSON */
  }
  const code = e?.cause?.code ?? e?.code;
  const message = String(e?.message || e).split('\n')[0];
  return code && !message.includes(code) ? message + ' (' + code + ')' : message;
}

// `connecter()` : un essai complet ; resout vrai si Twitch est pret, faux s'il
// manque un reglage (rien a retenter), leve si Twitch reste injoignable.
export function creerReconnexion({
  connecter,
  log,
  pausesMs = PAUSES_MS,
  planifier = (fn, ms) => setTimeout(fn, ms),
  annuler = (t) => clearTimeout(t),
}) {
  let minuteur = null;
  let essai = 0;

  function arreter() {
    if (minuteur !== null) annuler(minuteur);
    minuteur = null;
    essai = 0;
  }

  // Planifie le prochain essai ; renvoie la pause choisie.
  function programmer() {
    const pause = pausesMs[Math.min(essai, pausesMs.length - 1)];
    essai++;
    minuteur = planifier(tenter, pause);
    return pause;
  }

  async function tenter() {
    minuteur = null;
    const numero = essai;
    try {
      const pret = await connecter();
      essai = 0;
      if (pret) {
        const s = numero > 1 ? 's' : '';
        log.ok(
          'Twitch répond de nouveau : les modules Twitch démarrent (' +
            numero +
            ' essai' +
            s +
            ' automatique' +
            s +
            ').'
        );
      }
      return;
    } catch (e) {
      if (natureErreurTwitch(e) !== 'passagere') {
        essai = 0;
        log.err('Twitch refuse la connexion : ' + resumeErreur(e) + '. Plus de nouvel essai automatique.');
        return;
      }
      const pause = programmer();
      const ligne =
        'Twitch toujours injoignable (' + resumeErreur(e) + ') : nouvel essai dans ' + pause / 1000 + ' s.';
      // Les premiers essais, puis un rappel toutes les dix minutes environ :
      // un reseau coupe une heure ne doit pas noyer le journal.
      if (numero < pausesMs.length || numero % 10 === 0) log.warn(ligne);
      else log.debug(ligne);
    }
  }

  return {
    // Apres un echec (au lancement, ou en reconnectant a la main) : planifie la
    // suite si ca peut s'arranger seul. Renvoie vrai si un essai est prevu.
    apresEchec(e) {
      arreter();
      if (natureErreurTwitch(e) !== 'passagere') return false;
      const pause = programmer();
      log.warn(
        'Twitch injoignable (' +
          resumeErreur(e) +
          ') : nouvel essai dans ' +
          pause / 1000 +
          ' s, puis régulièrement. Les modules Twitch démarreront dès que Twitch répondra.'
      );
      return true;
    },
    arreter,
    prevu: () => minuteur !== null,
  };
}
