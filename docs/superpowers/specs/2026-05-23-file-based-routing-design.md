# bangala.js — Sous-projet 3 : file-based routing

> Document de design. Statut : **implémentation initiale sur `main`**.
> Date : 2026-05-23.

## Périmètre

Le sous-projet 3 fournit le noyau de routing réutilisable par le futur dev
server et le build Vite. Il ne lance pas de serveur HTTP et ne compile pas les
pages : il transforme des chemins de fichiers `.bangala` en manifest trié, puis
matche un pathname entrant.

## API publique

Le paquet expose `bangala/router` :

- `discoverRoutes(root, options?)`
- `createRoutes(files, options?)`
- `routePathFromFile(file, options?)`
- `matchRoute(routes, pathname)`

## Conventions

| Fichier | Route |
|---|---|
| `pages/index.bangala` | `/` |
| `pages/about.bangala` | `/about` |
| `pages/blog/index.bangala` | `/blog` |
| `pages/blog/[slug].bangala` | `/blog/:slug` |
| `pages/docs/[...parts].bangala` | `/docs/*parts` |

Les fichiers et dossiers commençant par `_` ou `.` sont privés et ignorés.
Les catch-all doivent être le dernier segment. Les routes sont triées par
spécificité afin que `/blog/settings` gagne sur `/blog/:slug`, puis
`/blog/*rest`.

## Non-objectifs

- Pas de serveur HTTP.
- Pas de chargement/import des modules compilés.
- Pas de layouts imbriqués.
- Pas de code splitting ou de manifest client.

Ces sujets appartiennent aux sous-projets 4 et 5.
