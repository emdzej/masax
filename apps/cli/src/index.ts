#!/usr/bin/env node
import { Command, Option } from "@commander-js/extra-typings";
import chalk from "chalk";
import type { Language } from "@masax/core";
import { checkIllustrations, convertIllustrations, showIllustration } from "./illust.js";
import { importDiscs, surveyPaths } from "./import.js";
import { openModule } from "./open.js";
import { serve } from "./serve.js";
import { decodeVin, show } from "./show.js";
import { verify } from "./verify.js";

const generation = () =>
  new Option("-g, --generation <n>", "which data generation to read")
    .choices(["1", "2"] as const)
    .default("1" as const);

const program = new Command()
  .name("masax")
  .description("Tooling for the Mitsubishi After Sales Application catalogue")
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Mount the ISOs and point at the mount points; nothing needs extracting first:

  hdiutil attach -readonly MMC_ASA_EUR_A.iso     # macOS -> /Volumes/MMC-A
  masax survey /Volumes/*
  masax verify /Volumes/MMC-A "/Volumes/MMC ASA 2"
`,
  );

program
  .command("survey")
  .description("say what a directory or mount point contains")
  .argument("<paths...>", "directories or mount points")
  .action(async (paths) => {
    process.exitCode = await surveyPaths(paths);
  });

program
  .command("import")
  .description("merge mounted discs into one tree, unchanged, and write a manifest")
  .argument("<paths...>", "mount points, or directories holding a module")
  .requiredOption("-o, --out <dir>", "where to write the merged tree")
  .option("-m, --module <code>", "which module to take, e.g. M60")
  .option("--no-illustrations", "leave out ILLUST, which is most of the bytes")
  .option("--compare-bytes", "compare shared files byte by byte, not just by size", false)
  .option("--dry-run", "report what would be copied and write nothing", false)
  .action(async (paths, options) => {
    process.exitCode = await importDiscs(paths, {
      out: options.out,
      module: options.module,
      dryRun: options.dryRun,
      compareBytes: options.compareBytes,
      illustrations: options.illustrations,
    });
  });

program
  .command("verify")
  .description("decode every record of every dataset and check the format invariants")
  .argument("<paths...>", "mount points, or a directory holding a module")
  .addOption(generation())
  .option("-m, --module <code>", "which module to read, e.g. M60")
  .option("--schema", "print each dataset's schema as it is opened", false)
  .option("--only <dataset>", "verify a single dataset by name")
  .option("--run-keys", "print the run key derived from the data instead of checking it", false)
  .action(async (paths, options) => {
    const { fs } = await openModule(paths, options.module);
    process.exitCode = await verify(fs, {
      generation: options.generation === "2" ? 2 : 1,
      schema: options.schema,
      only: options.only,
      runKeys: options.runKeys,
    });
  });

program
  .command("show")
  .description("walk catalogue, model, main group, plate and its parts")
  .argument("<root>", "a mount point, or a directory holding a module")
  .argument("[path...]", "catalogue id, then model, main group, subgroup")
  .addOption(generation())
  .option("-m, --module <code>", "which module to read")
  .option("-l, --language <code>", "language for resolved text", "GB")
  .action(async (root, path, options) => {
    const { fs } = await openModule([root], options.module);
    process.exitCode = await show(fs, path, {
      generation: options.generation === "2" ? 2 : 1,
      language: options.language as Language,
    });
  });

program
  .command("vin")
  .description("decode a VIN against the catalogue's own vehicle data")
  .argument("<root>", "a mount point, or a directory holding a module")
  .argument("<vin>", "a 17-character VIN")
  .addOption(generation())
  .option("-m, --module <code>", "which module to read")
  .option("-l, --language <code>", "language for resolved text", "GB")
  .action(async (root, vin, options) => {
    const { fs } = await openModule([root], options.module);
    process.exitCode = await decodeVin(fs, vin, {
      generation: options.generation === "2" ? 2 : 1,
      language: options.language as Language,
    });
  });

program
  .command("serve")
  .description("serve a tree over HTTP with Range support, and optionally the client")
  .argument("<root>", "a directory to serve, normally an imported tree")
  .option("-p, --port <n>", "port to listen on", "8791")
  .option("-H, --host <name>", "address to bind", "127.0.0.1")
  .option("-a, --app <dir>", "also serve a built client from this directory")
  .action(async (root, options) => {
    process.exitCode = await serve(root, {
      port: Number(options.port),
      host: options.host,
      app: options.app,
    });
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

try {
  await program.parseAsync();
} catch (cause) {
  console.error(chalk.red((cause as Error).message));
  process.exitCode = 1;
}
