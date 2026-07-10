import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-env.mjs";

loadLocalEnv();

const args = process.argv.slice(2);
const schemaArgs = args.includes("--schema") ? [] : ["--schema", "../../prisma/schema.prisma"];

const child = spawn("prisma", [...args, ...schemaArgs], {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`prisma exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
