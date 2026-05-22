# Contributing to bangala.js

Thanks for your interest in bangala.js. The project is in its **design phase**,
so right now the most valuable contributions are feedback on the architecture
and the specs — not pull requests with code.

## Where the project stands

bangala.js is built as five sub-projects (see the [README roadmap](./README.md)).
Sub-project 1, the `.bangala` compiler, is fully designed in
[`docs/superpowers/specs/2026-05-22-bangala-compiler-design.md`](./docs/superpowers/specs/2026-05-22-bangala-compiler-design.md)
and is the only one being implemented today.

## How to contribute right now

- **Read the spec and challenge it.** Open an issue if a decision seems wrong,
  ambiguous, or under-scoped. The design is still cheap to change.
- **Discuss use cases.** Tell us what you'd build with an islands-first
  framework and where the current design would get in your way.
- **File bugs and feature requests** through the issue templates.

## How to contribute code (once implementation starts)

1. Open or comment on an issue first — align on the approach before writing
   code.
2. Fork the repo and create a branch from `main`.
3. The codebase is **TypeScript, ESM, Node 24**. Tests run on **Vitest**.
4. bangala.js is built with **test-driven development**: write a failing test,
   make it pass, refactor. PRs without tests will be asked to add them.
5. Keep changes focused. One concern per pull request.
6. Open a pull request against `main` and fill in the template.

## Code of Conduct

All participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
