# Sweat Tracker

PWA personnelle de suivi des ports et des lavages. La garde-robe, les photos ajoutées et le journal sont stockés dans IndexedDB sur l’appareil. Le projet utilise React, TypeScript, Vite et un service worker. En production, Cloudflare Access et une Pages Function protègent le site.

## Lancer et tester

Node.js 22.12 ou supérieur. Depuis la racine du dépôt sous Windows :

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run dev
```

Ouvre [l’application locale](http://127.0.0.1:5173/). Pour tester le build et le hors-ligne en local :

```powershell
npm.cmd run build
npm.cmd run preview
```

Ouvre [la prévisualisation locale](http://127.0.0.1:4173/), attends l’activation du service worker, puis teste un rechargement hors ligne. L’accès local sans connexion s’applique aux adresses de bouclage. Les deux ports ont chacun leur stockage.

## Déployer sur Cloudflare Pages

1. Dans [les applications GitHub installées](https://github.com/settings/installations), ouvre **Cloudflare Workers and Pages → Configure**. Dans **Repository access**, sélectionne **Only select repositories**, ajoute **sweat-tracker**, garde les dépôts déjà utilisés et enregistre. Si l’application est absente, son installation est proposée lors de **Connect to Git**. [Guide Cloudflare](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
2. Dans **Cloudflare → Workers & Pages → Create application → Pages → Connect to Git**, choisis le dépôt et renseigne les valeurs ci-dessous. Le répertoire `functions/` doit rester à la racine du dépôt. [Guide de connexion Git](https://developers.cloudflare.com/pages/get-started/git-integration/)
3. Dans **Settings → Builds → Branch control**, désactive les previews si tu ne les utilises pas. Dans **Settings → Runtime → Fail open / closed**, sélectionne **Fail closed** lorsque ce réglage est disponible. [Routage et mode Fail closed](https://developers.cloudflare.com/pages/functions/routing/)
4. Dans **Custom domains**, ajoute un sous-domaine dédié sur une zone Cloudflare, par exemple `sweats.example.com`. Utilise ce domaine HTTPS pour l’installation iPhone. [Domaines personnalisés](https://developers.cloudflare.com/pages/configuration/custom-domains/)

| Réglage | Valeur |
| --- | --- |
| Préréglage | React (Vite) |
| Branche de production | `main` |
| Répertoire racine | Racine du dépôt |
| Commande de build | `npm run build` |
| Répertoire de sortie | `dist` |
| Node.js | 22 |

### Activer l’accès privé

1. Dans **Cloudflare One → Integrations → Identity providers**, active **One-time PIN**. Dans **Access controls → Applications**, ajoute une application **Self-hosted** avec le domaine personnalisé entier, sans limiter le chemin. Sélectionne le PIN par email comme méthode de connexion. Une durée d’application de **7 jours** évite un code à chaque ouverture. Dans **Advanced settings → Cookie settings**, active **HttpOnly** et conserve le chemin du cookie à `/`. [Paramètres des cookies Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/) [Application auto-hébergée](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) · [Durées et déconnexion](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
2. Ajoute une seule politique **Allow → Include → Emails** avec ton adresse exacte. Évite **Everyone**, **Emails ending in**, **Bypass** et les politiques génériques. Récupère l’**Application Audience (AUD)** depuis cette application Access.
3. Dans **Pages → Settings → Variables and Secrets**, renseigne ces valeurs dans l’environnement **Production**, puis relance un déploiement. Utilise un **Secret** pour l’adresse. Les valeurs restent côté serveur.

| Variable | Valeur |
| --- | --- |
| `ACCESS_HOSTNAME` | Domaine personnalisé exact, sans protocole ni chemin |
| `ACCESS_TEAM_DOMAIN` | URL HTTPS de l’équipe Access, de la forme `https://mon-equipe.cloudflareaccess.com` |
| `ACCESS_AUD` | AUD de l’application Access créée pour Sweat Tracker |
| `ACCESS_ALLOWED_EMAIL` | Même adresse exacte que dans la politique Access |

La fonction vérifie la signature, l’émetteur, l’audience, l’expiration et l’adresse du jeton Access sur toutes les routes. Elle refuse les hôtes `pages.dev`, y compris les previews et les URL par commit, ainsi que toute configuration incomplète. Garde les variables Preview vides. Si des previews sont nécessaires, active aussi **Enable access policy** pour les previews dans Pages. Le domaine principal `pages.dev` peut, en option, rediriger vers le domaine protégé via **Bulk Redirects**. [Validation des jetons Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) · [Protection des domaines Pages](https://developers.cloudflare.com/pages/configuration/custom-domains/)

4. Avant d’importer tes données, vérifie en navigation privée que le domaine ouvre Cloudflare Access, qu’une autre adresse est refusée et que ton adresse ouvre l’app. Vérifie aussi `/sw.js`, `/manifest.webmanifest` et `/images/sweats/bleu.webp` sans session. Les hôtes `pages.dev` et les previews doivent refuser l’accès ou rediriger vers le domaine protégé.

Sur iPhone, ouvre le domaine HTTPS dans Safari puis utilise **Partager → Sur l’écran d’accueil**. Ouvre l’app installée une première fois en ligne pour établir la session et préparer le cache. [Guide Apple](https://support.apple.com/fr-fr/guide/iphone/iphea86e5236/ios)

## Hors ligne et sauvegardes

En production, le service worker n’ouvre le journal sans réseau qu’après une session Access vérifiée sur cette installation, pour **24 h au plus**, avec une échéance bornée par celle du jeton. Un refus ou une redirection de connexion reçu en ligne bloque le recours au cache. L’action **Réglages → Se déconnecter** retire l’accès hors ligne et ouvre la déconnexion Cloudflare. Si tu es hors ligne, termine cette dernière au retour du réseau. Cloudflare peut fermer également tes autres sessions Access de la même équipe. [Déconnexion Cloudflare](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#log-out-as-a-user)

La révocation à distance ne peut être connue sans réseau. Les fichiers déjà téléchargés et les données IndexedDB restent sur l’appareil et dépendent de sa protection. La session Access ne les chiffre pas. Le dépôt public contient les six visuels de départ. Les photos ajoutées, réglages et historiques restent sur l’appareil.

Dans **Réglages → Exporter mes données → Télécharger le JSON**, enregistre le fichier dans Fichiers ou sur un autre support. Sur le nouvel appareil ou domaine, utilise **Importer une sauvegarde**, vérifie son contenu puis confirme le remplacement des données locales. Les sauvegardes des formats V1 et V2 sont acceptées. Chaque adresse et profil possède un historique indépendant.

