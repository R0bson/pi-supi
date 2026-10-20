import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTreeSitterSession } from "../src/api.ts";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("C-family Tree-sitter file associations", () => {
  it("uses trusted ordered rules and keeps the default for unmatched headers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "tree-sitter-file-associations-"));
    workspaces.push(cwd);
    mkdirSync(join(cwd, "vendor"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "include"), { recursive: true });
    const template = join(cwd, "src", "template.h");
    const vendor = join(cwd, "vendor", "vendor.h");
    const unmatched = join(cwd, "include", "default.h");
    writeFileSync(template, "template <typename T> class Box { T value; };");
    writeFileSync(vendor, "struct Vendor { int value; };");
    writeFileSync(unmatched, "struct DefaultHeader { int value; };");

    const session = createTreeSitterSession(cwd, {
      fileAssociations: [
        { pattern: "vendor/**/*.h", language: "c" },
        { pattern: "src/**/*.h", language: "cpp" },
      ],
    });
    try {
      await expect(session.canParse(template)).resolves.toMatchObject({
        kind: "success",
        data: { language: "cpp" },
      });
      await expect(session.canParse(vendor)).resolves.toMatchObject({
        kind: "success",
        data: { language: "c" },
      });
      await expect(session.canParse(unmatched)).resolves.toMatchObject({
        kind: "success",
        data: { language: "c" },
      });
      await expect(session.outline(template)).resolves.toMatchObject({
        kind: "success",
        data: [expect.objectContaining({ name: "Box" })],
      });
      await expect(session.outline(vendor)).resolves.toMatchObject({
        kind: "success",
        data: [expect.objectContaining({ name: "Vendor" })],
      });
    } finally {
      await session.dispose();
    }
  });

  it("keeps standalone defaults and does not add support for other suffixes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "tree-sitter-file-associations-default-"));
    workspaces.push(cwd);
    const header = join(cwd, "default.h");
    const text = join(cwd, "unknown.txt");
    writeFileSync(header, "struct Header { int value; };");
    writeFileSync(text, "template <typename T> class Box {};");
    const session = createTreeSitterSession(cwd, {
      fileAssociations: [{ pattern: "**/*.h", language: "cpp" }],
    });
    try {
      await expect(session.canParse(header)).resolves.toMatchObject({
        kind: "success",
        data: { language: "cpp" },
      });
      await expect(session.canParse(text)).resolves.toMatchObject({
        kind: "unsupported-language",
      });
    } finally {
      await session.dispose();
    }

    const standalone = createTreeSitterSession(cwd);
    try {
      await expect(standalone.canParse(header)).resolves.toMatchObject({
        kind: "success",
        data: { language: "c" },
      });
    } finally {
      await standalone.dispose();
    }
  });
});
