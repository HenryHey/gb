import { hasBatterySram, loadSram, parseHeader, saveSram } from '../cart.js';
import { log, renderCpu } from '../debug.js';
import { loadStateSlot, saveStateSlot } from '../savestate.js';

const SRAM_SAVE_DELAY_MS = 1000;

export function createPersistence({
  getEmu,
  setEmu,
  setRunning,
  resetClock,
  presentFrame,
  updateCopySaveStateBtn,
  info,
}) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let sramSaveTimer = null;
  /** @type {ReturnType<typeof parseHeader> | null} */
  let sramPersistHeader = null;

  function cancelSramSave() {
    if (sramSaveTimer !== null) {
      clearTimeout(sramSaveTimer);
      sramSaveTimer = null;
    }
  }

  function flushSramSave(emuRef = getEmu()) {
    cancelSramSave();
    if (!emuRef?.cart?.ram?.length || !emuRef?.rom?.length) return;
    saveSram(emuRef.cart, emuRef.rom);
  }

  function scheduleSramSave() {
    cancelSramSave();
    const emu = getEmu();
    if (!emu.cart?.ram?.length || !sramPersistHeader || !hasBatterySram(sramPersistHeader.type))
      return;
    sramSaveTimer = setTimeout(() => {
      sramSaveTimer = null;
      const current = getEmu();
      saveSram(current.cart, current.rom);
    }, SRAM_SAVE_DELAY_MS);
  }

  function setSramPersistHeader(header) {
    sramPersistHeader = header;
  }

  function saveState() {
    const emu = getEmu();
    if (emu.rom.length < 0x150) {
      info.textContent = 'Load a ROM before saving state';
      log('Save state: no ROM');
      return;
    }
    try {
      setRunning(false);
      saveStateSlot(emu);
      const header = parseHeader(emu.rom);
      info.textContent = '';
      log(`Saved state — ${header.title}`);
      setRunning(true);
      updateCopySaveStateBtn();
    } catch (err) {
      info.textContent = err.message;
      log(err.message);
    }
  }

  function loadState() {
    const emu = getEmu();
    if (emu.rom.length < 0x150) {
      info.textContent = 'Load a ROM before loading state';
      log('Load state: no ROM');
      return;
    }
    try {
      setRunning(false);
      const loaded = loadStateSlot(emu.rom);
      if (!loaded) {
        info.textContent = 'No saved state for this ROM';
        log(`Load state: nothing saved for ${parseHeader(emu.rom).title}`);
        return;
      }
      setEmu(loaded);
      resetClock();
      presentFrame({ force: true });
      info.textContent = '';
      renderCpu(getEmu().cpu);
      log(`Loaded state — ${parseHeader(getEmu().rom).title}`);
      setRunning(true);
      updateCopySaveStateBtn();
    } catch (err) {
      info.textContent = err.message;
      log(err.message);
      renderCpu(getEmu().cpu);
    }
  }

  function bindSramButtons(loadSramBtn, saveSramBtn) {
    loadSramBtn.addEventListener('click', () => {
      try {
        const emu = getEmu();
        const header = parseHeader(emu.rom);
        if (!hasBatterySram(header.type) || !emu.cart.ram?.length) {
          info.textContent = 'No battery SRAM on this cart';
          log('Load SRAM: no SRAM');
          return;
        }
        if (loadSram(emu.cart, emu.rom)) {
          info.textContent = '';
          log(`Loaded SRAM (${emu.cart.ram.length} bytes) — ${header.title}`);
        } else {
          info.textContent = 'No saved SRAM for this ROM';
          log(`Load SRAM: nothing saved for ${header.title}`);
        }
      } catch (err) {
        info.textContent = err.message;
        log(err.message);
      }
    });

    saveSramBtn.addEventListener('click', () => {
      try {
        const emu = getEmu();
        const header = parseHeader(emu.rom);
        if (!hasBatterySram(header.type) || !emu.cart.ram?.length) {
          info.textContent = 'No battery SRAM on this cart';
          log('Save SRAM: no SRAM');
          return;
        }
        cancelSramSave();
        saveSram(emu.cart, emu.rom);
        info.textContent = '';
        log(`Saved SRAM (${emu.cart.ram.length} bytes) — ${header.title}`);
      } catch (err) {
        info.textContent = err.message;
        log(err.message);
      }
    });
  }

  return {
    scheduleSramSave,
    flushSramSave,
    cancelSramSave,
    setSramPersistHeader,
    saveState,
    loadState,
    bindSramButtons,
  };
}
