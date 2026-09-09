/**
 * Application state.
 *
 * One object rather than a scatter of stores, because almost every selection
 * invalidates the ones below it: choosing a model clears the group, the plate
 * and the parts. Keeping that cascade in one place is what stops it going
 * wrong.
 *
 * It also owns *where the data came from*, because that is the one setting the
 * app cannot start without, and because restoring a selection has to happen
 * after the tree it refers to is open.
 */
import type { CsFileSystem } from "@emdzej/csfs-core";
import {
  AsaCatalogue,
  VinNotWellFormed,
  type CatalogueInfo,
  type GroupRef,
  type PartRow,
  type OptionSet,
  type VehicleCatalogue,
  type VehicleFit,
  type VinRecord,
} from "@masax/catalogue";
import { EUROPE_LANGUAGES, type Language } from "@masax/core";
import { i18n } from "./i18n/index.svelte";
import {
  addDisc as pickDisc,
  canPickDirectory,
  checkDiscs,
  openDiscs,
  openHttp,
  reopenDiscs,
  canStoreOffline,
  clearOffline,
  keepOffline,
  offlineQuota,
  openOffline,
  type Disc,
  type OfflineProgress,
} from "./sources.svelte";
import {
  clearDiscHandles,
  clearSettings,
  handleReadable,
  loadDiscHandles,
  loadSettings,
  requestHandleAccess,
  saveDiscHandles,
  saveSettings,
  type SavedSource,
  type Settings,
} from "./settings";

export class AppState {
  fs = $state<CsFileSystem | undefined>(undefined);
  catalogue = $state<AsaCatalogue | undefined>(undefined);
  language = $state<Language>("GB");

  /** Panel visible. Forced open until there is a source. */
  settingsOpen = $state(false);
  busy = $state("");
  error = $state("");

  discs = $state<Disc[]>([]);
  conflicts = $state<string[]>([]);
  saved = $state<SavedSource | undefined>(undefined);
  needsPermission = $state(false);

  /** Whether a copy is already in this browser. Looked for once, on boot. */
  hasOfflineCopy = $state(false);
  /**
   * Progress of a copy in flight. Empty when nothing is running.
   *
   * Separate from `offlineNote` on purpose: this one disables the button, and
   * holding the *outcome* here left it disabled for good once a copy finished.
   */
  offlineBusy = $state("");
  /** What the last copy or delete did. Says something; disables nothing. */
  offlineNote = $state("");
  offlineUsage = $state<{ usage: number; quota: number } | undefined>(undefined);

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
  vehicle = $state<VinRecord | undefined>(undefined);
  vinError = $state("");
  /** How the catalogue and model were picked from the VIN, for the interface. */
  vehicleCatalogue = $state<VehicleCatalogue | undefined>(undefined);
  /** What the vehicle's OPC stands for, read alongside the VIN. */
  optionSet = $state<OptionSet | undefined>(undefined);
  optionsOpen = $state(false);
  optionsBusy = $state(false);
  /** Whether the parts list narrows to the decoded vehicle. */
  narrowed = $state(true);

  /**
   * What the parts list narrows by, or undefined when nothing has been decoded.
   *
   * Undefined rather than an empty object: the switch is only offered when
   * there is a vehicle to narrow to, and picking a catalogue by hand is not one.
   */
  get vehicleFit(): VehicleFit | undefined {
    if (!this.vehicle) return undefined;
    return {
      classification: this.vehicle.classification,
      productionDate: this.vehicle.productionDate,
      options: this.optionSet ? new Set(this.optionSet.options.map((o) => o.code)) : undefined,
    };
  }

  private restoring = false;

  get firstRun(): boolean {
    return this.catalogue === undefined;
  }

  get folderSupported(): boolean {
    return canPickDirectory();
  }

  get offlineSupported(): boolean {
    return canStoreOffline();
  }

  get languages(): string[] {
    return [...EUROPE_LANGUAGES];
  }

