# bangala.js — Sous-projet 2 : runtime d'îlots côté client

> Document de design. Statut : **en attente de relecture utilisateur**.
> Date : 2026-05-23.

## 1. Contexte

### 1.1. Place dans la roadmap

Ce document spécifie le **sous-projet 2** de bangala.js. Il s'enchaîne sur le
sous-projet 1 (compilateur `.bangala` + rendu serveur, livré le 2026-05-23) et
précède le sous-projet 3 (routing par fichiers).

Rappel de la roadmap :

| # | Sous-projet | Statut |
|---|---|---|
| 1 | Compilateur `.bangala` + rendu serveur | ✅ Livré |
| **2** | **Runtime d'îlots côté client** | **Ce document.** |
| 3 | Routing par fichiers | À spécifier. |
| 4 | Dev server + build (Vite) | À spécifier. |
| 5 | CLI + scaffolding + adapters de déploiement | À spécifier. |

### 1.2. Ce que produit déjà le sous-projet 1

Le compilateur émet, pour chaque composant marqué `client:load`, un marqueur DOM
de la forme :

```html
<bangala-island
  data-entry="./Counter"
  data-props='{"start":10}'
  data-strategy="load">
  <button>Compteur : 10</button>
</bangala-island>
```

Ces marqueurs sont **inertes** : aucune interactivité, aucun `<script>` n'est
émis. C'est le rôle du sous-projet 2 de les rendre vivants.

### 1.3. Périmètre de ce document

Ce document spécifie **uniquement le sous-projet 2** : le runtime JavaScript
côté client qui scanne le DOM, charge les modules d'îlots, et les instancie.

Il décrit aussi les **changements requis sur le compilateur (sous-projet 1)**
pour qu'il puisse émettre des `data-strategy="idle"` et `data-strategy="visible"`
(aujourd'hui le parser rejette ces directives). Ces changements sont mineurs
(~5 lignes) et seront livrés en première tâche du plan d'implémentation.

### 1.4. Principes directeurs

- **Zéro JS partagé entre îlots.** Chaque îlot charge son propre module via
  `import()` dynamique. Le runtime lui-même est un tout petit script
  (~1-2 KB minifié) qui sert uniquement d'amorçage.
- **HTML d'abord, JS explicite.** Le HTML SSR reste affiché en permanence,
  même en cas d'échec d'hydratation. Perdre l'interactivité d'un îlot n'efface
  jamais le contenu.
- **Loader agnostique.** Le runtime n'impose aucun framework côté îlot. Un
  îlot est un module ESM qui exporte une fonction `mount(el, props, ctx)`. Le
  développeur est libre d'utiliser du vanilla, Preact, Lit, htmx, ou un Web
  Component à l'intérieur.
- **Frontières propres.** Le runtime ne sait rien des URLs (sub-projet 4), ne
  sait rien du routing (sub-projet 3), ne sait rien du build. Il fait
  exactement une chose : amorcer les îlots décrits par le DOM.

## 2. Architecture & paquetage

### 2.1. Sous-chemin d'export

Le sous-projet 2 vit dans le même paquet `bangala`, sous un nouveau sous-chemin
d'export `bangala/client` :

```json
{
  "exports": {
    ".":          "./src/index.ts",
    "./runtime":  "./src/runtime.ts",
    "./client":   "./src/client/index.ts"
  }
}
```

Un seul `npm install bangala` suffit pour avoir le compilateur, le runtime
serveur, et le runtime client. Aucun import croisé entre les trois — chacun
fonctionne en isolation et leur seul couplage est le format du marqueur
`<bangala-island>`.

### 2.2. Structure de fichiers

```
src/client/
  index.ts        ← exports publics + auto-start côté navigateur
  scanner.ts      ← querySelectorAll + parsing des attributs data-*
  hydrator.ts     ← orchestration : strategy → import → mount
  strategies.ts   ← scheduleLoad / scheduleIdle / scheduleVisible
  errors.ts       ← formatage des erreurs, marquage DOM, dispatch d'event

tests/client/
  scanner.test.ts
  hydrator.test.ts
  strategies.test.ts
  integration.test.ts
  fixtures/
    Counter-island.ts   ← un vrai module d'îlot pour le test e2e
```

Chaque fichier reste sous ~100 lignes ; chaque responsabilité est isolée et
testable indépendamment.

### 2.3. Stack technique

| Choix | Détail |
|---|---|
| Langage | TypeScript, ESM, identique au sous-projet 1. |
| Runner de tests | Vitest, comme le sous-projet 1. |
| Environnement DOM | `happy-dom` (configuré par dossier dans `vitest.config.ts`). |
| Cibles navigateurs | Chromium ≥ 90, Firefox ≥ 90, Safari ≥ 14. |

## 3. API publique du runtime

### 3.1. Exports

```ts
// bangala/client

export interface HydrateOptions {
  /** Appelé à chaque erreur d'hydratation. Reçoit l'élément concerné,
   *  un code d'erreur stable, et la cause sous-jacente. */
  onError?: (el: HTMLElement, code: ErrorCode, cause: unknown) => void;
}

export type ErrorCode =
  | "missing-entry"
  | "bad-props"
  | "unknown-strategy"
  | "import-failed"
  | "no-mount-export"
  | "mount-threw";

export function hydrate(
  root?: ParentNode,
  options?: HydrateOptions,
): void;
```

### 3.2. Auto-start

Quand le module `bangala/client` est chargé dans un navigateur, il s'auto-amorce :

```ts
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrate());
  } else {
    hydrate();
  }
}
```

L'auto-start utilise les défauts (`root = document`, pas de `onError`
explicite). Pour un cas d'usage avec monitoring (Sentry, etc.), le pattern
recommandé est :

