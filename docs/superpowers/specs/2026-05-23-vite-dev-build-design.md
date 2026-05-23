# bangala.js — Sous-projet 4 : dev server + build Vite

> Document de design. Statut : **implémentation initiale sur `main`**.
> Date : 2026-05-23.

## Périmètre

Le sous-projet 4 connecte le compilateur `.bangala`, le routeur et le runtime
client à Vite. Il fournit une API programmable ; le wrapping CLI appartient au
sous-projet 5.

## API publique

Le paquet expose `bangala/vite` :

- `bangala(options?)` : plugin Vite qui compile les fichiers `.bangala`,
  résout les imports de composants, et installe un middleware de routes.
- `createBangalaDevServer(options?)` : crée un serveur Vite configuré pour
  servir les routes Bangala. L'appelant choisit quand appeler `listen()`.
- `buildBangala(options?)` : bundle `bangala/client/auto` et prerender les
  routes statiques, plus les routes dynamiques explicitement listées.

## Build

Le build écrit dans `outDir` :

- `assets/bangala-client.js`
- `index.html`
- `<route>/index.html`

Les routes dynamiques ne sont pas devinées. Elles doivent être passées via
`prerender`, par exemple `["/blog/hello-world"]`.

## Non-objectifs

- Pas de commande CLI.
- Pas de templates projet.
- Pas d'adapters de déploiement.
- Pas de HMR spécifique aux composants Bangala ; Vite assure déjà le reload de
  modules et le sous-projet 5 pourra ajouter une expérience CLI plus polie.
