#!/usr/bin/env node
import { Command, Option } from "@commander-js/extra-typings";
import type { Language } from "@masax/core";
import { checkIllustrations, convertIllustrations, showIllustration } from "./illust.js";
import { writeManifest } from "./manifest.js";
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
  .version("0.1.0");

program
  .command("verify")
  .description("decode every record of every dataset and check the format invariants")
  .argument("<root>", "an ASA module directory, e.g. /mnt/asa/M60")
  .addOption(generation())
  .option("--schema", "print each dataset's schema as it is opened", false)
  .option("--only <dataset>", "verify a single dataset by name")
  .option("--run-keys", "print the run key derived from the data instead of checking it", false)
  .action(async (root, options) => {
    process.exitCode = await verify(root, {
      generation: options.generation === "2" ? 2 : 1,
      schema: options.schema,
      only: options.only,
      runKeys: options.runKeys,
    });
  });

program
  .command("show")
  .description("walk catalogue, model, main group, plate and its parts")
  .argument("<root>", "an ASA module directory")
  .argument("[path...]", "catalogue id, then model, main group, subgroup")
  .addOption(generation())
  .option("-l, --language <code>", "language for resolved text", "GB")
  .action(async (root, path, options) => {
    process.exitCode = await show(root, path, {
      generation: options.generation === "2" ? 2 : 1,
      language: options.language as Language,
    });
  });

program
  .command("vin")
  .description("decode a VIN against the catalogue's own vehicle data")
  .argument("<root>", "an ASA module directory")
  .argument("<vin>", "a 17-character VIN")
  .addOption(generation())
  .option("-l, --language <code>", "language for resolved text", "GB")
  .action(async (root, vin, options) => {
    process.exitCode = await decodeVin(root, vin, {
      generation: options.generation === "2" ? 2 : 1,
      language: options.language as Language,
    });
  });

program
  .command("manifest")
  .description("write the directory listing a static HTTP tree needs")
  .argument("<root>", "an ASA module directory")
  .option("-o, --out <file>", "where to write it", "manifest.json")
  .action(async (root, options) => {
    process.exitCode = await writeManifest(root, options.out);
  });

program
  .command("serve")
  .description("serve a data tree over HTTP with Range support, and optionally the client")
  .argument("<root>", "an ASA module directory, e.g. /mnt/asa/M60")
  .option("-p, --port <n>", "port to listen on", "8787")
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

await program.parseAsync();
