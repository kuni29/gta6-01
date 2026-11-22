// main.ts — Neon Coast Heat's entrypoint: it hands the game in.
//
// It copies game/ and screenshots/ from this repository into the output
// directory (MAKEFUN_OUTPUT_DIR outside the grader, /output inside it),
// refuses anything past the bounty's caps before the dossier is built, writes
// /output/dossier.json with the kit's buildDossier, and prints a short summary.
//
// The program is deterministic: it writes no timestamps and copies files in
// sorted order, so two runs into two directories produce byte-identical output.
// Node 22 runs this file as-is; it uses the standard library only.

import { buildDossier } from './vendor/makefun-game.ts';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ caps
// The bounty's gate, from the kit's RULES.txt: game/ holds at most 993 files
// and directories together and 48 MiB, screenshots/ at most 4 images of
// 256 KiB each, the dossier's text at most 160 KiB, the dossier itself at
// most 1.5 MiB. Passing the same caps to buildDossier makes it refuse exactly
// where the scorer would.

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
} as const;
const DOSSIER_MAX_BYTES = 1536 * 1024;
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** Fail the run with a plain message (the grader shows it as the error). */
function fail(message: string): never {
  throw new Error(`main.ts: ${message}`);
}

/** sha256 of bytes, hex — the summary's fingerprint of the dossier. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** True when the bytes start with the given magic numbers. */
function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

// ------------------------------------------------------------------ walking

/** One entry found under a directory, with its path relative to that directory. */
interface Entry {
  rel: string;
  isDir: boolean;
  bytes: number;
}

/** Every file and directory under `dir`, in sorted path order. */
function walk(dir: string, relBase = ''): Entry[] {
  const out: Entry[] = [];
  const names = readdirSync(dir).sort();
  for (const name of names) {
    const rel = relBase === '' ? name : `${relBase}/${name}`;
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) fail(`${rel}: a symbolic link (game/ holds plain files only)`);
    if (st.isDirectory()) {
      out.push({ rel, isDir: true, bytes: 0 });
      out.push(...walk(full, rel));
    } else if (st.isFile()) {
      out.push({ rel, isDir: false, bytes: st.size });
    } else {
      fail(`${rel}: not a plain file or directory`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ checks

/** The game tree's own cap check, run before the copy so a bad tree fails fast. */
function checkGameTree(gameDir: string): { files: number; bytes: number } {
  if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) {
    fail('game/: no such directory');
  }
  const entries = walk(gameDir);
  const files = entries.filter((e) => !e.isDir);
  const totalBytes = files.reduce((n, e) => n + e.bytes, 0);
  if (entries.length > CAPS.game_max_files) {
    fail(`game/: ${entries.length} files and directories, over the ${CAPS.game_max_files} allowed`);
  }
  if (totalBytes > CAPS.game_max_bytes) {
    fail(`game/: ${totalBytes} bytes, over the ${CAPS.game_max_bytes} allowed`);
  }
  for (const e of entries) {
    if (Buffer.byteLength(e.rel, 'utf8') > CAPS.game_path_max_bytes) {
      fail(`game/${e.rel}: a path over the ${CAPS.game_path_max_bytes} bytes allowed`);
    }
  }
  const index = join(gameDir, 'index.html');
  if (!existsSync(index) || !statSync(index).isFile()) fail('game/index.html: no such file');
  if (statSync(index).size > 1024 * 1024) fail('game/index.html: over the 1 MiB allowed');
  return { files: files.length, bytes: totalBytes };
}

/** The screenshots' own cap check: 3 or 4 PNG/JPEG files, each within its cap. */
function checkScreenshots(shotsDir: string): { name: string; bytes: number }[] {
  if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
    fail('screenshots/: no such directory');
  }
  const names = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
  if (names.length < 3 || names.length > CAPS.screenshots.max) {
    fail(`screenshots/: ${names.length} images, need 3 to ${CAPS.screenshots.max}`);
  }
  const found: { name: string; bytes: number }[] = [];
  for (const name of names) {
    if (!SCREENSHOT_NAME.test(name)) fail(`screenshots/${name}: a name the gate will not take`);
    const full = join(shotsDir, name);
    if (!statSync(full).isFile()) fail(`screenshots/${name}: not a file`);
    const bytes = readFileSync(full);
    if (bytes.length > CAPS.screenshots.max_bytes) {
      fail(`screenshots/${name}: ${bytes.length} bytes, over the ${CAPS.screenshots.max_bytes} allowed`);
    }
    if (!startsWith(bytes, PNG_MAGIC) && !startsWith(bytes, JPEG_MAGIC)) {
      fail(`screenshots/${name}: neither PNG nor JPEG`);
    }
    found.push({ name, bytes: bytes.length });
  }
  return found;
}

/** Copy a tree in sorted order, so the copy's bytes never depend on readdir order. */
function copyTree(srcDir: string, dstDir: string): void {
  mkdirSync(dstDir, { recursive: true });
  for (const name of readdirSync(srcDir).sort()) {
    const src = join(srcDir, name);
    const dst = join(dstDir, name);
    const st = lstatSync(src);
    if (st.isDirectory()) copyTree(src, dst);
    else if (st.isFile()) copyFileSync(src, dst);
    else fail(`${src}: not a plain file or directory`);
  }
}

// ------------------------------------------------------------------ main

function main(): void {
  const root = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
  // Never let the output directory eat the repository itself.
  if (outDir === root || root.startsWith(`${outDir}/`)) {
    fail(`MAKEFUN_OUTPUT_DIR (${outDir}) must not hold the repository (${root})`);
  }
  const gameDir = join(root, 'game');
  const shotsDir = join(root, 'screenshots');

  const game = checkGameTree(gameDir);
  const shots = checkScreenshots(shotsDir);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyTree(gameDir, join(outDir, 'game'));
  copyTree(shotsDir, join(outDir, 'screenshots'));

  const dossier = buildDossier(outDir, {
    text_max_bytes: CAPS.text_max_bytes,
    screenshots: { max: CAPS.screenshots.max, max_bytes: CAPS.screenshots.max_bytes },
    game_max_files: CAPS.game_max_files,
    game_max_bytes: CAPS.game_max_bytes,
    game_path_max_bytes: CAPS.game_path_max_bytes,
  });
  if (dossier.length > DOSSIER_MAX_BYTES) {
    fail(`dossier.json: ${dossier.length} bytes, over the ${DOSSIER_MAX_BYTES} allowed`);
  }
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const writtenBack = readFileSync(join(outDir, 'dossier.json'));
  if (!writtenBack.equals(Buffer.from(dossier))) fail('dossier.json: what was written is not what was built');

  const gameEntries = walk(join(outDir, 'game')).length;
  console.log('Neon Coast Heat — build complete');
  console.log(`output: ${outDir}`);
  console.log(`game: ${game.files} files, ${game.bytes} bytes, ${gameEntries} entries (cap ${CAPS.game_max_files} / ${CAPS.game_max_bytes} bytes)`);
  for (const shot of shots) console.log(`screenshot: ${shot.name} (${shot.bytes} bytes)`);
  console.log(`dossier.json: ${dossier.length} bytes, sha256 ${sha256Hex(dossier)}`);
  console.log(`screenshots: ${shots.length} files, first by name is the cover (${basename(shots[0]!.name)})`);
}

main();
