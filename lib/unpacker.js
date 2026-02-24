const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PackReader = require('./pack-reader');
const RefsUnpacker = require('./refs-unpacker');

class Unpacker {
  constructor(gitDir) {
    this.gitDir = gitDir;
    this.objectsDir = path.join(gitDir, 'objects');
    this.packDir = path.join(this.objectsDir, 'pack');
  }

  findPackFiles() {
    if (!fs.existsSync(this.packDir)) {
      return [];
    }

    const files = fs.readdirSync(this.packDir);
    const packFiles = files.filter(f => f.endsWith('.pack'));

    return packFiles.map(f => path.join(this.packDir, f));
  }

  hasPackedRefs() {
    return fs.existsSync(path.join(this.gitDir, 'packed-refs'));
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

    if (packFiles.length === 0 && !this.hasPackedRefs()) {
      console.log('No pack files or packed-refs found. Nothing to unpack.');
      return { totalObjects: 0, newObjects: 0, packFiles: 0, totalRefs: 0, newRefs: 0 };
    }

    if (packFiles.length > 0) {
      console.log(`Found ${packFiles.length} pack file(s)`);
    }

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

    // Unpack refs from packed-refs file
    const refsResult = this.unpackRefs({ deletePackedRefs: deletePackFiles, verbose });

    return {
      totalObjects,
      newObjects,
      packFiles: packFiles.length,
      totalRefs: refsResult.totalRefs,
      newRefs: refsResult.newRefs
    };
  }

  unpackRefs(options = {}) {
    const refsUnpacker = new RefsUnpacker(this.gitDir);

    if (!refsUnpacker.hasPackedRefs()) {
      return { totalRefs: 0, newRefs: 0 };
    }

    console.log('\nUnpacking refs from packed-refs...');
    const result = refsUnpacker.unpack(options);
    console.log(`Unpacked ${result.newRefs} new refs (${result.totalRefs} total)`);

    return result;
  }
}

module.exports = Unpacker;
