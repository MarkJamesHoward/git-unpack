const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

// Git object types
const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;

const TYPE_NAMES = {
  [OBJ_COMMIT]: 'commit',
  [OBJ_TREE]: 'tree',
  [OBJ_BLOB]: 'blob',
  [OBJ_TAG]: 'tag'
};

const path = require('path');

class PackReader {
  constructor(packPath, objectsDir = null) {
    this.packPath = packPath;
    this.objectsDir = objectsDir;
    this.buffer = fs.readFileSync(packPath);
    this.offset = 0;
    this.objects = new Map(); // sha -> { type, data }
    this.offsetToSha = new Map(); // offset -> sha (for OFS_DELTA)
    this.pendingDeltas = []; // deltas that need resolution
  }

  // Read a loose object from the objects directory (for thin packs)
  readLooseObject(sha) {
    if (!this.objectsDir) return null;

    const objectPath = path.join(this.objectsDir, sha.slice(0, 2), sha.slice(2));
    if (!fs.existsSync(objectPath)) return null;

    try {
      const compressed = fs.readFileSync(objectPath);
      const data = zlib.inflateSync(compressed);

      // Parse the header: "type size\0"
      const nullIndex = data.indexOf(0);
      const header = data.slice(0, nullIndex).toString();
      const [type, sizeStr] = header.split(' ');
      const content = data.slice(nullIndex + 1);

      return { type, data: content };
    } catch (e) {
      return null;
    }
  }

