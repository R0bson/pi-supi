const fs = require("node:fs");
const path = require("node:path");

const isPi = (name) => /^@(earendil-works|mariozechner)\/pi-[\w-]+$/.test(name) || name === "@earendil-works/chord";

/** Read simple pnpm override entries without changing other YAML text. Fail closed on unsupported Pi selectors. */
function readOverrides(root) {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(file)) return { file, raw: "", entries: [] };
  const raw = fs.readFileSync(file, "utf8");
  const entries = [];
  let active = false;
  let offset = 0;
  for (const line of raw.split(/(?<=\n)/)) {
    if (/^overrides\s*:/.test(line)) {
      if (!/^overrides\s*:\s*(?:#[^\n]*)?\r?\n?$/.test(line)) {
        throw new Error("Use a block mapping for pnpm workspace overrides.");
      }
      active = true;
    } else if (/^\S/.test(line) && !line.startsWith("#")) active = false;
    else if (active && !/^\s*(?:#|$)/.test(line)) {
      const match = line.match(/^(\s+)(['"]?)([^'"\s]+)\2:\s*(['"]?)([^'"\s]+)\4(?:\s+#.*)?\s*$/);
      if (match && isPi(match[3])) {
        const value = match[5];
        if (!/^[~^>=]*\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value)) {
          throw new Error(`Unsupported Pi override value: ${match[3]}: ${value}`);
        }
        const start = offset + line.indexOf(value, line.indexOf(":") + 1);
        entries.push({ package: match[3], old: value, start, end: start + value.length });
      } else if (/@(?:earendil-works\/(?:pi-|chord)|mariozechner\/pi-)/.test(line)) {
        throw new Error("Use direct package names and scalar versions for Pi overrides.");
      }
    }
    offset += line.length;
  }
  return { file, raw, entries };
}

/** Check installed versions, including Pi dependencies below each workspace package. */
function verify(root, files, latest) {
  const seen = new Set();
  const versions = [];
  function resolvePackage(dir, name) {
    while (true) {
      const file = path.join(dir, "node_modules", name, "package.json");
      if (fs.existsSync(file)) return file;
      if (dir === root || path.dirname(dir) === dir) return undefined;
      dir = path.dirname(dir);
    }
  }
  function visit(file) {
    const real = fs.realpathSync(file);
    if (seen.has(real)) return;
    seen.add(real);
    const pkg = JSON.parse(fs.readFileSync(real, "utf8"));
    if (isPi(pkg.name)) {
      versions.push({ package: pkg.name, version: pkg.version, file });
      if (pkg.version !== latest) throw new Error(`Resolved ${pkg.name} ${pkg.version}; expected ${latest}. Check overrides and lockfiles.`);
    }
    const fields = files.includes(file) ? ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] : ["dependencies"];
    for (const field of fields) {
      for (const name of Object.keys(pkg[field] || {}).filter(isPi)) {
        const resolved = resolvePackage(path.dirname(real), name);
        if (!resolved) throw new Error(`Cannot verify installed Pi package: ${name} from ${file}`);
        visit(resolved);
      }
    }
  }
  for (const file of files) visit(file);
  if (!versions.length) throw new Error("No installed Pi version was found.");
  return versions;
}

module.exports = { readOverrides, verify };

if (require.main === module) {
  try {
    const [mode, root, latest] = process.argv.slice(2);
    const data = readOverrides(root);
    if (mode === "preview") {
      const changes = data.entries.filter((entry) => entry.old !== latest).map((entry) => ({ field: "overrides", package: entry.package, old: entry.old, new: latest }));
      console.log(JSON.stringify(changes.length ? [{ file: data.file, changes }] : []));
    } else if (mode === "apply") {
      let text = data.raw;
      for (const entry of data.entries.toReversed()) text = text.slice(0, entry.start) + latest + text.slice(entry.end);
      if (text !== data.raw) fs.writeFileSync(data.file, text);
    } else if (mode === "verify") {
      console.log(JSON.stringify(verify(root, JSON.parse(process.env.PI_UPGRADE_FILES), latest)));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
