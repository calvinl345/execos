/**
 * dependency-cruiser configuration — ALL module-topology rules, centralized.
 *
 * Every rule name here is an enforcement link in architecture/constitution.md;
 * the constitution sync test (architecture/tests/conventions.test.ts) fails if
 * a rule disappears or a constitution link points at a rule that does not
 * exist. Do not rename or delete rules without amending the constitution
 * through the RATIFY procedure.
 *
 * Known limitation: dependency-cruiser does not parse .svelte files, so for
 * R3 the .svelte half of src/web is covered by the ESLint
 * no-restricted-imports rule in .eslintrc.json (verified present by the
 * constitution sync test). The .ts half (queries, +page.server, +server) is
 * covered here.
 */
module.exports = {
  forbidden: [
    {
      // R1 — src/domain is pure: no runtime imports from any other layer.
      // Type-only imports of row shapes are erased at compile time and are
      // tolerated (see decisions/001-domain-purity.md).
      name: "domain-is-pure",
      severity: "error",
      comment:
        "R1: src/domain imports nothing (at runtime) from db, cli, web, embeddings, or services.",
      from: { path: "^src/domain" },
      to: {
        path: "^src/(db|cli|web|embeddings|services)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      // R1 — src/domain performs no I/O: no node I/O builtins, no DB or
      // embedding provider packages.
      name: "domain-no-io",
      severity: "error",
      comment:
        "R1: src/domain performs no I/O (no fs/net/child_process, no postgres/supabase/drizzle runtime deps).",
      from: { path: "^src/domain" },
      to: {
        path: "^(node:)?(fs|child_process|net|http|https|http2|dns|tls|worker_threads|cluster)(/|$)|^(postgres|@supabase|drizzle-orm)(/|$)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      // R3 — src/web never touches the service-role DB client.
      name: "web-anon-client-only",
      severity: "error",
      comment:
        "R3: src/web reads through the anon client under RLS only; the service-role client (src/db/index) is forbidden.",
      from: { path: "^src/web" },
      to: { path: "^src/db/index\\.(js|ts)$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // No includeOnly: the domain-no-io rule must see dependencies whose
    // targets live outside src (node builtins, npm packages).
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
