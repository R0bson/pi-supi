/** Return the pinned LLVM artifact for one supported CI runner. */
export function selectClangArtifact(pins, platform, architecture) {
  const operatingSystem = platform === "darwin" ? "macos" : platform;
  const key = `${operatingSystem}-${architecture}`;
  const artifact = pins.referenceServers.clangd.artifacts[key];
  if (!artifact) {
    throw new Error(`Unsupported language-baseline Clang platform: ${platform}/${architecture}.`);
  }
  return artifact;
}
