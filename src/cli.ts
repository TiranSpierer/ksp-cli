#!/usr/bin/env node
import { Command } from "commander";
import { buildCli } from "./cli-gen.js";
import { tools } from "./tools/index.js";
import { closeClient } from "./api/client.js";

const program = new Command()
  .name("ksp-cli")
  .description("CLI for searching and reading KSP products")
  .version("1.0.0")
  .showHelpAfterError("(run with --help for usage)");

buildCli(program, tools);
program
  .parseAsync(process.argv)
  .catch((error) => {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  // Shut down the cycletls helper so the process exits instead of hanging on
  // the open helper connection.
  .finally(() => closeClient());
