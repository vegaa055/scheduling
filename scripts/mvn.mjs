#!/usr/bin/env node
// Runs the solver's Maven wrapper with the given arguments on any OS: node scripts/mvn.mjs test
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "solver");
const isWin = process.platform === "win32";
const r = spawnSync(isWin ? "mvnw.cmd" : "./mvnw", process.argv.slice(2), { cwd, stdio: "inherit", shell: isWin });
process.exit(r.status ?? 1);
