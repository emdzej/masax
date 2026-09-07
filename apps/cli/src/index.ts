#!/usr/bin/env node
import { Command, Option } from "@commander-js/extra-typings";
import { verify } from "./verify.js";
import { checkIllustrations, convertIllustrations, showIllustration } from "./illust.js";

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
  .option("--run-keys", "print the run key derived from the data instead of checking it", false)
  .action(async (root, options) => {
    const code = await verify(root, {
      generation: options.generation === "2" ? 2 : 1,
      schema: options.schema,
      only: options.only,
      runKeys: options.runKeys,
    });
    process.exitCode = code;
  });

program
  .command("illust")
  .description("check or convert the parts drawings")
  .argument("<path>", "an ILLUST directory, or one drawing")
  .option("--check", "decode every drawing and report failures", false)
  .option("--headers-only", "with --check, parse the TIFF header but skip the pixels", false)
  .option("-o, --out <dir>", "convert into this directory")
  .option("--png", "convert to PNG rather than plain TIFF", false)
  .action(async (path, options) => {
    if (options.out) {
      process.exitCode = await convertIllustrations(path, options.out, options.png);
    } else if (options.check) {
      process.exitCode = await checkIllustrations(path, !options.headersOnly);
    } else {
      process.exitCode = await showIllustration(path);
    }
  });

await program.parseAsync();
