#!/usr/bin/env node
import { Command, Option } from "@commander-js/extra-typings";
import { verify } from "./verify.js";

const program = new Command()
  .name("masax")
  .description("Tooling for the Mitsubishi After Sales Application catalogue")
  .version("0.1.0");

program
  .command("verify")
  .description("decode every record of every dataset and check its declared length")
  .argument("<root>", "an ASA module directory, e.g. /mnt/asa/M60")
  .addOption(
    new Option("-g, --generation <n>", "which data generation to read")
      .choices(["1", "2"])
      .default("1"),
  )
  .option("--schema", "print each dataset's schema as it is opened", false)
  .option("--only <dataset>", "verify a single dataset by name")
  .action(async (root, options) => {
    const code = await verify(root, {
      generation: options.generation === "2" ? 2 : 1,
      schema: options.schema,
      only: options.only,
    });
    process.exitCode = code;
  });

await program.parseAsync();
