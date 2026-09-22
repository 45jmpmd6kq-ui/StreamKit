// Brouillage de l'adresse du salon Discord qui recoit les rapports de bug.
//
// Ce n'est PAS du chiffrement : la cle est juste en dessous, et quelqu'un qui
// decortique l'installeur retrouvera l'adresse. Le but est ailleurs -- qu'elle
// n'apparaisse pas EN CLAIR dans l'application installee :
//
//   - les outils qui fouillent les executables (analyses antivirus, VirusTotal
//     quand un antivirus y envoie l'installeur non signe) relevent les adresses
//     « discord.com/api/webhooks/... » en clair. Un programme qui poste des
//     fichiers vers un webhook Discord, c'est aussi le portrait-robot d'un
//     voleur de mots de passe : autant ne pas lui ressembler ;
//   - les memes adresses, une fois relevees, finissent inondees ou supprimees.
//
// Aucune dependance : le script de construction (scripts/cible-signalement.mjs)
// l'importe aussi, sans charger le reste de StreamKit.

const CLE = Buffer.from('StreamKit/signalement/v1', 'utf8');

function xor(octets) {
  const out = Buffer.alloc(octets.length);
  for (let i = 0; i < octets.length; i++) out[i] = octets[i] ^ CLE[i % CLE.length];
  return out;
}

export function brouiller(texte) {
  return xor(Buffer.from(String(texte), 'utf8')).toString('base64');
}

export function debrouiller(code) {
  return xor(Buffer.from(String(code), 'base64')).toString('utf8');
}

// Une adresse de webhook Discord, et rien d'autre : c'est vers elle que partent
// le journal et les captures du streamer. Une faute de frappe dans la variable
// d'environnement ne doit pas les envoyer ailleurs.
export function estWebhookDiscord(url) {
  return /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(
    String(url)
  );
}
