// Fast-suite setup. Do not load .env here: npm test must not touch
// database credentials or instantiate DB state. Tests that need .env
// belong in the explicit DB or migration suites.

process.env.EXECOS_TEST_EMBEDDINGS = "1";