```ts
// app.ts
import { hydrate } from "bangala/client";

// (le side-effect d'auto-start a déjà tourné — voir 3.3 sur l'idempotence)
hydrate(document, {
  onError: (el, code, cause) => sentry.captureException(cause, { extra: { code } }),
});
```

Le double-appel est inoffensif grâce à l'idempotence (`data-hydrated`) — voir
section 4.3.

### 3.3. Alternative : event DOM `bangala:island-error`

Pour les cas où l'utilisateur ne peut pas (ou ne veut pas) appeler `hydrate()`
explicitement, **chaque erreur d'hydratation dispatche aussi un événement
custom qui bubble jusqu'à `document`** :

```ts
window.addEventListener("bangala:island-error", (e) => {
  const { code, cause } = (e as CustomEvent).detail;
  sentry.captureException(cause, { extra: { code } });
});
```

L'event est dispatché sur l'élément `<bangala-island>` concerné, avec
`bubbles: true` et `detail: { code, cause }`. Le callback `onError` (si fourni)
et l'event sont **tous les deux** déclenchés — un client peut combiner les
deux mécanismes.

## 4. Le flux d'hydratation

### 4.1. Vue d'ensemble

```
1. hydrate() scanne le DOM
   ▼
2. Pour chaque <bangala-island[data-entry]:not([data-hydrated])> :
     a. Lire data-entry, data-props, data-strategy
     b. JSON.parse les props
     c. Marquer data-hydrated="scheduled" (verrou anti-double-hydratation)
     d. Dispatcher selon data-strategy
   ▼
3. Au moment opportun (immédiat / idle / visible) :
     a. dynamic-import(entry)
     b. Vérifier l'export `mount` et qu'il est callable
     c. await mount(el, props, { strategy, entry })
     d. Marquer data-hydrated="true"
   ▼
4. En cas d'échec à n'importe quelle étape :
     a. console.error avec un code d'erreur stable
     b. data-hydrated="error" + data-hydration-error="<code>"
     c. Appel de options.onError(el, code, cause) si fourni
     d. Dispatch de bangala:island-error (bubbles=true)
     e. La page continue de vivre : le HTML SSR reste visible, les autres
        îlots continuent d'être hydratés indépendamment.
```

### 4.2. Le sélecteur

```ts
const SELECTOR = "bangala-island[data-entry]:not([data-hydrated])";
```

Trois conditions cumulées :
- La balise doit être `<bangala-island>` (custom element name valide, contient
  un tiret).
- `data-entry` doit être présent (un îlot sans module ne sert à rien).
- `data-hydrated` doit être absent (sinon = déjà traité).

### 4.3. Idempotence via `data-hydrated`

L'attribut `data-hydrated` joue trois rôles simultanés :

| Valeur | Sens | Conséquence sur le sélecteur |
|---|---|---|
| _(absent)_ | Pas encore traité | Sélectionné par `hydrate()` |
| `"scheduled"` | Le runtime a programmé l'import mais `mount` n'a pas encore retourné | Ignoré par `hydrate()` |
| `"true"` | `mount` a retourné avec succès | Ignoré par `hydrate()` |
| `"error"` | Une étape a échoué | Ignoré par `hydrate()` |

