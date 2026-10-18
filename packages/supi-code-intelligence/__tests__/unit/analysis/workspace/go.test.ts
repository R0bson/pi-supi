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

describe("observeWorkspace Go declarations", () => {
  it("does not manufacture names by stripping unsupported string escapes", async () => {
    const root = makeWorkspace();
    write(root, "go.mod", ['module "example.com/' + "\\x61" + 'pi"', ""].join("\n"));
    const result = await observeWorkspace(root);
    expect(result.projects).toHaveLength(0);
    expect(result.metadata.issues.some((entry) => entry.reason.includes("escape"))).toBe(true);
  });

  it("parses comments immediately after an unquoted module name", async () => {
    const root = makeWorkspace();
    write(root, "go.mod", "module example.com/api// comment\n");
    const result = await observeWorkspace(root);
    expect(result.projects[0]?.name).toBe("example.com/api");
  });

  it("parses module, require, replace, and go.work use directives with real grammar", async () => {
    const root = makeWorkspace();
    write(
      root,
      "go.mod",
      [
        'module "example.com/root"',
        "",
        "/* block comment",
        "   across lines */",
        "go 1.23",
        "",
        "require (",
        "  example.com/lib v1.0.0",
        '  "example.com/quoted" v1.2.3',
        ")",
        "require example.com/other v0.1.0",
        "replace example.com/old => ./libs/old",
        "",
      ].join("\n"),
    );
    write(
      root,
      "go.work",
      [
        "go 1.23",
        "",
        "use (",
        "  ./libs/lib",
        "  ./libs/standalone",
        "  ./libs/missing",
        ")",
        "",
      ].join("\n"),
    );
    write(root, "libs/lib/go.mod", "module example.com/lib\n\ngo 1.23\n");
    write(root, "libs/quoted/go.mod", "module example.com/quoted\n\ngo 1.23\n");
    write(root, "libs/standalone/go.mod", "module example.com/standalone\n\ngo 1.23\n");

    const result = await observeWorkspace(root);
    const rootModule = projectNamed(result, "example.com/root");
    const lib = projectNamed(result, "example.com/lib");
    const standalone = projectNamed(result, "example.com/standalone");

    expect(rootModule).toMatchObject({
      id: "go.mod",
      kind: "go-module",
      directory: ".",
      nameField: "module",
      description: null,
      descriptionField: null,
      memberships: [],
    });
    expect(rootModule?.dependencies).toEqual([
      { field: "require", name: "example.com/lib", value: "v1.0.0" },
      { field: "require", name: "example.com/quoted", value: "v1.2.3" },
      { field: "require", name: "example.com/other", value: "v0.1.0" },
    ]);
    expect(lib?.memberships).toEqual([
      {
        kind: "go-work",
        manifestPath: "go.work",
        field: "use",
        value: "./libs/lib",
      },
    ]);
    expect(standalone?.memberships).toEqual([
      {
        kind: "go-work",
        manifestPath: "go.work",
        field: "use",
        value: "./libs/standalone",
      },
    ]);
    expect(result.relationships).toEqual([
      {
        from: "go.mod",
        to: "libs/lib/go.mod",
        manifestPath: "go.mod",
        field: "require",
        value: "v1.0.0",
      },
      {
        from: "go.mod",
        to: "libs/quoted/go.mod",
        manifestPath: "go.mod",
        field: "require",
        value: "v1.2.3",
      },
    ]);
    expect(result.metadata.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "go.mod", field: "replace", kind: "unsupported" }),
        expect.objectContaining({ path: "go.work", field: "use", kind: "unresolved" }),
      ]),
    );
    expect(result.collection.status).toBe("partial");
  });

  it("keeps valid module and require facts when other directives are malformed or unsupported", async () => {
    const root = makeWorkspace();
    write(
      root,
      "go.mod",
      [
        "module example.com/broken",
        "require example.com/ok v1.0.0",
        "require example.com/missing",
        "garbage directive thing",
        "",
      ].join("\n"),
    );

    const result = await observeWorkspace(root);
    const project = projectNamed(result, "example.com/broken");

    expect(project?.dependencies).toEqual([
      { field: "require", name: "example.com/ok", value: "v1.0.0" },
    ]);
    expect(result.metadata.documents).toContainEqual(
      expect.objectContaining({ path: "go.mod", kind: "go-mod", status: "parsed" }),
    );
    expect(result.metadata.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "go.mod", field: "require line 3", kind: "malformed" }),
        expect.objectContaining({ path: "go.mod", field: "garbage", kind: "unsupported" }),
      ]),
    );
    expect(result.collection.status).toBe("partial");
  });
});
