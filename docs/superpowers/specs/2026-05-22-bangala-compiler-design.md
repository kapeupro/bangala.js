# bangala.js — Sous-projet 1 : le compilateur `.bangala` + rendu serveur

> Document de design. Statut : **en attente de relecture utilisateur**.
> Date : 2026-05-22.

## 1. Contexte

### 1.1. La vision bangala.js

bangala.js est un **framework full-stack JavaScript** destiné à être publié en
open-source, positionné comme concurrent de Next.js.

Son angle d'attaque unique : **envoyer le minimum de JavaScript au client.**
Là où les frameworks à base de Server Components envoient encore un runtime
important, bangala.js part du HTML statique et ne charge du JavaScript que pour
les composants explicitement marqués comme interactifs.

Choix fondateurs (validés en brainstorming) :

- **Architecture islands** — la page est du HTML statique ; les composants
  interactifs sont des « îlots » hydratés indépendamment.
- **Format de fichier propre `.bangala`** — du HTML enrichi d'expressions JS,
  avec un compilateur maison.
- **Stratégie compile-to-module** — chaque `.bangala` est compilé en un module
  ESM standard exportant une fonction `render()`.

### 1.2. Découpage du framework

bangala.js est trop vaste pour une seule spec. Il est découpé en 5 sous-projets,
chacun avec son propre cycle spec → plan → implémentation :

| # | Sous-projet | Rôle |
|---|---|---|
| **1** | **Compilateur `.bangala` + rendu serveur** | **Ce document.** Parse un `.bangala`, le rend en HTML serveur, repère les îlots. |
| 2 | Runtime d'îlots côté client | Le JS qui trouve les îlots dans le DOM et les rend interactifs. |
| 3 | Routing par fichiers | Dossier `routes/` → URLs, params, layouts. |
| 4 | Dev server + build | Basé sur Vite, avec HMR. |
| 5 | CLI + scaffolding + adapters de déploiement | `bangala dev`, `bangala build`, `create-bangala`. |

