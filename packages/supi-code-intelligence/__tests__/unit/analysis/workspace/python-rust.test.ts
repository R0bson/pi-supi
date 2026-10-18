import { afterEach, describe, expect, it } from "vitest";
import { observeWorkspace } from "../../../../src/analysis/workspace/index.ts";
import { cleanupWorkspaces, makeWorkspace, write } from "./helpers.ts";

afterEach(cleanupWorkspaces);

function projectNamed(
  result: Awaited<ReturnType<typeof observeWorkspace>>,
  name: string,
): (typeof result.projects)[number] | undefined {
  return result.projects.find((project) => project.name === name);
}

describe("observeWorkspace Python declarations", () => {
  it("reads project identity, description, dependencies, and unique local relationships", async () => {
    const root = makeWorkspace();
    write(
      root,
      "services/api/pyproject.toml",
      [
        "[project]",
        'name = "atlas-api"',
        'description = "Atlas data service."',
        // biome-ignore lint/security/noSecrets: dependency fixture, not a secret
        'dependencies = ["requests>=2", "Shared_Lib[extra]>=1"]',
        "",
        "[project.optional-dependencies]",
        // biome-ignore lint/security/noSecrets: dependency fixture, not a secret
        'test = ["pytest>=8"]',
        "",
      ].join("\n"),
    );
    write(
      root,
      "services/protocol/pyproject.toml",
      ["[project]", 'name = "shared-lib"', 'description = "Shared request types."', ""].join("\n"),
    );

    const result = await observeWorkspace(root);
    const api = projectNamed(result, "atlas-api");
    const protocol = projectNamed(result, "shared-lib");

    expect(result.collection.status).toBe("complete");
    expect(api).toMatchObject({
      id: "services/api/pyproject.toml",
      kind: "python-project",
      directory: "services/api",
      nameField: "project.name",
      description: "Atlas data service.",
      descriptionField: "project.description",
      memberships: [],
    });
    expect(api?.dependencies).toEqual([
      { field: "project.dependencies", name: "requests", value: "requests>=2" },
      // biome-ignore lint/security/noSecrets: dependency fixture, not a secret
      { field: "project.dependencies", name: "Shared_Lib", value: "Shared_Lib[extra]>=1" },
      { field: "project.optional-dependencies.test", name: "pytest", value: "pytest>=8" },
    ]);
    expect(result.relationships).toEqual([
      {
        from: "services/api/pyproject.toml",
        to: "services/protocol/pyproject.toml",
        manifestPath: "services/api/pyproject.toml",
        field: "project.dependencies",
        // biome-ignore lint/security/noSecrets: dependency fixture, not a secret
        value: "Shared_Lib[extra]>=1",
      },
    ]);
    expect(protocol?.memberships).toEqual([]);
  });

  it("discloses dynamic project metadata without dropping the static identity", async () => {
    const root = makeWorkspace();
    write(
      root,
      "pyproject.toml",
      [
        "[project]",
        'name = "dynamic-project"',
        'dynamic = ["description", "dependencies"]',
        "",
      ].join("\n"),
    );

    const result = await observeWorkspace(root);

    expect(projectNamed(result, "dynamic-project")).toMatchObject({
      description: null,
      descriptionField: null,
    });
    expect(result.metadata.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "project.dynamic", kind: "dynamic" }),
      ]),
    );
    expect(result.collection.status).toBe("partial");
  });
});

describe("observeWorkspace Rust declarations", () => {
  it("reads Cargo packages, explicit workspace membership, paths, dependencies, and inheritance limits", async () => {
    const root = makeWorkspace();
    write(
      root,
      "Cargo.toml",
      [
        "[workspace]",
        'members = ["crates/*"]',
        'exclude = ["crates/skip"]',
        "",
        "[workspace.dependencies]",
        'serde = "1"',
        "",
      ].join("\n"),
    );
    write(
      root,
      "crates/a/Cargo.toml",
      [
        "[package]",
        'name = "crate-a"',
        'description = "A crate."',
        'build = "build.rs"',
        "",
        "[dependencies]",
        'crate-b = { path = "../b" }',
        "serde = { workspace = true }",
        "",
        "[lib]",
        'path = "src/lib.rs"',
        "",
        "[[bin]]",
        'name = "a"',
        'path = "src/main.rs"',
        "",
      ].join("\n"),
    );
    write(
      root,
      "crates/b/Cargo.toml",
      ["[package]", 'name = "crate-b"', 'description = "B crate."', ""].join("\n"),
    );
    write(root, "crates/skip/Cargo.toml", ["[package]", 'name = "crate-skip"', ""].join("\n"));
    write(
      root,
      "other/unlisted/Cargo.toml",
      ["[package]", 'name = "crate-unlisted"', ""].join("\n"),
    );

    const result = await observeWorkspace(root);
    expect(result).toMatchObject({
      workspaces: [
        {
          manifestPath: "Cargo.toml",
          field: "workspace.members",
          patterns: ["crates/*"],
          excludeField: "workspace.exclude",
          excludes: ["crates/skip"],
        },
      ],
    });
    const crateA = projectNamed(result, "crate-a");
    const skip = projectNamed(result, "crate-skip");
    const unlisted = projectNamed(result, "crate-unlisted");

    expect(crateA).toMatchObject({
      id: "crates/a/Cargo.toml",
      kind: "rust-package",
      directory: "crates/a",
      nameField: "package.name",
      description: "A crate.",
      descriptionField: "package.description",
    });
    expect(crateA?.memberships).toEqual([
      {
        kind: "cargo-workspace",
        manifestPath: "Cargo.toml",
        field: "workspace.members",
        value: "crates/*",
      },
    ]);
    expect(crateA?.declaredPaths).toEqual(
      expect.arrayContaining([
        { field: "lib.path", path: "src/lib.rs" },
        { field: "package.build", path: "build.rs" },
        { field: "bin[0].path", path: "src/main.rs" },
      ]),
    );
    expect(crateA?.dependencies).toEqual([
      { field: "dependencies", name: "crate-b", value: { path: "../b" } },
      { field: "dependencies", name: "serde", value: { workspace: true } },
    ]);
    expect(result.relationships).toEqual([
      {
        from: "crates/a/Cargo.toml",
        to: "crates/b/Cargo.toml",
        manifestPath: "crates/a/Cargo.toml",
        field: "dependencies",
        value: { path: "../b" },
      },
    ]);
    expect(skip?.memberships).toEqual([]);
    expect(unlisted?.memberships).toEqual([]);
    expect(result.metadata.issues).toContainEqual(
      expect.objectContaining({
        path: "crates/a/Cargo.toml",
        field: "dependencies.serde",
        kind: "inherited",
      }),
    );
    expect(result.collection.status).toBe("partial");
  });
});
