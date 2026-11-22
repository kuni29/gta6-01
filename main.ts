// Neon Coast Heat — build entry point.
//
// Running this program with Node assembles the deliverable in the directory
// named by the MAKEFUN_OUTPUT_DIR environment variable (falling back to
// /output when that variable is unset or empty):
//
//   <output>/game/          a copy of this repository's game/ tree
//   <output>/screenshots/   a copy of this repository's screenshots/ tree
//   <output>/dossier.json   the makefun/dossier/v1 dossier of that output
//
// The dossier is produced by the vendored library in vendor/makefun-game.ts,
// called with the bounty's gate caps, so the bytes written here are exactly
// the bytes the scorer reproduces from game/ and screenshots/. Only the
// Node standard library is used, and the file is plain JavaScript in a .ts
// wrapper, so Node 22 runs it directly with no build step.
//
// The output directory itself is never removed: the grader pre-creates it
// under a parent this program cannot write to, so deleting the directory
// would fail. Instead the directory is created when missing and each entry
// inside it is removed before the fresh build is written.

import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, readGameTree } from './vendor/makefun-game.ts';

// The gate caps the dossier is built under. Only text_max_bytes shapes the
// dossier's bytes; the rest refuse input past the bounty's limits.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

// This repository's root: the directory holding this file, wherever the
// repository has been copied to and whatever the working directory is.
const root = fileURLToPath(new URL('.', import.meta.url));

// Where the build goes, as an absolute path with no trailing separator.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR
  ? resolve(process.env.MAKEFUN_OUTPUT_DIR)
  : '/output';

// Prepare the output directory: create it when it is missing, then empty it
// entry by entry, leaving the directory itself in place.
mkdirSync(outputDir, { recursive: true });
for (const entry of readdirSync(outputDir)) {
  rmSync(join(outputDir, entry), { recursive: true, force: true });
}

// Copy the playable game and its screenshots into the output.
cpSync(join(root, 'game'), join(outputDir, 'game'), { recursive: true });
cpSync(join(root, 'screenshots'), join(outputDir, 'screenshots'), {
  recursive: true,
});

// Build the dossier from the assembled output and write it alongside the
// copies it describes.
const dossier = buildDossier(outputDir, CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);
const dossierSha256 = createHash('sha256').update(dossier).digest('hex');

// Report the build, in the order the pieces were produced.
const tree = readGameTree(join(root, 'game'), {
  game_max_files: CAPS.game_max_files,
  game_max_bytes: CAPS.game_max_bytes,
});
const gameBytes = tree.totalBytes;

const shotNames = readdirSync(join(root, 'screenshots'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const shotSizes = shotNames.map(
  (name) => statSync(join(root, 'screenshots', name)).size,
);
// The dossier embeds the same screenshot bytes that were copied out; read
// one back so a failed copy cannot go unnoticed behind a good report.
readFileSync(join(outputDir, 'screenshots', shotNames[0]));

console.log('Neon Coast Heat — build complete');
console.log(`output: ${outputDir}`);
console.log(
  `game: ${tree.files.length} files, ${gameBytes} bytes, ${tree.count} entries ` +
    `(cap ${CAPS.game_max_files} / ${CAPS.game_max_bytes} bytes)`,
);
shotNames.forEach((name, i) => {
  console.log(`screenshot: ${name} (${shotSizes[i]} bytes)`);
});
console.log(
  `dossier.json: ${dossier.length} bytes, sha256 ${dossierSha256}`,
);
console.log(
  `screenshots: ${shotNames.length} files, first by name is the cover (${shotNames[0]})`,
);
