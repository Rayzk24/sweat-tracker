# Sweat Tracker

PWA personnelle de suivi des ports et des lavages. La garde-robe, les photos ajoutées et le journal sont stockés dans IndexedDB sur l’appareil. Le projet utilise React, TypeScript, Vite et un service worker. En production, une Pages Function ouvre une session Supabase pour le compte autorisé.

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
4. Dans **Custom domains**, associe `sweats.rayzk.fr` au projet. Utilise cette adresse HTTPS pour l’installation iPhone. [Domaines personnalisés](https://developers.cloudflare.com/pages/configuration/custom-domains/)

| Réglage | Valeur |
| --- | --- |
| Préréglage | React (Vite) |
| Branche de production | `main` |
| Répertoire racine | Racine du dépôt |
| Commande de build | `npm run build` |
| Répertoire de sortie | `dist` |
| Node.js | 22 |

### Configurer la connexion

Dans **Pages → Settings → Variables and Secrets**, ajoute les trois paramètres en **Production**, puis relance un déploiement.

| Paramètre | Valeur |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS du projet Supabase commun |
| `SUPABASE_PUBLISHABLE_KEY` | Clé publique `sb_publishable_…` de ce projet |
| `SWEAT_ALLOWED_EMAIL` | Adresse vérifiée du seul compte autorisé, à renseigner comme secret |

La connexion utilise le compte Supabase existant. Le serveur confirme l’identité et l’adresse vérifiée avant d’ouvrir le journal ou de servir ses ressources. Le mot de passe est transmis à Supabase lors de la connexion. Les cookies de session sont Secure et HttpOnly. La déconnexion révoque la session Sweat Tracker auprès de Supabase. [Sessions Supabase](https://supabase.com/docs/guides/auth/sessions)

Le formulaire et les icônes sont publics sur le domaine de production. Les alias `pages.dev` et les previews sont refusés par la Pages Function. En navigation privée, vérifie l’ouverture du formulaire, le refus d’un mauvais mot de passe, la connexion du compte autorisé et le retour au formulaire après déconnexion. Les variables utilisées par cette fonction restent côté serveur.

Sur iPhone, ouvre le domaine HTTPS dans Safari puis utilise **Partager → Sur l’écran d’accueil**. [Guide Apple](https://support.apple.com/fr-fr/guide/iphone/iphea86e5236/ios)

## Réseau et sauvegardes

En production, l’ouverture du journal et la vérification de la session nécessitent une connexion réseau. Le service worker retire les anciens caches d’accès et conserve le mode hors ligne pour la version de prévisualisation sur une adresse de bouclage. Les données IndexedDB restent sur l’appareil, y compris après déconnexion. Leur confidentialité dépend de la protection de l’appareil. Le dépôt public contient les six visuels de départ.

Dans **Réglages → Exporter mes données → Télécharger le JSON**, enregistre le fichier dans Fichiers ou sur un autre support. Sur le nouvel appareil ou domaine, utilise **Importer une sauvegarde**, vérifie son contenu puis confirme le remplacement des données locales. Les sauvegardes des formats V1 et V2 sont acceptées. Chaque adresse et profil possède un historique indépendant.

