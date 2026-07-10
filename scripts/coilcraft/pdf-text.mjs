// Minimal, dependency-free PDF text extraction.
//
// Coilcraft datasheets store their text in FlateDecode-compressed content
// streams using standard PDF text-showing operators. We inflate every stream
// with Node's zlib, then pull the literal strings out of `Tj`/`TJ` operators.
// This is deliberately small: it is enough to recover the electrical-spec
// tables, not a general-purpose PDF renderer.

import zlib from "node:zlib";

const STREAM = Buffer.from("stream");
const ENDSTREAM = Buffer.from("endstream");

function inflate(raw) {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try {
      return fn(raw);
    } catch {
      // Try the next decoder; some streams are raw-deflate, some are zlib.
    }
  }
  return null;
}

function decodeStreams(buffer) {
  const streams = [];
  let index = 0;
  while (true) {
    const start = buffer.indexOf(STREAM, index);
    if (start === -1) break;
    let dataStart = start + STREAM.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const end = buffer.indexOf(ENDSTREAM, dataStart);
    if (end === -1) break;
    let dataEnd = end;
    if (buffer[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (buffer[dataEnd - 1] === 0x0d) dataEnd -= 1;
    index = end + ENDSTREAM.length;
    const decoded = inflate(buffer.subarray(dataStart, dataEnd));
    if (decoded) streams.push(decoded);
  }
  return streams;
}

const ESCAPE_MAP = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };

// Extract text from a single decoded content stream. Literal strings inside a
// `[ ... ] TJ` array are concatenated with no separator (so a number split by a
// kerning adjustment such as `(8.)-250(89)` rejoins as `8.89`), while the `TJ`
// operator itself and the text-positioning operators (`Td`, `TD`, `T*`) emit a
// separator so adjacent table cells stay distinct.
function extractStreamText(stream) {
  const text = stream.toString("latin1");
  const length = text.length;
  let out = "";
  let i = 0;
  while (i < length) {
    const ch = text[i];
    if (ch === "(") {
      let depth = 1;
      i += 1;
      let str = "";
      while (i < length && depth > 0) {
        const c = text[i];
        if (c === "\\") {
          const next = text[i + 1];
          if (next in ESCAPE_MAP) {
            str += ESCAPE_MAP[next];
            i += 2;
          } else if (next >= "0" && next <= "7") {
            let octal = next;
            i += 2;
            let taken = 0;
            while (taken < 2 && text[i] >= "0" && text[i] <= "7") {
              octal += text[i];
              i += 1;
              taken += 1;
            }
            str += String.fromCharCode(parseInt(octal, 8));
          } else {
            str += next ?? "";
            i += 2;
          }
        } else if (c === "(") {
          depth += 1;
          str += c;
          i += 1;
        } else if (c === ")") {
          depth -= 1;
          if (depth > 0) str += c;
          i += 1;
        } else {
          str += c;
          i += 1;
        }
      }
      out += str;
    } else if (ch === "T" && text[i + 1] === "J") {
      out += " ";
      i += 2;
    } else if (ch === "T" && (text[i + 1] === "d" || text[i + 1] === "D" || text[i + 1] === "*")) {
      out += "\n";
      i += 2;
    } else {
      i += 1;
    }
  }
  return out;
}

// Recover the readable text of a PDF buffer as a single string.
export function extractPdfText(buffer) {
  return decodeStreams(buffer)
    .map(extractStreamText)
    .filter((chunk) => /[A-Za-z0-9]/.test(chunk))
    .join("\n");
}
