# bangala.js — Pipeline des îlots (dev + build)

> Document de design. Statut : **implémenté sur `feat/islands-pipeline`**.
> Date : 2026-10-06. Complète le §7 de `2026-05-23-islands-runtime-design.md`.

## Problème

`<Counter client:load/>` produisait `data-entry="./Counter"` : un chemin
relatif au fichier source, sans extension, que le navigateur ne peut pas
charger. Rien ne le réécrivait ni ne bundlait le code client. Le starter
contournait le problème en écrivant le marqueur `<bangala-island>` à la main
vers `public/islands/Counter.client.js`.

## Convention

Le code navigateur d'un îlot vit **à côté** de son composant :

```
components/
  Counter.bangala       # HTML serveur (coquille SSR)
  Counter.client.ts     # code navigateur : export mount(el, props, ctx)
```

Extensions essayées dans l'ordre : `.ts`, `.tsx`, `.mts`, `.js`, `.jsx`,
`.mjs`. Un îlot sans module client est une erreur explicite qui nomme le
fichier à créer. Le composant doit être importé par un chemin relatif.

Pourquoi un fichier voisin plutôt qu'un bloc `<script>` : le contrat du
runtime (`mount(el, props, ctx)`) reste un module ESM ordinaire, écrit avec la
bibliothèque de son choix, et la convention reprend le nommage déjà utilisé
par le starter. Les blocs `<script>` restent une piste v2 du compilateur.

## Compilateur

Deux options de `compile()`, sans effet par défaut :

- `islandEntry(componentPath)` : renvoie l'URL écrite dans `data-entry`.
  Défaut : le spécifieur sans `.bangala` (comportement historique).
- `rewriteBangalaImports` : `false` garde les spécifieurs `.bangala`, pour un
  bundler qui charge lui-même ces fichiers. Le plugin Vite l'utilise, ce qui
  supprime l'ancien détournement `./x.js` → `x.bangala` de `resolveId`.

Le module généré est transpilé (esbuild, loader `ts`) dans le `load()` du
plugin : le TypeScript du frontmatter fonctionne en dev comme en build.

## Dev

`data-entry` pointe vers le module client servi par Vite : `/<chemin depuis la
racine>` (ou `/@fs/...` hors racine), préfixé par `base`. Vite le transpile à
la demande. Le serveur de dev autonome recharge la page quand un `.bangala`
change ; en mode middleware, l'hôte garde la main sur la connexion.

## Build

1. Les pages sont rendues d'abord, par un serveur SSR qui reçoit
   `options.vite`. Chaque module client rencontré reçoit un marqueur
   temporaire `/@bangala-island/<n>/`.
2. Le build client bundle `bangala/client/auto` et **seulement** les îlots
   rencontrés, vers `assets/islands/<nom>-<hash>.js`, en conservant leurs
   exports (`preserveEntrySignatures: "exports-only"`).
3. Les marqueurs sont remplacés par les URLs finales (préfixées par `base`),
   puis les pages sont écrites.

Avec `client: false`, rien n'est bundlé : `data-entry` pointe vers les
sources et un avertissement est affiché.

## Runtime injecté

`bangala/client/auto` n'est ajouté qu'aux pages qui contiennent un
`<bangala-island>`, en dev comme en build : une page statique n'embarque
aucun JavaScript, conformément à la promesse du README.

## Hors périmètre

- CSS importé par un module client : émis par Vite mais pas lié aux pages.
- Îlots dont le composant vient d'un paquet (`import X from "lib/X.bangala"`).
- Source maps du module généré.
