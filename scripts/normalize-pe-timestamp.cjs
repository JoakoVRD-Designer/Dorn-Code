"use strict";

const fs = require("node:fs");

for (const filePath of process.argv.slice(2)) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 256 || buffer.toString("ascii", 0, 2) !== "MZ") throw new Error(`No es PE: ${filePath}`);
  const pe = buffer.readUInt32LE(0x3c);
  if (pe + 24 >= buffer.length || buffer.toString("ascii", pe, pe + 4) !== "PE\0\0" || buffer.readUInt16LE(pe + 4) !== 0x8664) throw new Error(`No es PE32+ x64: ${filePath}`);
  const timestamp = Number(process.env.SOURCE_DATE_EPOCH || 1788307200);
  buffer.writeUInt32LE(timestamp >>> 0, pe + 8);
  fs.writeFileSync(filePath, buffer);
  console.log(`Timestamp PE normalizado · ${filePath}`);
}
