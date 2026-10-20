import { describe, expect, it } from "vitest";
import {
  C_FAMILY_EXTENSIONS,
  createCFamilyFileAssociationResolver,
  defaultCFamilyLanguage,
} from "../src/file-associations.ts";

describe("C-family file associations", () => {
  it("uses the first matching workspace-relative rule and keeps suffix defaults", () => {
    const resolver = createCFamilyFileAssociationResolver("/project", [
      { pattern: "vendor/**/*.h", language: "c" },
      { pattern: "**/*.h", language: "cpp" },
    ]);

    expect(resolver.languageForFile("/project/vendor/sdk/api.h")).toBe("c");
    expect(resolver.languageForFile("/project/src/api.h")).toBe("cpp");
    expect(resolver.languageForFile("/project/src/main.c")).toBe("c");
    expect(resolver.languageForFile("/project/src/main.cpp")).toBe("cpp");
    expect(resolver.languageForFile("/other/api.h")).toBe("c");
    expect(resolver.languageForFile("/project/src/main.txt")).toBeUndefined();
  });

  it("accepts comma-separated brace alternatives", () => {
    const resolver = createCFamilyFileAssociationResolver("/project", [
      { pattern: "**/*.{h,hpp}", language: "cpp" },
    ]);

    expect(resolver.languageForFile("/project/include/api.h")).toBe("cpp");
    expect(resolver.languageForFile("/project/include/api.hpp")).toBe("cpp");
  });

  it("matches glob patterns with the same case rules on every platform", () => {
    const resolver = createCFamilyFileAssociationResolver("/project", [
      { pattern: "**/*.H", language: "cpp" },
    ]);
    expect(resolver.languageForFile("/project/api.H")).toBe("cpp");
    expect(resolver.languageForFile("/project/api.h")).toBe("c");
  });

  it("accepts character classes without guessing a representative file name", () => {
    const resolver = createCFamilyFileAssociationResolver("/project", [
      { pattern: "**/*.[Hh]", language: "cpp" },
    ]);
    expect(resolver.languageForFile("/project/api.H")).toBe("cpp");
    expect(resolver.languageForFile("/project/api.h")).toBe("cpp");
  });

  it("does not let an unmatched or non-C-family rule add file support", () => {
    const resolver = createCFamilyFileAssociationResolver("/project", [
      { pattern: "**/*.txt", language: "cpp" },
    ]);
    expect(resolver.languageForFile("/project/api.txt")).toBeUndefined();
    expect(resolver.languageForFile("/project/api.h")).toBe("c");
  });

  it("uses the same default mapping for all existing C-family suffixes", () => {
    expect(C_FAMILY_EXTENSIONS).toEqual([
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".cc",
      ".cxx",
      ".hxx",
      ".c++",
      ".h++",
    ]);
    expect(defaultCFamilyLanguage(".c")).toBe("c");
    expect(defaultCFamilyLanguage(".h")).toBe("c");
    expect(defaultCFamilyLanguage(".cpp")).toBe("cpp");
    expect(defaultCFamilyLanguage(".txt")).toBeUndefined();
  });

  it.each([
    [null, "expected an ordered array"],
    [[{ pattern: 42, language: "c" }], ".pattern must be a string"],
    [[{ pattern: "**/*.h", language: "rust" }], '.language must be "c" or "cpp"'],
    [[{ pattern: "", language: "c" }], "safe workspace-relative glob"],
    [[{ pattern: "../outside.h", language: "cpp" }], "unsafe or unsupported path pattern"],
    [[{ pattern: "/absolute/**/*.h", language: "c" }], "safe workspace-relative glob"],
    [[{ pattern: "C:/outside/**/*.h", language: "c" }], "safe workspace-relative glob"],
    [[{ pattern: "**/[broken.h", language: "c" }], "not a valid glob"],
    [[{ pattern: "**/*.h", language: "cpp", extra: true }], 'only "pattern" and "language"'],
  ])("rejects invalid rules %j", (rules, message) => {
    expect(() => createCFamilyFileAssociationResolver("/project", rules)).toThrow(
      message as string,
    );
  });

  it("keeps suffix selection for explicit hidden source files", () => {
    const resolver = createCFamilyFileAssociationResolver("/project", [
      { pattern: "**/*.h", language: "cpp" },
    ]);
    expect(resolver.languageForFile(".hidden.h")).toBe("cpp");
    expect(resolver.languageForFile(".hidden.txt")).toBeUndefined();
  });

  it("exposes an immutable snapshot", () => {
    const resolver = createCFamilyFileAssociationResolver("/project", [
      { pattern: "**/*.h", language: "cpp" },
    ]);

    expect(Object.isFrozen(resolver)).toBe(true);
    expect(Object.isFrozen(resolver.rules)).toBe(true);
    expect(Object.isFrozen(resolver.rules[0])).toBe(true);
  });
});
