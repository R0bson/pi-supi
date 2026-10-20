import { fileURLToPath } from "node:url";
import type { RealLanguageWorkspaceOptions } from "../helpers/real-substrate-workspace.ts";

export interface LanguageCase extends RealLanguageWorkspaceOptions {
  readonly label: string;
  readonly renameName: string;
  readonly semanticQuery?: string;
  readonly newName: string;
  readonly renameFiles: readonly string[];
  readonly inspectFile: string;
  readonly inspectOccurrence: number;
  readonly calleeFile: string;
  readonly calleeSymbol: string;
  readonly expectedDirectCalls: readonly string[];
  readonly expectedDeepCalls: readonly string[];
  readonly expectedCallCounts?: { readonly direct: number; readonly deep: number };
  readonly implementation:
    | {
        readonly file: string;
        readonly symbol: string;
        readonly expectedFile: string;
      }
    | { readonly notApplicableReason: string };
  readonly importQuery: string;
  readonly errorFile: string;
  readonly errorText: string;
  readonly fixedText: string;
  readonly diagnosticControl: {
    readonly insertAfter: string;
    readonly source: string;
    readonly marker: string;
  };
}

const fixture = (language: string) =>
  fileURLToPath(new URL(`../fixtures/language-baseline/${language}/`, import.meta.url));

