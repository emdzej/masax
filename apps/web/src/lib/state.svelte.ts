/**
 * Application state.
 *
 * One object rather than a scatter of stores, because almost every selection
 * invalidates the ones below it: choosing a model clears the group, the plate
 * and the parts. Keeping that in one place makes the cascade obvious.
 */
import {
  AsaCatalogue,
  VinNotWellFormed,
  type CatalogueInfo,
  type GroupRef,
  type PartRow,
  type VinRecord,
} from "@masax/catalogue";
import type { CsFileSystem } from "@emdzej/csfs-core";
import type { Language } from "@masax/core";

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: "GB", label: "English" },
  { code: "D", label: "Deutsch" },
  { code: "F", label: "Français" },
  { code: "J", label: "日本語" },
];

export class AppState {
  fs = $state<CsFileSystem | undefined>(undefined);
  catalogue = $state<AsaCatalogue | undefined>(undefined);
  language = $state<Language>("GB");

  status = $state("");
  error = $state("");
  busy = $state(false);

  catalogues = $state<CatalogueInfo[]>([]);
  selectedCatalogue = $state<string | undefined>(undefined);
  models = $state<string[]>([]);
  selectedModel = $state<string | undefined>(undefined);
  mainGroups = $state<GroupRef[]>([]);
  selectedMainGroup = $state<number | undefined>(undefined);
  plates = $state<GroupRef[]>([]);
  selectedPlate = $state<GroupRef | undefined>(undefined);
  parts = $state<PartRow[]>([]);

  vinInput = $state("");
  vinResult = $state<{ vin: string; matches: VinRecord[]; sameSerial: VinRecord[] } | undefined>(
    undefined,
  );

  /** Open a data tree and load the navigation tables. */
  async openSource(fs: CsFileSystem, describe: string): Promise<void> {
    this.busy = true;
    this.error = "";
    this.status = `Opening ${describe}…`;
    try {
      const catalogue = await AsaCatalogue.open(fs, { language: this.language });
      this.fs = fs;
      this.catalogue = catalogue;
      this.catalogues = catalogue.catalogues();
      this.status = `${this.catalogues.length} catalogues, ${catalogue.vin.records.toLocaleString()} indexed vehicles`;
      this.reset();
    } catch (cause) {
      this.error = `${describe}: ${(cause as Error).message}`;
      this.status = "";
    } finally {
      this.busy = false;
    }
  }

  /** Reload text in a different language, keeping the current selection. */
  async setLanguage(language: Language): Promise<void> {
    this.language = language;
    if (!this.fs) return;
    const catalogue = this.selectedCatalogue;
    const model = this.selectedModel;
    const mainGroup = this.selectedMainGroup;
    const plate = this.selectedPlate?.subGroup;
    await this.openSource(this.fs, "the catalogue");
    if (catalogue) {
      await this.selectCatalogue(catalogue);
      if (model) {
        this.selectModel(model);
        if (mainGroup !== undefined) {
          this.selectMainGroup(mainGroup);
          const again = this.plates.find((p) => p.subGroup === plate);
          if (again) await this.selectPlate(again);
        }
      }
    }
  }

  private reset(): void {
    this.selectedCatalogue = undefined;
    this.models = [];
    this.selectedModel = undefined;
    this.mainGroups = [];
    this.selectedMainGroup = undefined;
    this.plates = [];
    this.selectedPlate = undefined;
    this.parts = [];
  }

  async selectCatalogue(id: string): Promise<void> {
    if (!this.catalogue) return;
    this.selectedCatalogue = id;
    this.models = this.catalogue.models(id);
    this.selectedModel = undefined;
    this.mainGroups = [];
    this.selectedMainGroup = undefined;
    this.plates = [];
    this.selectedPlate = undefined;
    this.parts = [];
    if (this.models.length === 1) this.selectModel(this.models[0]!);
  }

  selectModel(model: string): void {
    if (!this.catalogue || !this.selectedCatalogue) return;
    this.selectedModel = model;
    this.mainGroups = this.catalogue.mainGroupsFor(this.selectedCatalogue, model);
    this.selectedMainGroup = undefined;
    this.plates = [];
    this.selectedPlate = undefined;
    this.parts = [];
  }

  selectMainGroup(mainGroup: number): void {
    if (!this.catalogue || !this.selectedCatalogue || !this.selectedModel) return;
    this.selectedMainGroup = mainGroup;
    this.plates = this.catalogue.platesFor(this.selectedCatalogue, this.selectedModel, mainGroup);
    this.selectedPlate = undefined;
    this.parts = [];
  }

  async selectPlate(plate: GroupRef): Promise<void> {
    if (!this.catalogue || !this.selectedCatalogue || !this.selectedModel) return;
    this.selectedPlate = plate;
    this.busy = true;
    try {
      this.parts = await this.catalogue.partsFor(
        this.selectedCatalogue,
        this.selectedModel,
        plate.mainGroup,
        plate.subGroup ?? 0,
      );
    } catch (cause) {
      this.error = (cause as Error).message;
      this.parts = [];
    } finally {
      this.busy = false;
    }
  }

  /**
   * Decode a VIN and jump to the vehicle's catalogue.
   *
   * The chassis prefix identifies the vehicle; the model it yields is the `Vin`
   * model code, which is not the same vocabulary as a catalogue's model code,
   * so this selects the catalogue and leaves the model to the user rather than
   * pretending to know the mapping.
   */
  async lookupVin(): Promise<void> {
    if (!this.catalogue) return;
    this.error = "";
    this.busy = true;
    try {
      const result = await this.catalogue.vin.decode(this.vinInput);
      this.vinResult = result;
      if (result.matches.length === 0) {
        this.error =
          result.sameSerial.length > 0
            ? `Serial ${result.serial} exists, but not with chassis ${result.chassis}.`
            : `Serial ${result.serial} is not in this data.`;
      }
    } catch (cause) {
      this.vinResult = undefined;
      this.error = cause instanceof VinNotWellFormed ? cause.message : (cause as Error).message;
    } finally {
      this.busy = false;
    }
  }
}
