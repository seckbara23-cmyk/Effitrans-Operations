// Test stub: in the Node (vitest) environment the real `server-only` package
// throws (it guards against client-bundle imports). Aliased here so server-only
// modules with pure, testable logic (e.g. provider signature + mock) can be
// unit-tested. Does not weaken the production boundary — the client-bundle grep
// gate still enforces server-only isolation in the real build.
export {};
