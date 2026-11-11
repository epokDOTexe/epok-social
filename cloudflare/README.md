# EPOK SOCIAL — authentification administrateur

Cette fonction ajoute une API sécurisée pour l'édition partagée du contenu du site.
Le compte GitHub autorisé est `epokDOTexe`. Le Worker ne conserve pas le jeton OAuth GitHub : il vérifie l'identité puis émet un jeton de session signé.

## Prérequis Cloudflare

1. Créer un namespace **Workers & Pages → KV** nommé `EPOK_DATA`.
2. Copier son ID dans `wrangler.toml` à la place de `REMPLACER_PAR_ID_DU_NAMESPACE_KV`.
3. Créer un Worker nommé `epok-social-auth` et y déployer `worker.js` (ou déployer ce dossier avec Wrangler).
4. Dans les paramètres du Worker, ajouter les secrets :
   - `GITHUB_CLIENT_SECRET` : secret d'une GitHub OAuth App.
   - `SESSION_SECRET` : chaîne aléatoire longue (au moins 32 octets).
5. Ajouter la variable `GITHUB_CLIENT_ID` dans les variables du Worker.

## GitHub OAuth App

Créer une OAuth App dans **GitHub → Settings → Developer settings → OAuth Apps** :
- Homepage URL : `https://epokdotexe.github.io/epok-social/`
- Authorization callback URL : `https://ADRESSE-DU-WORKER.workers.dev/auth/callback`
- Activer uniquement le scope public `read:user` demandé par le Worker.

Renseigner le Client ID et le Client Secret dans les paramètres du Worker. Ne jamais placer le Client Secret dans le dépôt GitHub.

## Origine et callback

Le Worker est configuré pour accepter les requêtes API depuis `https://epokdotexe.github.io`.
Après le déploiement, l'URL du Worker devra être renseignée dans le script d'administration du site.
Le callback OAuth redirige vers `https://epokdotexe.github.io/epok-social/?auth_code=...`.

## Sécurité

- Seul le compte GitHub dont le login est exactement `epokDOTexe` est autorisé.
- L'état OAuth est aléatoire, à usage unique et expire après 5 minutes.
- Le code d'échange expire après 90 secondes et ne peut être utilisé qu'une fois.
- Les sessions sont signées côté Worker et expirent après 12 heures.
- Le contenu public est en lecture seule ; l'écriture exige une session valide.
- Le Worker limite les données sauvegardées à 100 Ko.

Ne pas ajouter le bouton d'édition au site avant d'avoir déployé et testé le Worker. L'interface front-end sera raccordée ensuite à l'URL réelle du Worker.
