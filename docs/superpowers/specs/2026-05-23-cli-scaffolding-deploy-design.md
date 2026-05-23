# bangala.js — Sous-projet 5 : CLI, scaffolding et deploy adapters

> Document de design. Statut : **implémentation initiale sur `main`**.
> Date : 2026-05-23.

## Périmètre

Le sous-projet 5 rend les primitives Vite utilisables directement depuis un
terminal et ajoute une couche de configuration de déploiement portable.

## Commandes

Le paquet expose le binaire `bangala` :

- `bangala dev` démarre le dev server Vite configuré pour les routes Bangala.
- `bangala build` prerender les pages et bundle `bangala/client/auto`.
- `bangala create` génère un projet minimal prêt pour `npm install`.
- `bangala deploy` écrit les fichiers de configuration d'un hébergeur statique.

## Adapters

`bangala/adapters` expose les helpers programmatiques :

- `listDeployAdapters()`
- `createDeployAdapter(name, options?)`
- `applyDeployAdapter(root, name, options?)`

Adapters inclus : `static`, `netlify`, `vercel`, `cloudflare-pages`.

## Non-objectifs

- Pas d'exécution de déploiement distante depuis le CLI.
- Pas de gestion de secrets.
- Pas de templates multi-framework.
- Pas d'adapter SSR serverless ; le build v1 reste statique/prerender.
