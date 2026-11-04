#!/usr/bin/env node
/**
 * Starts the API, the web app and (if built) the Timefold solver together, with prefixed output.
 * Works the same on Windows, macOS and Linux.
 *
 *   npm run dev            api + web (+ solver when services/solver/target/solver-*.jar exists)
 *   npm run dev -- --no-solver
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const colors = { api: 36, web: 35, solver: 33 };

const procs = [
  { name: "api", cmd: npm, args: ["run", "dev"], cwd: join(root, "apps/api") },
  { name: "web", cmd: npm, args: ["run", "dev"], cwd: join(root, "apps/web") },
];

const target = join(root, "services/solver/target");
const jar = existsSync(target) && readdirSync(target).find((f) => /^solver-.*\.jar$/.test(f));
if (!process.argv.includes("--no-solver")) {
  if (jar) procs.push({ name: "solver", cmd: "java", args: ["-jar", join(target, jar)], cwd: root });
  else console.log("\x1b[33m[solver]\x1b[0m not built; run `npm run solver:build` to enable the schedule builder");
}

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, { cwd: p.cwd, shell: isWin, env: process.env });
  const tag = `\x1b[${colors[p.name]}m[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) out.write(tag + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => console.log(`${tag}exited with ${code}`));
  return child;
});

const stop = () => {
  for (const c of children) {
    if (isWin && c.pid) spawn("taskkill", ["/pid", String(c.pid), "/t", "/f"]);
    else c.kill("SIGTERM");
  }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