  /**
   * Work out what to do on boot.
   *
   * An HTTP tree reopens by itself. A folder cannot: its permission does not
   * survive a reload, and `requestPermission` only works inside a user gesture,
   * so all this can do is *offer* to reopen it.
   */
  async boot(dataFromUrl?: string): Promise<void> {
    const settings = loadSettings();
    if (settings.language && this.languages.includes(settings.language)) {
      this.language = settings.language as Language;
    }
    this.saved = settings.source;

    if (dataFromUrl) {
      await this.openUrl(dataFromUrl, settings);
      return;
    }
    if (settings.source?.kind === "http") {
      await this.openUrl(settings.source.url, settings);
      return;
    }
    /*
     * Looked for on every boot, not only when it is the saved source: it is the
     * one source that reopens with no gesture and no host, so it is worth
     * offering as a way in when the saved one cannot be reopened.
     */
    if (this.offlineSupported) {
      this.hasOfflineCopy = Boolean(await openOffline());
      void this.refreshQuota();
    }

    if (settings.source?.kind === "offline") {
      await this.openOfflineCopy(settings);
      if (this.catalogue) return;
    }
    if (settings.source?.kind === "folders") {
      const handles = await loadDiscHandles();
      const readable = await Promise.all(handles.map(handleReadable));
      if (handles.length > 0 && readable.every(Boolean)) {
        await this.useHandles(handles, settings);
        return;
      }
      this.needsPermission = handles.length > 0;
    }
    this.settingsOpen = true;
  }

  /** Re-grant permission for remembered folders. Must run from a click. */
  async reopenSaved(): Promise<void> {
    this.error = "";
    this.busy = "Waiting for permission…";
    try {
      const handles = await loadDiscHandles();
      const granted = await Promise.all(handles.map(requestHandleAccess));
      if (handles.length === 0 || !granted.every(Boolean)) {
        this.error = "Permission was not granted, so the folder cannot be read.";
        return;
      }
      this.needsPermission = false;
      await this.useHandles(handles, loadSettings());
    } finally {
      this.busy = "";
    }
  }

  /** Open the copy in this browser. No permission, no network. */
  async openOfflineCopy(settings: Settings = loadSettings()): Promise<void> {
    this.error = "";
    this.busy = i18n.t("app.opening");
    try {
      const opened = await openOffline();
      if (!opened) {
        this.hasOfflineCopy = false;
        return;
      }
      await this.load(opened.fs);
      // The copy is one tree, not an overlay of discs; showing the discs that
      // were used to make it would imply they are still being read.
      this.discs = [];
      this.conflicts = [];
      this.saved = { kind: "offline" };
      this.hasOfflineCopy = true;
      saveSettings({ ...settings, source: this.saved, language: this.language });
      this.settingsOpen = false;
      await this.restore(settings.selection);
    } catch (cause) {
      this.error = (cause as Error).message;
    } finally {
      this.busy = "";
    }
  }

  /**
   * Copy whatever is open into this browser.
   *
   * Progress is reported per file because this takes minutes on a real
   * catalogue, and a copy that looks frozen is one the user kills by closing
   * the tab.
   */
  async keepCopyOffline(illustrations = false): Promise<void> {
    const source = this.fs;
    if (!source) return;
    /*
     * Refused when the copy *is* the open source. It would be copying the
     * origin private filesystem onto itself, and the replace below would delete
     * the thing being read halfway through.
     */
    if (this.saved?.kind === "offline") return;
    this.error = "";
    this.offlineNote = "";
    this.offlineBusy = i18n.t("offline.starting");
    try {
      /*
       * Replace means replace. Copying over an existing one merges, which
       * leaves files from a previous source behind — and if that source spelled
       * a directory differently, two directories where there should be one.
       */
      if (this.hasOfflineCopy) await clearOffline();
      const result = await keepOffline(source, {
        illustrations,
        onProgress: (p: OfflineProgress) => {
          this.offlineBusy = i18n.t("offline.progress", {
            files: p.files,
            mb: Math.round(p.bytes / 1e6),
          });
        },
      });
      this.hasOfflineCopy = true;
      this.offlineNote = i18n.t("offline.kept", {
        files: result.files,
        mb: Math.round(result.bytes / 1e6),
      });
      await this.refreshQuota();
    } catch (cause) {
      this.error = (cause as Error).message;
    } finally {
      this.offlineBusy = "";
    }
  }

  /**
   * Delete the copy.
   *
   * If it is what is currently open, the catalogue is closed with it rather
   * than left pointing at files that no longer exist — and the settings panel
   * opens, because there is now no source.
   */
  async deleteOfflineCopy(): Promise<void> {
    this.error = "";
    this.offlineNote = "";
    try {
      const wasOpen = this.saved?.kind === "offline";
      await clearOffline();
      this.hasOfflineCopy = false;
      this.offlineNote = i18n.t("offline.deleted");
      if (wasOpen) {
        this.catalogue = undefined;
        this.fs = undefined;
        this.catalogues = [];
        this.reset();
        this.saved = undefined;
        saveSettings({ ...loadSettings(), source: undefined });
        this.settingsOpen = true;
      }
      await this.refreshQuota();
    } catch (cause) {
      this.error = (cause as Error).message;
    }
  }

  async refreshQuota(): Promise<void> {
    this.offlineUsage = await offlineQuota();
  }

