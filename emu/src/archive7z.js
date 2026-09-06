import SevenZip from '7z-wasm';

let sevenZipPromise = null;

function getSevenZip() {
  if (!sevenZipPromise) {
    sevenZipPromise = SevenZip({ print: () => {}, printErr: () => {} });
  }
  return sevenZipPromise;
}

const ROM_EXT = /\.(gb|gbc)$/i;

function walkFiles(sevenZip, dir, base = '') {
  const paths = [];
  for (const name of sevenZip.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const full = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    const mode = sevenZip.FS.stat(full).mode;
    if (sevenZip.FS.isDir(mode)) {
      paths.push(...walkFiles(sevenZip, full, rel));
    } else if (ROM_EXT.test(name)) {
      paths.push(rel);
    }
  }
  return paths;
}

function rmTree(sevenZip, path) {
  let stat;
  try {
    stat = sevenZip.FS.stat(path);
  } catch {
    return;
  }
  if (sevenZip.FS.isDir(stat.mode)) {
    for (const name of sevenZip.FS.readdir(path)) {
      if (name === '.' || name === '..') continue;
      rmTree(sevenZip, `${path}/${name}`);
    }
    sevenZip.FS.rmdir(path);
  } else {
    sevenZip.FS.unlink(path);
  }
}

/**
 * Extract Game Boy ROMs from a .7z archive.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<Array<{ path: string, name: string, data: Uint8Array }>>}
 */
export async function extractRomsFrom7z(arrayBuffer) {
  const sevenZip = await getSevenZip();
  const session = crypto.randomUUID();
  const archiveName = `arc_${session}.7z`;
  const outDir = `/out_${session}`;

  try {
    sevenZip.FS.writeFile(archiveName, new Uint8Array(arrayBuffer));
    sevenZip.FS.mkdir(outDir);

    for (const pattern of ['*.gb', '*.gbc']) {
      try {
        sevenZip.callMain(['x', '-y', `-o${outDir}`, archiveName, '-r', pattern]);
      } catch {
        // No files matching this pattern.
      }
    }

    const paths = walkFiles(sevenZip, outDir).sort((a, b) => a.localeCompare(b));
    if (paths.length === 0) {
      throw new Error('No .gb or .gbc ROM found in archive');
    }

    return paths.map((path) => {
      const data = sevenZip.FS.readFile(`${outDir}/${path}`);
      return { path, name: path.split('/').pop(), data: new Uint8Array(data) };
    });
  } finally {
    try {
      sevenZip.FS.unlink(archiveName);
    } catch {
      // Archive already removed.
    }
    rmTree(sevenZip, outDir);
  }
}