  read(length) {
    const data = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  readUInt32BE() {
    const val = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  parse() {
    // Parse header
    const signature = this.read(4).toString('ascii');
    if (signature !== 'PACK') {
      throw new Error(`Invalid pack signature: ${signature}`);
    }

    const version = this.readUInt32BE();
    if (version !== 2 && version !== 3) {
      throw new Error(`Unsupported pack version: ${version}`);
    }

    const numObjects = this.readUInt32BE();
    console.log(`Pack file: version ${version}, ${numObjects} objects`);

    // First pass: read all objects
    for (let i = 0; i < numObjects; i++) {
      this.readObject();
    }

    // Second pass: resolve deltas
    this.resolveDeltas();

    return this.objects;
  }

  readObject() {
    const objectOffset = this.offset;

    // Read variable-length type and size
    let byte = this.buffer[this.offset++];
    const type = (byte >> 4) & 0x07;
    let size = byte & 0x0f;
    let shift = 4;

    while (byte & 0x80) {
      byte = this.buffer[this.offset++];
      size |= (byte & 0x7f) << shift;
      shift += 7;
    }

    let data;
    let baseOffset;
    let baseSha;

    if (type === OBJ_OFS_DELTA) {
      // Offset delta - base object is at a negative offset
      baseOffset = this.readOffsetDelta(objectOffset);
      data = this.decompressData();
      this.pendingDeltas.push({ objectOffset, type, size, data, baseOffset });
      return;
    } else if (type === OBJ_REF_DELTA) {
      // Reference delta - base object is referenced by SHA
      baseSha = this.read(20).toString('hex');
      data = this.decompressData();
      this.pendingDeltas.push({ objectOffset, type, size, data, baseSha });
      return;
    } else {
      // Regular object
      data = this.decompressData();
    }

    const typeName = TYPE_NAMES[type];
    if (!typeName) {
      throw new Error(`Unknown object type: ${type}`);
    }

    const sha = this.computeSha(typeName, data);
    this.objects.set(sha, { type: typeName, data });
    this.offsetToSha.set(objectOffset, sha);
  }

  readOffsetDelta(objectOffset) {
    let byte = this.buffer[this.offset++];
    let offset = byte & 0x7f;

    while (byte & 0x80) {
      byte = this.buffer[this.offset++];
      offset = ((offset + 1) << 7) | (byte & 0x7f);
    }

    return objectOffset - offset;
  }

  decompressData() {
    // Use streaming approach to properly track consumed input bytes
    const startOffset = this.offset;
    const remaining = this.buffer.slice(this.offset);

    // Create an inflate stream that will process only what it needs
    const result = this.inflateWithConsumedBytes(remaining);

    this.offset += result.bytesConsumed;
    return result.data;
  }

  inflateWithConsumedBytes(input) {
    // Try using the synchronous API with different chunk sizes
    // to find the exact boundary of the zlib stream

    // First, try to decompress - if it works with all data, we need to find the boundary
    let data;
    let bytesConsumed;

    // Use a custom approach: decompress and track consumed bytes
    // by using the inflate flush behavior
    try {
      // Try with all remaining data first
      data = zlib.inflateSync(input);
      // If successful, binary search for minimum required bytes
      bytesConsumed = this.findMinimumInflateSize(input, data.length);
      return { data, bytesConsumed };
    } catch (e) {
      // If "unexpected end of file", the data might be incomplete
      // If there's trailing garbage, we need to find the end
      if (e.message.includes('unexpected end') || e.message.includes('invalid')) {
        // Try incremental approach
        return this.incrementalInflate(input);
      }
      throw e;
    }
  }

  findMinimumInflateSize(input, expectedOutputSize) {
    // Binary search to find the minimum input size that produces the expected output
    let low = 2; // Minimum zlib stream is at least 2 bytes (header)
    let high = input.length;
    let lastGood = high;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      try {
        const result = zlib.inflateSync(input.slice(0, mid));
        if (result.length === expectedOutputSize) {
          lastGood = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      } catch (e) {
        low = mid + 1;
      }
    }

    return lastGood;
  }

  incrementalInflate(input) {
    // Try inflating with increasing amounts of input data
    // This handles cases where the stream has trailing data
    let lastValidData = null;
    let lastValidSize = 0;

    // Start with a reasonable chunk and increase
    for (let size = 10; size <= input.length; size += Math.max(1, Math.floor(size / 10))) {
      try {
        const chunk = input.slice(0, size);
        const data = zlib.inflateSync(chunk);
        lastValidData = data;
        lastValidSize = size;

        // Found a valid decompress, now binary search for minimum
        const minSize = this.findMinimumInflateSize(input, data.length);
        return { data, bytesConsumed: minSize };
      } catch (e) {
        // Keep trying with more data
        continue;
      }
    }

    // Last resort: try with all data
    try {
      const data = zlib.inflateSync(input);
      return { data, bytesConsumed: input.length };
    } catch (e) {
      if (lastValidData) {
        return { data: lastValidData, bytesConsumed: lastValidSize };
      }
      throw new Error(`Failed to decompress: ${e.message}`);
    }
  }

  resolveDeltas() {
    let resolved = true;
    let iterations = 0;
    const maxIterations = this.pendingDeltas.length + 1;

    while (resolved && this.pendingDeltas.length > 0 && iterations < maxIterations) {
      resolved = false;
      iterations++;

      const stillPending = [];

      for (const delta of this.pendingDeltas) {
        let baseSha;
        let baseObj;

        if (delta.baseOffset !== undefined) {
          baseSha = this.offsetToSha.get(delta.baseOffset);
          if (baseSha) {
            baseObj = this.objects.get(baseSha);
          }
        } else {
          baseSha = delta.baseSha;
          baseObj = this.objects.get(baseSha);

          // Try to read from loose objects (thin pack support)
          if (!baseObj) {
            baseObj = this.readLooseObject(baseSha);
            if (baseObj) {
              // Cache it for future deltas
              this.objects.set(baseSha, baseObj);
            }
          }
        }

        if (!baseObj) {
          stillPending.push(delta);
          continue;
        }

        const resolvedData = this.applyDelta(baseObj.data, delta.data);
        const sha = this.computeSha(baseObj.type, resolvedData);

        this.objects.set(sha, { type: baseObj.type, data: resolvedData });
        this.offsetToSha.set(delta.objectOffset, sha);
        resolved = true;
      }

      this.pendingDeltas = stillPending;
    }

    if (this.pendingDeltas.length > 0) {
      console.warn(`Warning: ${this.pendingDeltas.length} delta objects could not be resolved`);
    }
  }

  applyDelta(baseData, deltaData) {
    let offset = 0;

    // Read base size (variable length)
    let baseSize = 0;
    let shift = 0;
    let byte;
    do {
      byte = deltaData[offset++];
      baseSize |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    // Read result size (variable length)
    let resultSize = 0;
    shift = 0;
    do {
      byte = deltaData[offset++];
      resultSize |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    const result = Buffer.alloc(resultSize);
    let resultOffset = 0;

    while (offset < deltaData.length) {
      const cmd = deltaData[offset++];

      if (cmd & 0x80) {
        // Copy from base
        let copyOffset = 0;
        let copySize = 0;

        if (cmd & 0x01) copyOffset |= deltaData[offset++];
        if (cmd & 0x02) copyOffset |= deltaData[offset++] << 8;
        if (cmd & 0x04) copyOffset |= deltaData[offset++] << 16;
        if (cmd & 0x08) copyOffset |= deltaData[offset++] << 24;

        if (cmd & 0x10) copySize |= deltaData[offset++];
        if (cmd & 0x20) copySize |= deltaData[offset++] << 8;
        if (cmd & 0x40) copySize |= deltaData[offset++] << 16;

        if (copySize === 0) copySize = 0x10000;

        baseData.copy(result, resultOffset, copyOffset, copyOffset + copySize);
        resultOffset += copySize;
      } else if (cmd) {
        // Insert new data
        deltaData.copy(result, resultOffset, offset, offset + cmd);
        offset += cmd;
        resultOffset += cmd;
      } else {
        throw new Error('Invalid delta command: 0');
      }
    }

    return result;
  }

  computeSha(type, data) {
    const header = Buffer.from(`${type} ${data.length}\0`);
    const full = Buffer.concat([header, data]);
    return crypto.createHash('sha1').update(full).digest('hex');
  }
}

module.exports = PackReader;
