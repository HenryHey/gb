import { extractRomsFrom7z } from '../archive7z.js';
import { hasBatterySram, loadSram, parseHeader } from '../cart.js';
import { log, renderCpu } from '../debug.js';
import { createEmu, reset } from '../emu.js';

export function createRomLoader({
  input,
  romChoiceLabel,
  romChoice,
  info,
  getEmu,
  setEmu,
  setRunning,
  flushSramSave,
  resetClock,
  scheduleSramSave,
  setSramPersistHeader,
  syncRomUi,
  updateCopySaveStateBtn,
}) {
  let romLoaded = false;
  /** @type {Array<{ path: string, name: string, data: Uint8Array }>} */
  let archiveRoms = [];
  /** @type {string | null} */
  let currentRomFileName = null;
  /** @type {string | null} */
  let currentArchiveFileName = null;

  function hasRomLoaded() {
    return romLoaded;
  }

  function getRomSource() {
    return { romFileName: currentRomFileName, archiveFileName: currentArchiveFileName };
  }

  function setRomChoiceVisible(visible) {
    romChoiceLabel.hidden = !visible;
    romChoice.hidden = !visible;
  }

  function clearRomChoice() {
    archiveRoms = [];
    currentRomFileName = null;
    currentArchiveFileName = null;
    romChoice.replaceChildren();
    setRomChoiceVisible(false);
  }

  function setRomSource({ romFileName, archiveFileName = null }) {
    currentRomFileName = romFileName;
    currentArchiveFileName = archiveFileName;
  }

  function populateRomChoice(roms) {
    archiveRoms = roms;
    const options = [];
    if (roms.length > 1) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a ROM…';
      placeholder.disabled = true;
      placeholder.selected = true;
      options.push(placeholder);
    }
    options.push(
      ...roms.map((entry, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = roms.length > 1 && entry.path !== entry.name ? entry.path : entry.name;
        return opt;
      }),
    );
    romChoice.replaceChildren(...options);
    setRomChoiceVisible(roms.length > 1);
  }

  function loadRom(rom) {
    setRunning(false);
    flushSramSave();

    const header = parseHeader(rom);
    setSramPersistHeader(header);
    setEmu(createEmu(rom, { onCartRamWrite: scheduleSramSave }));

    const emu = getEmu();
    if (hasBatterySram(header.type) && emu.cart.ram?.length) {
      loadSram(emu.cart, emu.rom);
    }

    romLoaded = true;
    reset(emu);
    resetClock();
    renderCpu(emu.cpu);
    syncRomUi();
    updateCopySaveStateBtn();
    setRunning(true);
  }

  function loadRomBytes(rom, { logHeader = true } = {}) {
    if (rom.length === 0) throw new Error('ROM file is empty');

    const header = parseHeader(rom);
    info.textContent = '';
    loadRom(rom);
    if (logHeader) log(header);
    return header;
  }

  function bindFilePicker() {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        clearRomChoice();
        const buf = await file.arrayBuffer();

        if (file.name.toLowerCase().endsWith('.7z')) {
          info.textContent = 'Extracting archive…';
          const roms = await extractRomsFrom7z(buf);
          populateRomChoice(roms);
          if (roms.length === 1) {
            setRomSource({ romFileName: roms[0].name, archiveFileName: file.name });
            loadRomBytes(roms[0].data);
          } else {
            currentArchiveFileName = file.name;
            info.textContent = 'Select a ROM from the archive';
          }
          return;
        }

        setRomSource({ romFileName: file.name });
        loadRomBytes(new Uint8Array(buf));
      } catch (err) {
        clearRomChoice();
        info.textContent = err.message;
        log(err.message);
      }
    });

    romChoice.addEventListener('change', () => {
      if (romChoice.value === '') return;

      const entry = archiveRoms[Number(romChoice.value)];
      if (!entry) return;

      try {
        setRomSource({ romFileName: entry.name, archiveFileName: currentArchiveFileName });
        loadRomBytes(entry.data);
      } catch (err) {
        info.textContent = err.message;
        log(err.message);
      }
    });
  }

  return { bindFilePicker, hasRomLoaded, getRomSource };
}