Le sous-projet 1 est spécifié en premier car c'est le seul morceau testable de
façon totalement isolée (entrée = un fichier `.bangala`, sortie = une string
HTML + un manifeste d'îlots). Son contrat de sortie verrouille les interfaces
que consommeront les sous-projets 2 à 4.

### 1.3. Périmètre de ce document

Ce document spécifie **uniquement le sous-projet 1**. Les sous-projets 2 à 5
seront spécifiés séparément.

## 2. Le format de fichier `.bangala`

Un fichier `.bangala` est **HTML-first** : du HTML enrichi d'expressions JS.

Principe fondateur :

> **Un composant ne rend aucun JavaScript par défaut. Il faut explicitement le
> marquer comme îlot (`client:load`) pour qu'il en envoie au client.**

### 2.1. Exemple de référence

`routes/index.bangala` :

```bangala
---
// Frontmatter : code SERVEUR, exécuté une fois au rendu. async autorisé.
import Layout from "../components/Layout.bangala"
import Counter from "../components/Counter.bangala"

const { user } = props
const posts = await fetch("https://api.exemple.com/posts").then(r => r.json())
---

<Layout title="Accueil">
  <h1>Bonjour {user.name}</h1>

  {#if posts.length === 0}
    <p>Aucun article pour l'instant.</p>
  {:else}
    <ul>
      {#each posts as post}
        <li>{post.title}</li>
      {/each}
    </ul>
  {/if}

  <Counter start={10} client:load />
</Layout>
```

### 2.2. Règles du format

| Élément | Rôle |
|---|---|
| `---` ... `---` | Frontmatter : JS/TS serveur, exécuté au rendu. `props` disponible. `await` autorisé. Optionnel. |
| `{expression}` | Interpolation. **Échappement HTML automatique** (anti-XSS). |
| `{#if cond}` / `{:else}` / `{/if}` | Conditionnel. `{:else}` optionnel. |
| `{#each list as item}` / `{/each}` | Boucle sur un itérable. |
| `<Capitalisé />` | Composant : un autre `.bangala` importé dans le frontmatter. Première lettre majuscule. |
| `<balise>` | Élément HTML standard (minuscule). |
| `attr={expression}` | Attribut dynamique. `attr="texte"` reste statique. |
| `<slot/>` | Emplacement où un composant insère ses enfants. Un seul slot par défaut en v1. |
| `client:load` | Directive sur un composant : le marque comme **îlot**. Seul cas où du JS part au client. |

### 2.3. Décisions de syntaxe

- **Blocs `{#if}` / `{#each}` (style Svelte)** plutôt qu'expressions JSX
  (`{cond && ...}`) : `.bangala` est HTML-first, des balises de bloc explicites
  se lisent mieux au milieu de HTML et se parsent de façon plus fiable.
- **Le JS dans les `{}` n'est pas parsé** par le compilateur. Il est capturé
  comme une string opaque et émis tel quel dans le code généré. Le parser
  maison ne gère que la *structure* (HTML + blocs) ; esbuild s'occupe du JS.

## 3. Architecture du compilateur

Le compilateur expose une fonction `compile(source, options)` qui transforme une
string `.bangala` en module ESM, via un pipeline en 3 étapes.

```
fichier .bangala
      │
      ▼
┌─────────────┐   1. PARSE
│   Parser    │   HTML + {expr} + blocs {#if}/{#each} → AST
└─────────────┘   (le JS dans les {} = string opaque, non parsé)
      │
      ▼   AST : Frontmatter, Element, Component, Text,
      │         Expression, IfBlock, EachBlock, Island, Slot
┌─────────────┐   2. ANALYZE
│  Analyzer   │   résout les composants importés, repère les îlots
└─────────────┘   (directive client:*), valide la structure
      │
      ▼
┌─────────────┐   3. CODEGEN
│  Generator  │   émet un module ESM : render() en template literals
└─────────────┘
      │
      ▼
CompileResult { code, islands, dependencies }
```

### 3.1. Étape 1 — Parser

Parser maison qui produit un AST. Types de nœuds :

- `Frontmatter` — le bloc `---` (string JS/TS opaque).
- `Element` — balise HTML, avec attributs et enfants.
- `Component` — balise capitalisée, avec attributs (props) et enfants (slot).
- `Island` — un `Component` portant une directive `client:*`.
- `Text` — texte statique.
- `Expression` — `{...}` (string JS opaque).
- `IfBlock` — `{#if}` avec branche `then` et branche `else` optionnelle.
- `EachBlock` — `{#each list as item}` avec corps.
- `Slot` — `<slot/>`.

Le parser lève des erreurs claires et localisées (ligne/colonne) : bloc non
fermé, `{:else}` hors d'un `{#if}`, etc.

### 3.2. Étape 2 — Analyzer

- Résout les composants : une balise capitalisée doit correspondre à un import
  du frontmatter, sinon erreur.
- Repère les îlots : un `Component` avec `client:load` devient un `Island`.
- Validation structurelle (slot unique, etc.).

### 3.3. Étape 3 — Codegen

Émet un module ESM. La fonction `render()` est construite par **concaténation de
template literals** (pas de Virtual DOM, pas d'appels `h()`) — l'opération SSR
la plus rapide possible.

Les imports de composants sont réécrits : un specifier en `.bangala`
(`"../components/Layout.bangala"`) devient `.js` dans le module généré, car le
module compilé importe d'autres modules compilés. Les imports non-`.bangala`
(librairies, modules JS/TS) sont laissés intacts.

Exemple de sortie pour `routes/index.bangala` :

```js
import { escape, renderComponent, island } from "bangala/runtime";
import Layout from "../components/Layout.js";
import Counter from "../components/Counter.js";

export async function render(props) {
  const { user } = props;
  const posts = await fetch("https://api.exemple.com/posts").then(r => r.json());

  return renderComponent(Layout, { title: "Accueil" }, async () => `
    <h1>Bonjour ${escape(user.name)}</h1>
    ${posts.length === 0
      ? `<p>Aucun article pour l'instant.</p>`
      : `<ul>${posts.map(post => `<li>${escape(post.title)}</li>`).join("")}</ul>`
    }
    ${await island(Counter, { start: 10 }, "client:load")}
  `);
}
```

### 3.4. Le runtime serveur `bangala/runtime`

Mini-librairie de helpers que le code généré importe :

| Helper | Signature | Rôle |
|---|---|---|
| `escape` | `(value: unknown) => string` | Échappement HTML des caractères `& < > " '`. |
| `renderComponent` | `(Comp, props, children?) => Promise<string>` | Invoque le `render()` d'un composant ; `children` alimente son `<slot/>`. |
| `island` | `(Comp, props, strategy) => Promise<string>` | Rend l'HTML SSR de l'îlot et l'emballe dans un marqueur `<bangala-island>`. |

## 4. Contrat de sortie

Ce contrat est consommé par les sous-projets 2, 3 et 4. Il est stable.

### 4.1. Résultat de compilation

```ts
interface CompileResult {
  code: string;            // le module ESM généré
  islands: IslandRef[];    // les îlots repérés dans ce fichier
  dependencies: string[];  // chemins des .bangala importés (pour le watch)
}

interface IslandRef {
  componentPath: string;          // ex: "../components/Counter.bangala"
  strategy: "client:load";        // v1 : une seule stratégie
}

interface CompileOptions {
  filename: string;               // pour les messages d'erreur et les chemins
}
```

### 4.2. Module compilé

Le module généré exporte :

```ts
export function render(props: Record<string, unknown>): Promise<string>;
```

### 4.3. Le marqueur d'îlot

Quand `render()` croise un îlot, il l'emballe dans un élément-marqueur :

```html
<bangala-island
  data-entry="components/Counter"
  data-props='{"start":10}'
  data-strategy="load">
  <!-- HTML SSR de l'îlot, visible immédiatement, zéro JS -->
  <button>Compteur : 10</button>
</bangala-island>
```

| Attribut | Contenu |
|---|---|
| `data-entry` | Identifiant du module client de l'îlot (chemin sans extension). |
| `data-props` | Props sérialisées en JSON (échappées pour un attribut HTML). |
| `data-strategy` | Stratégie d'hydratation (`load` en v1). |

Ces 4 éléments (la balise + 3 attributs) sont la **frontière de contrat** entre
les sous-projets :

- Sous-projet 1 : **écrit** ces balises.
- Sous-projet 2 : les **cherche** dans le DOM et hydrate leur contenu.
- Sous-projet 4 : lit `data-entry` pour savoir quels modules bundler.

Tant que ce contrat ne bouge pas, les sous-projets évoluent indépendamment.

### 4.4. Périmètre d'interactivité (hors-scope)

Le sous-projet 1 produit le marqueur et l'HTML SSR à l'intérieur. Il **ne rend
pas l'îlot interactif** : aucun `<script>` n'est émis, l'îlot ne réagit pas
encore aux interactions. L'hydratation est le sous-projet 2. Cela garde le
sous-projet 1 testable à 100 % comme une transformation pure `string → string`.

## 5. Périmètre de la v1

### 5.1. Inclus

- Frontmatter `---` : JS/TS serveur, `props` disponible, `await` autorisé.
- Texte + interpolation `{expression}` avec échappement HTML automatique.
- Éléments HTML avec attributs statiques et dynamiques.
- `{#if}` / `{:else}` / `{/if}`.
- `{#each list as item}` / `{/each}`.
- Composition de composants : import, usage `<Comp prop={x}>`, un `<slot/>`
  par défaut.
- Directive `client:load` → marqueur `<bangala-island>`.
- Sortie : `CompileResult` (module ESM + manifeste d'îlots).

### 5.2. Exclu (repoussé)

| Repoussé | Où / pourquoi |
|---|---|
| `client:visible`, `client:idle` | v2 du compilateur — `client:load` prouve déjà le mécanisme. |
| Hydratation réelle des îlots | Sous-projet 2. |
| Blocs `<script>` / `<style>` + CSS scopé | v2 du compilateur. |
| Slots nommés (multi-slots) | v2 — un slot par défaut suffit pour valider la composition. |
| HMR, source maps | Sous-projet 4 (dev server). |
| Type-checking du TypeScript | Hors-scope permanent : on **transpile** le TS (esbuild efface les types), on ne le **vérifie** pas — c'est le rôle de `tsc` / l'IDE. |
| `create-bangala`, CLI | Sous-projet 5. |

## 6. Stratégie de tests

Le compilateur est construit en **TDD** : test qui échoue → code minimal →
refactor.

### 6.1. Socle technique

| Choix | Détail |
|---|---|
| Langage | TypeScript, ESM, Node 24 LTS. |
| Runner de tests | Vitest — rapide, natif TS/ESM, snapshots intégrés. |
| Transpilation | esbuild (TS → JS du module généré). |
| Paquet | `bangala` — un seul paquet pour le sous-projet 1. |

### 6.2. Trois niveaux de tests

1. **Tests du parser** — `source .bangala → AST attendu`. Vérifient la
   structure et les erreurs claires (bloc non fermé, `{:else}` orphelin…).
2. **Tests de codegen** — `AST → code généré`, en **snapshots** : toute
   évolution de la sortie devient visible en revue.
3. **Tests de rendu (filet de sécurité principal)** — `compile() → exécuter
   render(props) → assert sur la string HTML`. Cas couverts :
   - Interpolation + échappement : `{user.name}` avec `name = "<script>"` →
     `&lt;script&gt;`.
   - `{#if}` / `{:else}` dans les deux branches.
   - `{#each}` sur liste vide et non-vide.
   - Composition : composant rendant un autre composant, avec slot.
   - Îlot : `<Counter client:load />` → `<bangala-island>` avec les 3
     attributs et les props sérialisées en JSON.

Les snapshots détectent *que* la sortie a changé ; les tests de rendu valident
*si elle est correcte*. Les tests de rendu sont donc le filet principal, les
snapshots un complément de lisibilité en revue.

## 7. Critères de succès

Le sous-projet 1 est terminé quand :

1. `compile(source, { filename })` renvoie un `CompileResult` conforme à la
   section 4 pour tous les éléments de syntaxe de la section 5.1.
2. Le module compilé, exécuté, produit l'HTML attendu — y compris l'échappement
   anti-XSS et les marqueurs `<bangala-island>` corrects.
3. Les erreurs de syntaxe produisent des messages localisés (ligne/colonne).
4. Les trois niveaux de tests passent ; les cas de la section 6.2 sont couverts.
5. L'exemple de référence (section 2.1) compile et rend sans erreur.

## 8. Questions ouvertes

Aucune. Le périmètre, le format, l'architecture et le contrat de sortie sont
validés. Les sous-projets 2 à 5 seront spécifiés dans des documents distincts.
