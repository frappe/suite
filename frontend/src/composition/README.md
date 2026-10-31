Composition wires products into the shell. It may import `@/shell`,
`@/platform` and product package roots (`@/apps/<product>`) only.
Owned by work package W2-shell; Home by W3-home. See
`wayfinder/unified-frontend/IMPLEMENTATION.md`.

## API assembly

`api.ts` assembles lightweight generated owner catalogs and creates the shared
client. It registers owner policies through lazy imports. Product-neutral
session and theme modules receive their ordinary API callbacks here.

Products import ordinary calls from `@/api`. An editor receives Drive's
credential context through its public document session. Its ordinary document
calls use the same engine, with the context's opaque access partition.
