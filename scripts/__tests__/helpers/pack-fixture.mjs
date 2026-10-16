import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function writePackage(directory, name, version, extra = {}) {
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name, version, files: ["src"], ...extra }),
  );
  writeFileSync(join(directory, "src/index.js"), "export const value = 1;\n");
}

function linkDependency(directory, name, target) {
  const scope = join(directory, "node_modules/@mrclrchtr");
  mkdirSync(scope, { recursive: true });
  symlinkSync(target, join(scope, name), "dir");
}

/** Create nested workspace bundles with a transitive development-dependency cycle. */
export function makeNestedPackageFixture(parentDir) {
  const app = join(parentDir, "app");
  const child = join(parentDir, "child");
  const leaf = join(parentDir, "leaf");
  writePackage(app, "@mrclrchtr/fixture-app", "1.0.0", {
    dependencies: { "@mrclrchtr/fixture-child": "workspace:*" },
    bundledDependencies: ["@mrclrchtr/fixture-child"],
  });
  writePackage(child, "@mrclrchtr/fixture-child", "2.3.4", {
    dependencies: { "@mrclrchtr/fixture-leaf": "workspace:^" },
    bundledDependencies: ["@mrclrchtr/fixture-leaf"],
  });
  writePackage(leaf, "@mrclrchtr/fixture-leaf", "3.4.5", {
    devDependencies: { "@mrclrchtr/fixture-app": "workspace:*" },
  });
  linkDependency(app, "fixture-child", child);
  linkDependency(child, "fixture-leaf", leaf);
  linkDependency(leaf, "fixture-app", app);
  return app;
}
