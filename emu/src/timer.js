function incrementTima(io) {
  io.tima = (io.tima + 1) & 0xff;
  if (io.tima === 0) {
    io.tima = io.tma;
    io.requestIf(2);
  }
}

export function timerStep(io, tCycles) {
  for (let i = 0; i < tCycles; i++) {
    io.divCounter = (io.divCounter + 1) & 0xffff;
    if (!(io.tac & 0x04)) continue;
    const bit = [9, 3, 5, 7][io.tac & 3];
    const oldBit = (io.divCounter - 1) & (1 << bit);
    const newBit = io.divCounter & (1 << bit);
    if (oldBit && !newBit) incrementTima(io);
  }
}
