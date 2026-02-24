const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PackReader = require('./pack-reader');

class Unpacker {
  constructor(gitDir) {
    this.gitDir = gitDir;
    this.objectsDir = path.join(gitDir, 'objects');
    this.packDir = path.join(this.objectsDir, 'pack');
  }

  findPackFiles() {
    if (!fs.existsSync(this.packDir)) {
      throw new Error(`Pack directory not found: ${this.packDir}`);
    }

    const files = fs.readdirSync(this.packDir);
    const packFiles = files.filter(f => f.endsWith('.pack'));

    if (packFiles.length === 0) {
      throw new Error('No pack files found');
    }

    return packFiles.map(f => path.join(this.packDir, f));
  }

  writeObject(sha, type, data) {
    const dir = path.join(this.objectsDir, sha.slice(0, 2));
    const file = path.join(dir, sha.slice(2));

    // Skip if object already exists
    if (fs.existsSync(file)) {
      return false;
    }

    // Create directory if needed
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create Git object format: type + space + size + null + data
    const header = Buffer.from(`${type} ${data.length}\0`);
    const content = Buffer.concat([header, data]);

    // Compress with zlib
    const compressed = zlib.deflateSync(content);

    // Write to file
    fs.writeFileSync(file, compressed);
    return true;
  }

  unpack(options = {}) {
    const { deletePackFiles = false, verbose = false } = options;

    const packFiles = this.findPackFiles();
    let totalObjects = 0;
    let newObjects = 0;

    console.log(`Found ${packFiles.length} pack file(s)`);

    for (const packFile of packFiles) {
      console.log(`\nProcessing: ${path.basename(packFile)}`);

      const reader = new PackReader(packFile, this.objectsDir);
      const objects = reader.parse();

      console.log(`Unpacking ${objects.size} objects...`);

      for (const [sha, obj] of objects) {
        totalObjects++;
        const written = this.writeObject(sha, obj.type, obj.data);
        if (written) {
          newObjects++;
          if (verbose) {
            console.log(`  ${sha} (${obj.type})`);
          }
        }
      }
    }

    console.log(`\nUnpacked ${newObjects} new objects (${totalObjects} total)`);

    if (deletePackFiles) {
      console.log('\nDeleting pack files...');
      for (const packFile of packFiles) {
        const idxFile = packFile.replace('.pack', '.idx');

        fs.unlinkSync(packFile);
        console.log(`  Deleted: ${path.basename(packFile)}`);

        if (fs.existsSync(idxFile)) {
          fs.unlinkSync(idxFile);
          console.log(`  Deleted: ${path.basename(idxFile)}`);
        }
      }
    }

    return { totalObjects, newObjects, packFiles: packFiles.length };
  }
}

module.exports = Unpacker;