  private async useHandles(
    handles: FileSystemDirectoryHandle[],
    settings: Settings,
  ): Promise<void> {
    this.busy = "Reading the discs…";
    try {
      this.discs = await reopenDiscs(handles);
      this.conflicts = await checkDiscs(this.discs);
      await this.open(settings);
    } catch (cause) {
      this.error = (cause as Error).message;
      this.settingsOpen = true;
    } finally {
      this.busy = "";
    }
  }

  async addFolder(): Promise<void> {
    this.error = "";
    try {
      const disc = await pickDisc();
      if (this.discs.some((d) => d.name === disc.name)) return;
      this.discs = [...this.discs, disc];
      this.conflicts = await checkDiscs(this.discs);
      await saveDiscHandles(
        this.discs.map((d) => d.handle).filter(Boolean) as FileSystemDirectoryHandle[],
      );
    } catch (cause) {
      // A dismissed picker is not an error worth showing.
      const message = (cause as Error).message;
      if (!/abort/i.test(message)) this.error = message;
    }
  }

  async removeDisc(name: string): Promise<void> {
    this.discs = this.discs.filter((d) => d.name !== name);
    this.conflicts = await checkDiscs(this.discs);
    await saveDiscHandles(
      this.discs.map((d) => d.handle).filter(Boolean) as FileSystemDirectoryHandle[],
    );
  }

  /** Open the chosen discs. */
  async open(settings: Settings = loadSettings()): Promise<void> {
    this.error = "";
    this.busy = i18n.t("app.opening");
    try {
      const opened = openDiscs(this.discs);
      await this.load(opened.fs);
      this.saved = { kind: "folders", names: this.discs.map((d) => d.name) };
      saveSettings({ ...settings, source: this.saved, language: this.language });
      this.settingsOpen = false;
      await this.restore(settings.selection);
    } catch (cause) {
      this.error = (cause as Error).message;
    } finally {
      this.busy = "";
    }
  }

  async openUrl(url: string, settings: Settings = loadSettings()): Promise<void> {
    if (!url) return;
    this.error = "";
    this.busy = `Opening ${url}…`;
    try {
      const opened = await openHttp(url);
      await this.load(opened.fs);
      this.saved = { kind: "http", url };
      saveSettings({ ...settings, source: this.saved, language: this.language });
      this.settingsOpen = false;
      await this.restore(settings.selection);
    } catch (cause) {
      this.error = (cause as Error).message;
      this.settingsOpen = true;
    } finally {
      this.busy = "";
    }
  }

  async forget(): Promise<void> {
    clearSettings();
    await clearDiscHandles();
    this.saved = undefined;
    this.needsPermission = false;
    this.discs = [];
    this.conflicts = [];
  }

