export function bindInput({ getEmu, saveState, loadState }) {
  function mapKey(code, down) {
    const j = getEmu().io.joypad;
    switch (code) {
      case 'ArrowDown':
      case 'KeyS':
        j.down = down;
        return true;
      case 'ArrowUp':
      case 'KeyW':
        j.up = down;
        return true;
      case 'ArrowLeft':
      case 'KeyA':
        j.left = down;
        return true;
      case 'ArrowRight':
      case 'KeyD':
        j.right = down;
        return true;
      case 'KeyZ':
      case 'KeyJ':
        j.a = down;
        return true;
      case 'KeyX':
      case 'KeyK':
        j.b = down;
        return true;
      case 'Enter':
        j.start = down;
        return true;
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'Backspace':
        j.select = down;
        return true;
      default:
        return false;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Digit1') {
      e.preventDefault();
      saveState();
      return;
    }
    if (e.code === 'Digit0') {
      e.preventDefault();
      loadState();
      return;
    }
    if (mapKey(e.code, true)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => mapKey(e.code, false));
}
