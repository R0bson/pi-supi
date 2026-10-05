import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const helper = fileURLToPath(
  new URL("../../.pi/skills/pi-upgrade/scripts/check-pi-version", import.meta.url),
);
const roots = [];
const names = [
  "chord",
  "pi-agent-core",
  "pi-ai",
  "pi-codemode",
  "pi-coding-agent",
  "pi-mcp",
  "pi-telemetry",
  "pi-tui",
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi upgrade "));
  roots.push(root);
  const put = (file, text, mode) => {
    const target = join(root, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text, { mode });
  };
  put(
    "package.json",
    JSON.stringify({ devDependencies: { "@earendil-works/pi-coding-agent": "^1.0.0" } }, null, 2),
  );
  put(
    "packages/ext/package.json",
    JSON.stringify(
      {
        peerDependencies: { "@earendil-works/pi-ai": "*", typebox: "*" },
        devDependencies: { "@earendil-works/pi-tui": "~1.0.0" },
      },
      null,
      2,
    ),
  );
  put(
    "pnpm-workspace.yaml",
    `packages:\n  - 'packages/*'\n# Keep this comment.\noverrides:\n${names.map((name) => `  '@earendil-works/${name}': '1.0.0' # pin`).join("\n")}\n  unrelated: ^3.0.0\nnodeLinker: hoisted\n`,
  );
  put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  put(
    "bin/gh",
    `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv[3] === 'list' ? [{tagName:'v1.1.0'}] : {tagName:'v1.1.0',body:'Test release'}));\n`,
    0o755,
  );
  put(
    "bin/pnpm",
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync('commands', process.argv[2] + '\\n');
if (process.env.FAIL_INSTALL) process.exit(2);
const yaml = fs.readFileSync('pnpm-workspace.yaml', 'utf8');
for (const name of ${JSON.stringify(names)}) {
  const pkg = '@earendil-works/' + name;
  const version = (process.env.STALE_INSTALL || (process.env.STALE_CHORD && name === 'chord')) ? '1.0.0' : yaml.match(new RegExp(pkg + "': '([^']+)"))[1];
  const dir = 'node_modules/' + pkg;
  fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(dir + '/package.json', JSON.stringify({name:pkg,version,dependencies:name === 'pi-coding-agent' ? {'@earendil-works/chord':version} : {}}));
}
`,
    0o755,
  );
  return { root, put };
}

function run(root, args = [], env = {}) {
  const result = spawnSync("bash", [helper, ...args, join(root, "packages/ext/package.json")], {
    cwd: root,
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, ...env },
    encoding: "utf8",
  });
  return { ...result, data: result.stdout.trim() ? JSON.parse(result.stdout) : undefined };
}

const read = (root, file) => readFileSync(join(root, file), "utf8");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Pi upgrade workspace overrides", () => {
  it.each([{ args: [] }, { args: ["--dry-run"] }])("previews without edits: %j", ({ args }) => {
    const { root } = fixture();
    const files = [
      "package.json",
      "packages/ext/package.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
    ];
    const before = files.map((file) => read(root, file));
    const result = run(root, args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.data.currentSource).toBe("workspace-override");
    expect(result.data.applied).toBe(false);
    expect(result.data.updatePackages).toContain("@earendil-works/chord");
    expect(
      result.data.bumpChanges.find((item) => item.file.endsWith(".yaml")).changes,
    ).toHaveLength(8);
    expect(files.map((file) => read(root, file))).toEqual(before);
    expect(() => read(root, "commands")).toThrow();
  });

  it("applies all pins in an isolated workspace and verifies installed versions", () => {
    const { root } = fixture();
    const yaml = read(root, "pnpm-workspace.yaml");
    const result = run(root, ["--apply"]);
    expect(result.status, result.stderr).toBe(0);
    expect(read(root, "pnpm-workspace.yaml")).toBe(yaml.replaceAll("1.0.0", "1.1.0"));
    expect(
      JSON.parse(read(root, "package.json")).devDependencies["@earendil-works/pi-coding-agent"],
    ).toBe("^1.1.0");
    const ext = JSON.parse(read(root, "packages/ext/package.json"));
    expect(ext.devDependencies["@earendil-works/pi-tui"]).toBe("~1.1.0");
    expect(ext.peerDependencies).toEqual({ "@earendil-works/pi-ai": "*", typebox: "*" });
    expect(read(root, "commands")).toBe("install\ndedupe\n");
    expect(result.data.resolvedVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ package: "@earendil-works/chord", version: "1.1.0" }),
      ]),
    );
  });

  it("rejects stale installed versions after a successful install", () => {
    const { root } = fixture();
    const result = run(root, ["--apply"], { STALE_INSTALL: "1" });
    expect(result.status).toBe(1);
    expect(result.data.installExitCode).toBe(1);
    expect(result.data.installOutput).toContain("expected 1.1.0");
  });

  it("rejects a stale transitive chord version", () => {
    const { root } = fixture();
    const result = run(root, ["--apply"], { STALE_CHORD: "1" });
    expect(result.status).toBe(1);
    expect(result.data.installOutput).toContain("Resolved @earendil-works/chord 1.0.0");
  });

  it("does not add overrides when none exist", () => {
    const { root, put } = fixture();
    put("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\nnodeLinker: hoisted\n");
    put(
      "node_modules/@earendil-works/pi-ai/package.json",
      JSON.stringify({ name: "@earendil-works/pi-ai", version: "1.0.0" }),
    );
    const before = read(root, "pnpm-workspace.yaml");
    const result = run(root, ["--dry-run"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.data.bumpChanges.every((item) => item.file.endsWith("package.json"))).toBe(true);
    expect(read(root, "pnpm-workspace.yaml")).toBe(before);
  });

  it("reports install failure", () => {
    const { root } = fixture();
    const result = run(root, ["--apply"], { FAIL_INSTALL: "1" });
    expect(result.status).toBe(2);
    expect(result.data.installExitCode).toBe(2);
  });

  it("stops before edits for unsupported Pi selectors", () => {
    const { root, put } = fixture();
    put(
      "pnpm-workspace.yaml",
      "packages:\n  - 'packages/*'\noverrides:\n  '@earendil-works/pi-ai@^1': 1.0.0\n",
    );
    const before = read(root, "package.json");
    const result = run(root, ["--apply"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("direct package names");
    expect(read(root, "package.json")).toBe(before);
  });
});
