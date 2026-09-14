import { log, renderCpu } from '../debug.js';
import { runFrame } from '../emu.js';

const FRAME_MS = 1000 / 59.7275;
const MAX_CATCHUP = 5;

export function createClock({ getEmu, presentFrame, playBtn, info }) {
  let running = false;
  let clockOrigin = 0;
  let framesDone = 0;
  let pauseStarted = 0;
  let pausedTotal = 0;

  function resetClock() {
    clockOrigin = 0;
    framesDone = 0;
    pauseStarted = 0;
    pausedTotal = 0;
  }

  function setRunning(on) {
    const now = performance.now();
    if (on && !running) {
      if (clockOrigin === 0) clockOrigin = now;
      if (pauseStarted) {
        pausedTotal += now - pauseStarted;
        pauseStarted = 0;
      }
    } else if (!on && running) {
      pauseStarted = now;
    }
    running = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
  }

  function advanceOneFrame({ logFrame = false, blitFrame = true } = {}) {
    const emu = getEmu();
    const { cpu } = emu;
    const pcBefore = cpu.pc;
    const t = runFrame(emu);
    framesDone++;
    if (blitFrame) presentFrame({ force: true });
    info.textContent = '';
    if (logFrame) {
      const haltNote = cpu.halted ? ' (HALT spin)' : '';
      log(
        `Frame ${t}T${haltNote}  PC $${pcBefore.toString(16).padStart(4, '0').toUpperCase()} → $${cpu.pc.toString(16).padStart(4, '0').toUpperCase()}`,
      );
    }
  }

  function hostTick(now) {
    try {
      if (running && clockOrigin !== 0) {
        const pausedNow = pauseStarted ? now - pauseStarted : 0;
        const elapsed = now - clockOrigin - pausedTotal - pausedNow;
        const target = Math.floor(elapsed / FRAME_MS);
        let catchup = 0;
        while (framesDone < target && catchup < MAX_CATCHUP) {
          runFrame(getEmu());
          framesDone++;
          catchup++;
        }
      }
    } catch (err) {
      setRunning(false);
      info.textContent = err.message;
      log(err.message);
      renderCpu(getEmu().cpu);
    }

    if (running) presentFrame();
    requestAnimationFrame(hostTick);
  }

  function start() {
    requestAnimationFrame(hostTick);
  }

  return {
    start,
    resetClock,
    setRunning,
    advanceOneFrame,
    isRunning: () => running,
  };
}
