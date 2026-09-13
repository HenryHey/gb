# Third-Party Notices

This file lists material included in or used by the **Game Boy Emulator Tutorial** repository that is not covered by the project [MIT License](LICENSE).

---

## Test ROMs (`test_carts/`)

These ROMs are **not commercial games**. They are homebrew test programs used by `bun test` and `bun run test:mooneye`. Do not redistribute them outside emulator-development contexts without checking each upstream’s terms.

### Blargg hardware test ROMs

| Field | Detail |
| --- | --- |
| **Author** | Shay Green (“Blargg”) — gblargg@gmail.com |
| **In this repo** | `test_carts/blargg/` |
| **Upstream** | [retrio/gb-test-roms](https://github.com/retrio/gb-test-roms) (mirror); [blargg.8bitalley.com/parodius/gb-tests/](https://blargg.8bitalley.com/parodius/gb-tests/) (official archive) |
| **Suites vendored** | `cpu_instrs`, `instr_timing`, `mem_timing`, `mem_timing-2`, `dmg_sound`, `cgb_sound`, `oam_bug`, `interrupt_time`, `halt_bug.gb` |
| **License** | Source is included under each suite’s `source/` directory. The vendored copy does not ship a standalone license file. Treat as Shay Green’s test ROMs for emulator development; confirm terms with upstream before wider redistribution. |

Per-suite readmes (e.g. `test_carts/blargg/cpu_instrs/readme.txt`) describe behavior and build instructions.

### Mooneye Test Suite

| Field | Detail |
| --- | --- |
| **Author** | Joonas Javanainen (“Gekkio”) — joonas.javanainen@gmail.com |
| **In this repo** | `test_carts/mooneye/acceptance/` (75 `.gb` acceptance ROMs) |
| **Version** | Recorded in `test_carts/mooneye/acceptance/VERSION` |
| **Upstream** | [Gekkio/mooneye-test-suite](https://github.com/Gekkio/mooneye-test-suite) |
| **License** | MIT (reproduced below) |

```
Copyright (c) 2014-2022 Joonas Javanainen <joonas.javanainen@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## npm packages (`emu/`)

Versions match [`emu/package.json`](emu/package.json) and [`emu/bun.lock`](emu/bun.lock) at release time.

### Runtime dependency (bundled in the browser build)

| Package | Version | License | Notes |
| --- | --- | --- | --- |
| [7z-wasm](https://github.com/use-strict/7z-wasm) | 1.2.0 | GNU LGPL 2.1 + [unRAR restriction](https://github.com/use-strict/7z-wasm) | Wraps Igor Pavlov’s 7-Zip (LGPL). Used for `.7z` ROM archive extraction in the host. Full text: `emu/node_modules/7z-wasm/License.txt` after `bun install`. |

### Development dependencies (build, test, and lint only — not shipped in the static site)

| Package | License |
| --- | --- |
| vite | MIT |
| eslint | MIT |
| @eslint/js | MIT |
| eslint-config-prettier | MIT |
| eslint-plugin-prettier | MIT |
| prettier | MIT |
| globals | MIT |

Full license texts for installed packages are in `emu/node_modules/<package>/` after `bun install`.

---

## External references (not vendored)

Tutorials, Pan Docs, and other links cited in [`course/`](course/) and [`docs/SOURCES.md`](docs/SOURCES.md) are **not** included in this repository.

## Trademarks

“Game Boy” and related Nintendo trademarks belong to Nintendo. This project is an educational emulator and is not affiliated with Nintendo.