Conséquence : appeler `hydrate(document)` plusieurs fois (par exemple manuel
après l'auto-start) est inoffensif. Appeler `hydrate(subtree)` après un ajout
de DOM dynamique fonctionne aussi — seuls les nouveaux îlots sont traités.

### 4.4. Codes d'erreur

Les codes sont des **strings stables** (versionnées, breaking change si elles
changent). Leur intérêt est d'être actionnable par du monitoring sans grep
sur des messages humains.

| Code | Quand |
|---|---|
| `missing-entry` | Pas d'attribut `data-entry` ou `data-entry=""`. |
| `bad-props` | `JSON.parse(data-props)` échoue, ou `data-props` est absent. |
| `unknown-strategy` | `data-strategy` n'est ni `load`, ni `idle`, ni `visible`. |
| `import-failed` | `import(data-entry)` rejette (404, syntax error, etc.). |
| `no-mount-export` | Le module importé n'exporte pas `mount`, ou ce n'est pas une fonction. |
| `mount-threw` | `mount(el, props, ctx)` jette une exception ou retourne une promesse rejetée. |

Le message humain (dans `console.error` et dans la `cause` de l'event) est
libre et peut évoluer. Seuls les codes sont stables.

## 5. Les stratégies d'hydratation

### 5.1. Signature commune

```ts
type Schedule = (el: HTMLElement, run: () => void) => void;
```

Chaque stratégie reçoit l'élément et une callback `run` ; elle décide quand
appeler `run()`. Cette signature découple **quand** hydrater de **comment**
hydrater, et permet de tester chaque stratégie en isolement avec un spy.

### 5.2. `load`

```ts
const load: Schedule = (_, run) => run();
```

Immédiat, dans le tour courant du scanner. Convient aux îlots above-the-fold
critiques (header de site, bouton de connexion).

### 5.3. `idle`

```ts
const idle: Schedule = (_, run) => {
  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 1);  // fallback Safari (pas de requestIdleCallback)
  }
};
```

Au prochain idle du navigateur, **avec un timeout garanti de 2s**. Le timeout
protège contre les pages qui ne sont jamais idle (long-running JS, animations).
Le fallback `setTimeout(fn, 1)` couvre Safari, qui n'implémente pas
`requestIdleCallback`.

### 5.4. `visible`

```ts
const visible: Schedule = (el, run) => {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        io.disconnect();
        run();
        return;
      }
    }
  }, { rootMargin: "200px" });
  io.observe(el);
};
```

Hydraté quand l'élément entre dans le viewport, avec une marge de **200px en
avance** pour que l'îlot soit interactif juste avant que l'utilisateur ne le
voie. L'observer se déconnecte après le premier déclenchement — un îlot ne
s'hydrate qu'une fois.

### 5.5. Stratégie inconnue

Pas de fallback à `load`. Si `data-strategy` n'est pas reconnu, l'îlot est
marqué `data-hydrated="error"` avec `data-hydration-error="unknown-strategy"`.
Le HTML SSR reste affiché, mais l'îlot ne devient pas interactif. Échouer
bruyamment est mieux qu'échouer silencieusement.

## 6. Le contrat module d'îlot

### 6.1. Signature de `mount`

```ts
export async function mount(
  el: HTMLElement,
  props: Record<string, unknown>,
  ctx: MountContext,
): Promise<void>;

interface MountContext {
  strategy: "load" | "idle" | "visible";
  entry: string;
}
```

| Paramètre | Garanties |
|---|---|
| `el` | L'élément `<bangala-island>` complet, **avec le SSR HTML toujours dedans**. `mount` peut le lire, préserver son contenu, le remplacer, ou l'augmenter. |
| `props` | Déjà parsé depuis `JSON.parse(el.dataset.props ?? "{}")` par le runtime. Erreurs de parsing → `bad-props` (l'îlot n'est pas appelé). |
| `ctx.strategy` | Identifie ce qui a déclenché l'hydratation. Utile pour de la télémétrie ou des comportements conditionnels. |
| `ctx.entry` | La valeur brute de `data-entry`. Utile pour des îlots qui veulent connaître leur propre identité. |

### 6.2. Valeur de retour

`mount` peut être `sync` ou `async`. Le runtime fait `await mount(...)`. La
valeur de retour est **ignorée en v1**.

**Réservation pour v2** : une valeur de retour `() => void | Promise<void>`
sera interprétée comme une fonction de nettoyage à appeler lors d'un futur
unmount (utile pour HMR). La documentation indique que ce retour est
"réservé" — les îlots qui retournent quelque chose en v1 ne déclenchent
aucun comportement, mais ne sont pas non plus invalides.

### 6.3. Ce que `mount` peut faire avec `el`

Trois patterns recommandés (l'îlot choisit) :

```ts
// A. Augmenter le SSR HTML (htmx-style, le plus léger)
export async function mount(el, props) {
  el.querySelector("button")!.addEventListener("click", () => { /* ... */ });
}

// B. Remplacer le contenu SSR (framework-style) — utiliser replaceChildren()
//    plutôt que des assignations directes de contenu : plus sûr (pas d'exécution
//    de string HTML), plus rapide (single reflow), plus moderne.
export async function mount(el, props) {
  el.replaceChildren();              // vide el en une opération
  const root = render(MyComponent, props);
  el.appendChild(root);
}

// C. Lire les props et le SSR puis morpher (resumable-style)
export async function mount(el, props) {
  const initial = el.querySelector("input")!.value;
  // bootstrap state from DOM, then attach reactivity…
}
```

Le runtime ne **mute pas le contenu** de `el` lui-même. C'est l'îlot qui
décide. Seuls les attributs `data-hydrated` et `data-hydration-error` sont
écrits par le runtime.

**Recommandation de sécurité pour les auteurs d'îlots** : éviter les
assignations directes de contenu HTML depuis des chaînes (risque d'injection
si la string vient des `props`). Préférer `replaceChildren()`, `textContent`,
`createElement`, ou la sortie d'un framework qui sait échapper. Le compilateur
fait déjà l'échappement côté serveur ; les îlots doivent maintenir cette
discipline côté client.

## 7. Résolution d'URL — frontière avec le sous-projet 4

### 7.1. Contrat

Le runtime fait `import(el.dataset.entry)` **verbatim**. Aucune transformation,
aucune addition d'extension, aucune import map. Si l'URL ne résout pas, l'îlot
est marqué `import-failed`.

### 7.2. Conséquence pour le compilateur

Le compilateur émet aujourd'hui `data-entry="./Counter"` (path relatif sans
extension). Cette valeur **ne résout pas dans un navigateur**. Trois implications :

- **En isolation (tests v1 du runtime)** : les fixtures de test fournissent un
  `data-entry` qui résout, par exemple `data-entry="/base/tests/client/fixtures/Counter-island.ts"`.
- **En production future** : le sous-projet 4 (build) réécrira `./Counter` en
  une URL absolue résolvable (par ex. `/_islands/Counter-abc123.js`).
- **En dev future** : le sous-projet 4 (dev server) servira l'URL relative via
  son propre middleware de résolution.

Le runtime reste pur. Aucune connaissance des paths, des extensions, ou des
conventions de build n'entre dans `bangala/client`.

## 8. Changements requis sur le compilateur (sous-projet 1)

Pour que `data-strategy="idle"` et `data-strategy="visible"` puissent être
émis, trois petits changements sont requis dans le sous-projet 1. Ils sont
décrits comme **première tâche** du plan d'implémentation, avant tout code
client.

### 8.1. `src/parser.ts`

Le `finishComponent` actuel rejette toute directive ≠ `client:load` :

```ts
if (directive && directive.name !== "client:load") {
  this.error(`Unknown directive '${directive.name}' (v1 supports only client:load)`);
}
```

À élargir :

```ts
const VALID_DIRECTIVES = new Set(["client:load", "client:idle", "client:visible"]);
if (directive && !VALID_DIRECTIVES.has(directive.name)) {
  this.error(`Unknown directive '${directive.name}'`);
}
```

### 8.2. `src/types.ts`

```ts
type ClientStrategy = "client:load" | "client:idle" | "client:visible";

interface ComponentNode {
  // …
  strategy: ClientStrategy | null;
}

interface IslandRef {
  componentPath: string;
  strategy: ClientStrategy;
}
```

### 8.3. `src/generator.ts`

Aujourd'hui :

```ts
return `\${await island(${node.name}, ${props}, ${JSON.stringify(path)}, "client:load")}`;
```

À corriger pour propager la stratégie réelle :

```ts
return `\${await island(${node.name}, ${props}, ${JSON.stringify(path)}, ${JSON.stringify(node.strategy!)})}`;
```

Les tests du parser et du generator sont à étendre pour couvrir `client:idle`
et `client:visible`. Aucun changement de surface API publique du compilateur.

## 9. Stratégie de tests

Tests TDD, identiques à la discipline du sous-projet 1.

### 9.1. Quatre niveaux

| Niveau | Outil | Couvre |
|---|---|---|
| **Scanner** (unit) | Vitest + happy-dom | Parsing des attributs, sélecteur correct, gestion de `:not([data-hydrated])`. |
| **Strategies** (unit) | Vitest, fake-timers, mock de `IntersectionObserver` et `requestIdleCallback` | Chaque stratégie déclenche son callback au bon moment ; fallback Safari pour `idle`. |
| **Hydrator** (unit) | Vitest + happy-dom, mock de `import()` via injection | Flux complet : parse → schedule → import → mount → marquage. Tous les chemins d'erreur. Hook `onError` + event `bangala:island-error`. |
| **Integration** (e2e) | Vitest + happy-dom, **vrais modules** dans `tests/client/fixtures/` via dynamic-import | Un îlot complet (`Counter-island.ts`) qui s'hydrate dans un DOM happy-dom. |

### 9.2. Patterns techniques à documenter

- **Mock d'`IntersectionObserver`** : happy-dom ne l'implémente pas. Le pattern
  Vitest standard est `global.IntersectionObserver = vi.fn(() => ({ observe: spy, disconnect: spy }))` avec déclenchement manuel du callback.
- **Mock de `requestIdleCallback`** : non implémenté dans happy-dom. On y
  injecte un stub.
- **Dynamic-import dans Vitest** : Vitest gère nativement `import()` dans
  happy-dom. Les fixtures sont des fichiers `.ts` réels — pas de mock,
  réutilisation du pattern `compileAndRender` du sous-projet 1.

### 9.3. Couverture cible

- 100 % des codes d'erreur de la section 4.4 sont déclenchés au moins une
  fois dans les tests.
- Les trois stratégies sont testées en isolement et en intégration.
- Un test e2e couvre le chemin nominal complet (DOM SSR → scan → import →
  mount → assertion sur l'état post-hydratation).

## 10. Périmètre de la v1

### 10.1. Inclus

| Feature | Détail |
|---|---|
| API `hydrate(root?, options?)` | Exportée + auto-start dans le navigateur. |
| `data-hydrated` à trois valeurs | `"scheduled"` → `"true"` ou `"error"`. |
| Stratégies `load`, `idle`, `visible` | Avec fallback Safari pour `idle`. |
| Contrat `mount(el, props, ctx)` | `ctx = { strategy, entry }`. |
| Gestion d'erreurs | `console.error` + `data-hydration-error` + callback `onError` + event `bangala:island-error`. |
| Idempotence | Garantie par `data-hydrated`. |
| Tests | 4 niveaux, TDD strict. |
| Extension compilateur | Section 8 — accepter `client:idle` et `client:visible`. |

### 10.2. Exclu (repoussé)

| Repoussé | Où / pourquoi |
|---|---|
| `observe()` comme alias public | v2 — `hydrate(root)` suffit pour les contenus dynamiques en v1. |
| `client:media` | v2 — pas de demande, peut être ajouté trivialement plus tard. |
| MutationObserver auto-hydratation | v2 — coûteux par défaut, mieux en opt-in plus tard. |
| Cleanup/unmount triggers | v2, utile pour HMR (sous-projet 4). |
| Résolution d'URL côté runtime | jamais — c'est le sous-projet 4. |
| Cache de modules importés | inutile — `import()` cache nativement par URL. |
| API d'options sur l'auto-start | v2 — passer des options à l'auto-start nécessite un mécanisme (script tag dataset, global flag) qui n'est pas justifié pour la v1. |

## 11. Critères de succès

Le sous-projet 2 est terminé quand :

1. Le sous-chemin `bangala/client` est exporté et importable.
2. L'extension compilateur (section 8) est livrée, et le parser accepte
   `client:load`, `client:idle`, `client:visible`.
3. Une page contenant des `<bangala-island>` avec les trois stratégies voit
   ses îlots s'hydrater au bon moment dans Chromium, Firefox, et Safari 14+.
4. Tous les chemins d'erreur de la section 4.4 sont déclenchables et observables
   (DOM + callback + event).
5. Les tests des quatre niveaux passent ; un test e2e vérifie un îlot réel
   s'hydratant via dynamic-import dans happy-dom.
6. Le runtime minifié pèse moins de **2 KB** (gzip). Ce n'est pas un objectif
   strict, c'est un canari : si on dépasse, c'est qu'on a glissé hors du
   périmètre "loader minimal".

## 12. Questions ouvertes

Aucune. Le périmètre, l'API, l'architecture, et les changements requis sur le
compilateur sont validés. Le sous-projet 3 (routing par fichiers) sera spécifié
dans un document distinct.
