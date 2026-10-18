import { afterEach, describe, expect, it } from "vitest";
import { observeWorkspace } from "../../../../src/analysis/workspace/index.ts";
import { cleanupWorkspaces, makeWorkspace, write, writeJson } from "./helpers.ts";

afterEach(cleanupWorkspaces);

function projectNamed(
  result: Awaited<ReturnType<typeof observeWorkspace>>,
  name: string,
): (typeof result.projects)[number] | undefined {
  return result.projects.find((project) => project.name === name);
}

describe("observeWorkspace Node declarations", () => {
  it("preserves manifest paths, memberships, declared paths, dependency fields, and relationships", async () => {
    const root = makeWorkspace();
    writeJson(root, "package.json", {
      name: "@test/root",
      description: "Root package",
      main: "src/index.ts",
      module: "src/module.ts",
      exports: { ".": "./src/api.ts", "./cli": { import: "./src/cli.ts" } },
      bin: { root: "./bin/root.js" },
      workspaces: { packages: ["packages/*"] },
      pi: { extensions: ["./src/extension.ts"] },
    });
    writeJson(root, "packages/core/package.json", {
      name: "@test/core",
      description: "Shared core",
    });
    writeJson(root, "packages/app/package.json", {
      name: "@test/app",
      description: "Application",
      dependencies: { "@test/core": "workspace:*" },
      devDependencies: { "@test/core": "workspace:*" },
    });

    const result = await observeWorkspace(root);
    const app = projectNamed(result, "@test/app");
    const core = projectNamed(result, "@test/core");
    const rootProject = projectNamed(result, "@test/root");

    expect(result.collection.status).toBe("complete");
    expect(result.projects.map((project) => project.kind)).toEqual([
      "node-package",
      "node-package",
      "node-package",
    ]);
    expect(rootProject).toMatchObject({
      id: "package.json",
      manifestPath: "package.json",
      directory: ".",
      nameField: "name",
      description: "Root package",
      descriptionField: "description",
    });
    expect(rootProject?.declaredPaths).toEqual(
      expect.arrayContaining([
        { field: "main", path: "src/index.ts" },
        { field: "module", path: "src/module.ts" },
        { field: 'exports["."]', path: "./src/api.ts" },
        { field: 'exports["./cli"].import', path: "./src/cli.ts" },
        { field: "bin.root", path: "./bin/root.js" },
        { field: "pi.extensions[0]", path: "./src/extension.ts" },
      ]),
    );
    expect(app?.memberships).toEqual([
      {
        kind: "node-workspace",
        manifestPath: "package.json",
        field: "workspaces.packages",
        value: "packages/*",
      },
    ]);
    expect(core?.memberships).toHaveLength(1);
    expect(rootProject?.memberships).toEqual([]);
    expect(app?.dependencies).toEqual([
      { field: "dependencies", name: "@test/core", value: "workspace:*" },
      { field: "devDependencies", name: "@test/core", value: "workspace:*" },
    ]);
    expect(result.relationships).toEqual([
      {
        from: "packages/app/package.json",
        to: "packages/core/package.json",
        manifestPath: "packages/app/package.json",
        field: "dependencies",
        value: "workspace:*",
      },
      {
        from: "packages/app/package.json",
        to: "packages/core/package.json",
        manifestPath: "packages/app/package.json",
        field: "devDependencies",
        value: "workspace:*",
      },
    ]);
  });

  it("uses pnpm workspace membership and keeps excluded packages as non-members", async () => {
    const root = makeWorkspace();
    writeJson(root, "package.json", { name: "@test/root" });
    write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n  - '!packages/private'\n");
    writeJson(root, "packages/public/package.json", { name: "@test/public" });
    writeJson(root, "packages/private/package.json", { name: "@test/private" });

    const result = await observeWorkspace(root);
    const publicProject = projectNamed(result, "@test/public");
    const privateProject = projectNamed(result, "@test/private");

    expect(publicProject?.memberships).toEqual([
      {
        kind: "node-workspace",
        manifestPath: "pnpm-workspace.yaml",
        field: "packages",
        value: "packages/*",
      },
    ]);
    expect(privateProject).toBeDefined();
    expect(privateProject?.memberships).toEqual([]);
    expect(result.collection.status).toBe("complete");
  });

  it("keeps valid declarations and inventory when one package manifest is malformed", async () => {
    const root = makeWorkspace();
    writeJson(root, "package.json", { name: "@test/root" });
    writeJson(root, "packages/good/package.json", { name: "@test/good" });
    write(root, "packages/bad/package.json", "{ not json");

    const result = await observeWorkspace(root);

    expect(result.projects.map((project) => project.name)).toEqual(["@test/root", "@test/good"]);
    expect(result.inventory.entries.map((entry) => entry.path)).toContain(
      "packages/bad/package.json",
    );
    expect(result.metadata.documents).toContainEqual(
      expect.objectContaining({ path: "packages/bad/package.json", status: "failed" }),
    );
    expect(result.collection).toMatchObject({ status: "partial" });
    expect(result.collection.errors).toContainEqual(
      expect.objectContaining({ stage: "metadata", path: "packages/bad/package.json" }),
    );
  });

  it("does not create a relationship when a declared name has more than one project", async () => {
    const root = makeWorkspace();
    writeJson(root, "package.json", { workspaces: ["packages/*"] });
    writeJson(root, "packages/a/package.json", { name: "duplicate" });
    writeJson(root, "packages/b/package.json", { name: "duplicate" });
    writeJson(root, "packages/app/package.json", {
      name: "consumer",
      dependencies: { duplicate: "workspace:*" },
    });

    const result = await observeWorkspace(root);

    expect(result.relationships).toEqual([]);
  });
});
