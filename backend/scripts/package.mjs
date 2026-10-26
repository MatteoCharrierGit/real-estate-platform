// dist/<nome>.zip con index.js alla radice. Scrittore ZIP minimale in Node (nessun comando di sistema necessario):
// un solo file per archivio, compresso con deflate, data fissa così lo zip è riproducibile.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { functionNames, root } from "./functions.mjs";

export function zipSingleFile(name, content) {
  const nameBuf = Buffer.from(name);
  const data = deflateRawSync(content, { level: 9 });
  const crc = crc32(content);
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1; // 1980-01-01

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // versione necessaria
  local.writeUInt16LE(0x0800, 6); // flag: nome in UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // creato su Unix
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // permessi rw-r--r--

  const localPart = Buffer.concat([local, nameBuf, data]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const name of functionNames) {
    const index = join(root, "dist", name, "index.js");
    if (!existsSync(index)) throw new Error(`manca ${index}: esegui prima npm run build`);
    const zip = zipSingleFile("index.js", readFileSync(index));
    const out = join(root, "dist", `${name}.zip`);
    writeFileSync(out, zip);
    console.log(`packaged dist/${name}.zip (${(zip.length / 1024).toFixed(0)} KiB)`);
  }
}
