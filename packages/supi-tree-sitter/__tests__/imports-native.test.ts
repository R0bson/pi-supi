import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTreeSitterSession } from "../src/api.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "supi-native-imports-"));
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const cases = [
  {
    file: "imports.py",
    source: `import os.path as path, sys\nfrom ..pkg.sub import Thing as Alias\nfrom . import local\n`,
    targets: ["os.path", "sys", "..pkg.sub", "."],
  },
  {
    file: "Imports.java",
    source:
      "import java.util.List;\nimport static java.util.Collections.emptyList;\nimport java.util.*;\n",
    targets: ["java.util.List", "java.util.Collections.emptyList", "java.util.*"],
  },
  {
    file: "imports.go",
    source: `package p\nimport "fmt"\nimport (f "os"; "net/http")\n`,
    targets: ["fmt", "os", "net/http"],
  },
  {
    file: "imports.rs",
    source: `use std::io::{self, Read as R, Write};\npub use std::fmt::{self as fmt, Debug as D};\npub(crate) use crate::private::{Thing as Alias, Other};\nuse crate::foo::*;\nextern crate serde as S;\nmod local;\nmod inline { use ignored::Only; pub(super) use sibling::{Public as Alias, Other}; mod child; mod nested { use deep::Thing; } }\n`,
    targets: [
      "std::io",
      "std::io::Read",
      "std::io::Write",
      "std::fmt",
      "std::fmt::Debug",
      "crate::private::Thing",
      "crate::private::Other",
      "crate::foo::*",
      "serde",
      "local",
      "ignored::Only",
      "sibling::Public",
      "sibling::Other",
      "child",
      "deep::Thing",
    ],
  },
  {
    file: "imports.c",
    source: `#include <stdio.h>\n#if FEATURE\n#include "local.h"\n#endif\n#include HEADER\n`,
    targets: ["stdio.h", "local.h"],
  },
  {
    file: "imports.cpp",
    source: `#include <vector>\n#if FEATURE\n#include "local.hpp"\n#endif\n`,
    targets: ["vector", "local.hpp"],
  },
] as const;

describe("native-language imports", () => {
  it.each(cases)("extracts written specifiers from $file", async ({ file, source, targets }) => {
    writeFileSync(join(cwd, file), source);
    const session = createTreeSitterSession(cwd);
    try {
      const result = await session.imports(file);
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.data.map((entry) => entry.moduleSpecifier)).toEqual(targets);
      expect(result.data.every((entry) => entry.range.startLine > 0)).toBe(true);
    } finally {
      await session.dispose();
    }
  });
});