  private async load(fs: CsFileSystem): Promise<void> {
    const catalogue = await AsaCatalogue.open(fs, { language: this.language });
    this.fs = fs;
    this.catalogue = catalogue;
    this.catalogues = catalogue.catalogues();
    this.reset();
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

  /** Put back what was being looked at, dropping anything that no longer fits. */
  private async restore(selection?: Settings["selection"]): Promise<void> {
    if (!selection || !this.catalogue) return;
    this.restoring = true;
    try {
      if (selection.vin) this.vinInput = selection.vin;
      if (!selection.catalogue || !this.catalogues.some((c) => c.id === selection.catalogue)) {
        return;
      }
      this.selectCatalogue(selection.catalogue);
      if (!selection.model || !this.models.includes(selection.model)) return;
      this.selectModel(selection.model);
      if (selection.mainGroup === undefined) return;
      if (!this.mainGroups.some((g) => g.mainGroup === selection.mainGroup)) return;
      this.selectMainGroup(selection.mainGroup);
      const plate = this.plates.find((p) => p.subGroup === selection.subGroup);
      if (plate) await this.selectPlate(plate);
    } finally {
      this.restoring = false;
      this.remember();
    }
  }

  private remember(): void {
    if (this.restoring || !this.saved) return;
    saveSettings({
      source: this.saved,
      language: this.language,
      selection: {
        catalogue: this.selectedCatalogue,
        model: this.selectedModel,
        mainGroup: this.selectedMainGroup,
        subGroup: this.selectedPlate?.subGroup,
        vin: this.vinInput || undefined,
      },
    });
  }

  async setLanguage(language: Language): Promise<void> {
    if (language === this.language || !this.fs) return;
    this.language = language;
    const keep = {
      catalogue: this.selectedCatalogue,
      model: this.selectedModel,
      mainGroup: this.selectedMainGroup,
      subGroup: this.selectedPlate?.subGroup,
      vin: this.vinInput || undefined,
    };
    this.busy = "Reloading text…";
    try {
      await this.load(this.fs);
      await this.restore(keep);
    } finally {
      this.busy = "";
    }
  }

  selectCatalogue(id: string): void {
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
    this.remember();
  }

  selectModel(model: string): void {
    if (!this.catalogue || !this.selectedCatalogue) return;
    this.selectedModel = model;
    this.mainGroups = this.catalogue.mainGroupsFor(this.selectedCatalogue, model);
    this.selectedMainGroup = undefined;
    this.plates = [];
    this.selectedPlate = undefined;
    this.parts = [];
    this.remember();
  }

  selectMainGroup(mainGroup: number): void {
    if (!this.catalogue || !this.selectedCatalogue || !this.selectedModel) return;
    this.selectedMainGroup = mainGroup;
    this.plates = this.catalogue.platesFor(this.selectedCatalogue, this.selectedModel, mainGroup);
    this.selectedPlate = undefined;
    this.parts = [];
    if (this.plates.length === 1) void this.selectPlate(this.plates[0]!);
    this.remember();
  }

  async selectPlate(plate: GroupRef): Promise<void> {
    if (!this.catalogue || !this.selectedCatalogue || !this.selectedModel) return;
    this.selectedPlate = plate;
    this.busy = i18n.t("app.readingParts");
    try {
      this.parts = await this.catalogue.partsForPlate(
        this.selectedCatalogue,
        this.selectedModel,
        plate.mainGroup,
        plate.subGroup ?? 0,
        plate.illustration,
      );
      this.remember();
    } catch (cause) {
      this.error = (cause as Error).message;
      this.parts = [];
    } finally {
      this.busy = "";
    }
  }

  /**
   * Decode a VIN, and open the catalogue and model it belongs to.
   *
   * `VInfo` maps the decoded model and classification to a catalogue, and the
   * model code is the *same* vocabulary the catalogues use — `V25W` is both what
   * the VIN decodes to and what `PAJERO/MONTERO(EUR)` lists. So a VIN alone is
   * enough to reach a parts list, and the user does not have to know that a
   * V25W is a Pajero.
   *
   * If the vehicle decodes but no catalogue lists its model, the vehicle is
   * still reported: knowing what the car is beats saying nothing because the
   * next step could not be taken.
   */
  async decodeVin(): Promise<void> {
    if (!this.catalogue) return;
    this.vinError = "";
    this.vehicleCatalogue = undefined;
    this.optionSet = undefined;
    this.busy = i18n.t("app.lookingUp");
    try {
      const result = await this.catalogue.vin.decode(this.vinInput);
      this.vehicle = result.matches[0];
      if (!this.vehicle) {
        this.vinError =
          result.sameSerial.length > 0
            ? `Serial ${result.serial} is in the data, but not with chassis ${result.chassis}.`
            : `Serial ${result.serial} is not in this data.`;
        this.remember();
        return;
      }

      const resolved = this.catalogue.resolveVehicle({
        model: this.vehicle.model,
        classification: this.vehicle.classification,
      });
      this.vehicleCatalogue = resolved;
      // Read the option pack now rather than when the panel is opened: the
      // parts list narrows by it, so it has to be there before the first plate
      // is shown. It is one bounded range read.
      this.optionSet = await this.catalogue.optionsFor(this.vehicle);
      if (resolved) {
        this.selectCatalogue(resolved.catalogue);
        if (this.models.includes(resolved.model)) this.selectModel(resolved.model);
      }
      this.remember();
    } catch (cause) {
      this.vehicle = undefined;
      this.vinError = cause instanceof VinNotWellFormed ? cause.message : (cause as Error).message;
    } finally {
      this.busy = "";
    }
  }

  /**
   * Open the options panel, reading the pack the first time it is asked for.
   *
   * On demand rather than with the VIN: it is a range read into a 6.7 MB file
   * that most lookups never need, and decoding a VIN is already the slowest
   * thing the interface does.
   */
  /**
   * Read the option pack, once.
   *
   * Normally `decodeVin` has already done it; this covers a vehicle restored
   * from the last session, where nothing was decoded this time round.
   */
  async loadOptions(): Promise<void> {
    if (!this.catalogue || !this.vehicle || this.optionSet) return;
    this.optionsBusy = true;
    try {
      this.optionSet = await this.catalogue.optionsFor(this.vehicle);
    } catch (cause) {
      this.error = (cause as Error).message;
    } finally {
      this.optionsBusy = false;
    }
  }

  async showOptions(): Promise<void> {
    this.optionsOpen = true;
    await this.loadOptions();
  }
}
