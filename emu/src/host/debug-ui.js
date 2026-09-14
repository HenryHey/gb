import { log } from '../debug.js';
import { getSavedStateRaw, savedStateToJson } from '../savestate.js';

export function createDebugUi({ debugUi, copySaveStateBtn, getEmu, getRomSource, syncRomUi }) {
  function updateCopySaveStateBtn() {
    if (!copySaveStateBtn) return;
    const emu = getEmu();
    const hasSlot =
      debugUi.checked && emu.rom.length >= 0x150 && getSavedStateRaw(emu.rom) !== null;
    copySaveStateBtn.disabled = !hasSlot;
  }

  function syncDebugUi() {
    document.body.classList.toggle('debug-ui', debugUi.checked);
    syncRomUi();
    updateCopySaveStateBtn();
  }

  function bindCopySaveStateBtn(info) {
    copySaveStateBtn.addEventListener('click', async () => {
      try {
        const { romFileName, archiveFileName } = getRomSource();
        const payload = savedStateToJson(getEmu().rom, {
          romFileName: romFileName ?? undefined,
          archiveFileName: archiveFileName ?? undefined,
        });
        if (!payload) {
          info.textContent = 'No saved state for this ROM';
          log('Copy save state: nothing saved');
          updateCopySaveStateBtn();
          return;
        }
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        info.textContent = '';
        log(`Copied save state to clipboard (${payload.title})`);
      } catch (err) {
        info.textContent = err.message;
        log(err.message);
      }
    });
  }

  return { syncDebugUi, updateCopySaveStateBtn, bindCopySaveStateBtn };
}
