import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.env.PI_CODING_AGENT_DIR;
const script = `
  const fs = require('node:fs');
  const path = require('node:path');
  fs.writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'descendant-ready'), 'ready');
  setTimeout(() => fs.writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'orphan-write'), 'changed'), 750);
`;
spawn(process.execPath, ["-e", script], { stdio: ["ignore", "inherit", "inherit"] });
writeFileSync(join(directory, "parent-ready"), "ready");
setTimeout(() => {}, 30_000);
