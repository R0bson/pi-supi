import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectClangArtifact } from "./clang-artifacts.mjs";

const pins = JSON.parse(readFileSync(new URL("./pins.json", import.meta.url), "utf8"));

describe("pinned LLVM runner artifacts", () => {
  it.each([
    ["linux", "x64", "LLVM-21.1.8-Linux-X64.tar.xz"],
    ["darwin", "arm64", "LLVM-21.1.8-macOS-ARM64.tar.xz"],
  ])("selects the immutable artifact for %s/%s", (platform, architecture, file) => {
    const artifact = selectClangArtifact(pins, platform, architecture);
    expect(artifact.file).toBe(file);
    expect(artifact.url).toContain(`/llvmorg-21.1.8/${file}`);
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ["linux", "arm64"],
    ["darwin", "x64"],
    ["win32", "x64"],
  ])("rejects unsupported platform %s/%s", (platform, architecture) => {
    expect(() => selectClangArtifact(pins, platform, architecture)).toThrow(
      `Unsupported language-baseline Clang platform: ${platform}/${architecture}`,
    );
  });
});