export const languageCases: readonly LanguageCase[] = [
  {
    label: "TypeScript",
    language: "typescript",
    fixturePath: fixture("typescript"),
    sourceFile: "src/model.ts",
    renameName: "renameMe",
    newName: "renamedMe",
    renameFiles: ["src/model.ts", "src/main.ts"],
    inspectFile: "src/main.ts",
    inspectOccurrence: 1,
    calleeFile: "src/main.ts",
    calleeSymbol: "render",
    expectedDirectCalls: ["String", "renameMe", "nestedCall", "renameMe"],
    expectedDeepCalls: ["String", "renameMe", "nestedCall", "renameMe", "renameMe"],
    expectedCallCounts: { direct: 4, deep: 5 },
    implementation: {
      file: "src/model.ts",
      symbol: "render",
      expectedFile: "src/main.ts",
    },
    importQuery: "./model",
    errorFile: "src/main.ts",
    errorText: '"wrong"',
    fixedText: "1",
    diagnosticControl: {
      insertAfter: 'export const knownError: number = "wrong";',
      source: '\nexport const baselineControlError: number = "control";',
      marker: "baselineControlError",
    },
  },
  {
    label: "JavaScript",
    language: "javascript",
    fixturePath: fixture("javascript"),
    sourceFile: "src/model.js",
    renameName: "renameMe",
    newName: "renamedMe",
    renameFiles: ["src/model.js", "src/main.js"],
    inspectFile: "src/main.js",
    inspectOccurrence: 1,
    calleeFile: "src/main.js",
    calleeSymbol: "render",
    expectedDirectCalls: ["renameMe"],
    expectedDeepCalls: ["renameMe"],
    implementation: {
      file: "src/model.js",
      symbol: "render",
      expectedFile: "src/main.js",
    },
    importQuery: "./model.js",
    errorFile: "src/main.js",
    errorText: "missingFunction()",
    fixedText: "String(1)",
    diagnosticControl: {
      insertAfter: "export const knownError = missingFunction();",
      source: "\nexport const baselineControlError = missingControlFunction();",
      marker: "baselineControlError",
    },
  },
  {
    label: "Python",
    language: "python",
    fixturePath: fixture("python"),
    sourceFile: "model.py",
    renameName: "rename_me",
    newName: "renamed_me",
    renameFiles: ["model.py", "app.py"],
    inspectFile: "app.py",
    inspectOccurrence: 1,
    calleeFile: "app.py",
    calleeSymbol: "render",
    expectedDirectCalls: ["rename_me"],
    expectedDeepCalls: ["rename_me"],
    implementation: {
      file: "model.py",
      symbol: "render",
      expectedFile: "app.py",
    },
    importQuery: "model",
    errorFile: "app.py",
    errorText: '1 + "wrong"',
    fixedText: "1 + 2",
    diagnosticControl: {
      insertAfter: 'known_error: int = 1 + "wrong"',
      source: '\ncontrol_error: int = "control"',
      marker: "control_error",
    },
  },
  {
    label: "Java",
    language: "java",
    fixturePath: fixture("java"),
    sourceFile: "src/main/java/example/Model.java",
    renameName: "renameMe",
    semanticQuery: "Model",
    newName: "renamedMe",
    renameFiles: [
      "src/main/java/example/Model.java",
      "src/main/java/example/Widget.java",
      "src/main/java/client/Entry.java",
    ],
    inspectFile: "src/main/java/example/Widget.java",
    inspectOccurrence: 0,
    calleeFile: "src/main/java/example/Widget.java",
    calleeSymbol: "render",
    expectedDirectCalls: ["renameMe"],
    expectedDeepCalls: ["renameMe"],
    implementation: {
      file: "src/main/java/example/Surface.java",
      symbol: "render",
      expectedFile: "src/main/java/example/Widget.java",
    },
    importQuery: "example.Model",
    errorFile: "src/main/java/client/Entry.java",
    errorText: '1 + "wrong"',
    fixedText: "1 + 2",
    diagnosticControl: {
      insertAfter: 'int knownError = 1 + "wrong";',
      source: '\n        int baselineControlError = "control";',
      marker: "baselineControlError",
    },
  },
  {
    label: "Go",
    language: "go",
    fixturePath: fixture("go"),
    sourceFile: "model/model.go",
    renameName: "RenameMe",
    newName: "RenamedMe",
    renameFiles: ["model/model.go", "model/widget.go", "app/main.go"],
    inspectFile: "app/main.go",
    inspectOccurrence: 0,
    calleeFile: "model/model.go",
    calleeSymbol: "RenameMe",
    expectedDirectCalls: ["increment"],
    expectedDeepCalls: ["increment"],
    implementation: {
      file: "model/model.go",
      symbol: "Render",
      expectedFile: "model/widget.go",
    },
    importQuery: "example.com/language-baseline/model",
    errorFile: "app/main.go",
    errorText: '1 + "wrong"',
    fixedText: "1 + 2",
    diagnosticControl: {
      insertAfter: 'knownError := 1 + "wrong"',
      source: '\n\tcontrolError := 1 + "control"\n\t_ = controlError',
      marker: "controlError",
    },
  },
  {
    label: "Rust",
    language: "rust",
    fixturePath: fixture("rust"),
    sourceFile: "src/lib.rs",
    renameName: "rename_me",
    newName: "renamed_me",
    renameFiles: ["src/lib.rs", "src/impls.rs", "src/main.rs"],
    inspectFile: "src/main.rs",
    inspectOccurrence: 1,
    calleeFile: "src/impls.rs",
    calleeSymbol: "render",
    expectedDirectCalls: ["rename_me"],
    expectedDeepCalls: ["rename_me"],
    implementation: {
      file: "src/lib.rs",
      symbol: "render",
      expectedFile: "src/impls.rs",
    },
    importQuery: "language_baseline",
    errorFile: "src/broken.rs",
    errorText: "let value: i32 = ;",
    fixedText: "let value: i32 = 1 + 2;",
    diagnosticControl: {
      insertAfter: "let value: i32 = ;",
      source: "\n    let control_error: i32 = ;",
      marker: "control_error",
    },
  },
  {
    label: "C",
    language: "c",
    fixturePath: fixture("c"),
    sourceFile: "src/model.c",
    renameName: "rename_me",
    newName: "renamed_me",
    renameFiles: ["include/model.h", "src/model.c", "src/main.c"],
    inspectFile: "src/main.c",
    inspectOccurrence: 0,
    calleeFile: "src/main.c",
    calleeSymbol: "main",
    expectedDirectCalls: ["rename_me"],
    expectedDeepCalls: ["rename_me"],
    implementation: {
      notApplicableReason:
        "C has no language-defined interface implementation relation for functions.",
    },
    importQuery: "model.h",
    errorFile: "src/main.c",
    errorText: '1 + "wrong"',
    fixedText: "1 + 2",
    diagnosticControl: {
      insertAfter: 'int known_error = 1 + "wrong";',
      source: "\n    #error BASELINE_CONTROL_DIAGNOSTIC",
      marker: "BASELINE_CONTROL_DIAGNOSTIC",
    },
  },
  {
    label: "C++",
    language: "cpp",
    fixturePath: fixture("cpp"),
    sourceFile: "src/model.cpp",
    renameName: "renameMe",
    newName: "renamedMe",
    renameFiles: ["include/model.hpp", "src/model.cpp", "src/widget.cpp", "src/main.cpp"],
    inspectFile: "src/main.cpp",
    inspectOccurrence: 0,
    calleeFile: "src/widget.cpp",
    calleeSymbol: "render",
    expectedDirectCalls: ["renameMe"],
    expectedDeepCalls: ["renameMe"],
    implementation: {
      file: "include/model.hpp",
      symbol: "render",
      expectedFile: "src/widget.cpp",
    },
    importQuery: "model.hpp",
    errorFile: "src/main.cpp",
    errorText: '1 + "wrong"',
    fixedText: "1 + 2",
    diagnosticControl: {
      insertAfter: 'int knownError = 1 + "wrong";',
      source: "\n    #error BASELINE_CONTROL_DIAGNOSTIC",
      marker: "BASELINE_CONTROL_DIAGNOSTIC",
    },
  },
];

export function getLanguageCase(language: LanguageCase["language"]): LanguageCase {
  const selected = languageCases.find((candidate) => candidate.language === language);
  if (!selected) throw new Error(`No acceptance fixture exists for ${language}.`);
  return selected;
}
