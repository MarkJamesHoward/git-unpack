const fs = require('fs');
const path = require('path');

class RefsUnpacker {
  constructor(gitDir) {
    this.gitDir = gitDir;
    this.packedRefsPath = path.join(gitDir, 'packed-refs');
    this.refsDir = path.join(gitDir, 'refs');
  }

  hasPackedRefs() {
    return fs.existsSync(this.packedRefsPath);
  }

  unpack(options = {}) {
    const { deletePackedRefs = false, verbose = false } = options;

    if (!this.hasPackedRefs()) {
      return { totalRefs: 0, newRefs: 0 };
    }

    const content = fs.readFileSync(this.packedRefsPath, 'utf8');
    const lines = content.split('\n');

    let totalRefs = 0;
    let newRefs = 0;
    let currentPeeled = null;

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Handle peeled tags (^sha lines)
      if (line.startsWith('^')) {
        // This is a peeled ref for the previous tag, skip for now
        continue;
      }

      // Parse: <sha> <refname>
      const match = line.match(/^([0-9a-f]{40})\s+(.+)$/);
      if (!match) {
        continue;
      }

      const [, sha, refName] = match;
      totalRefs++;

      const written = this.writeRef(refName, sha);
      if (written) {
        newRefs++;
        if (verbose) {
          console.log(`  ${refName} -> ${sha.slice(0, 7)}`);
        }
      }
    }

    if (deletePackedRefs && newRefs > 0) {
      fs.unlinkSync(this.packedRefsPath);
      console.log(`  Deleted: packed-refs`);
    }

    return { totalRefs, newRefs };
  }

  writeRef(refName, sha) {
    const refPath = path.join(this.gitDir, refName);

    // Skip if ref already exists as a file
    if (fs.existsSync(refPath) && fs.statSync(refPath).isFile()) {
      return false;
    }

    // Create directory structure
    const refDir = path.dirname(refPath);
    if (!fs.existsSync(refDir)) {
      fs.mkdirSync(refDir, { recursive: true });
    }

    // Write the ref file
    fs.writeFileSync(refPath, sha + '\n');
    return true;
  }
}

module.exports = RefsUnpacker;
