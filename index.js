#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Unpacker = require('./lib/unpacker');

function findGitDir(startPath) {
  let current = path.resolve(startPath);

  while (current !== path.dirname(current)) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      return gitDir;
    }
    current = path.dirname(current);
  }

  return null;
}

function printHelp() {
  console.log(`
git-unpack - Unpack Git pack files and refs to loose format

USAGE:
  git-unpack [options] [path]

ARGUMENTS:
  path              Path to .git directory or repository root
                    (defaults to current directory)

OPTIONS:
  -d, --delete      Delete pack files and packed-refs after unpacking
  -v, --verbose     Show each object/ref as it's unpacked
  -h, --help        Show this help message

UNPACKS:
  - Pack files (.git/objects/pack/*.pack) -> loose objects
  - Packed refs (.git/packed-refs) -> individual ref files

EXAMPLES:
  git-unpack                    Unpack in current repository
  git-unpack /path/to/repo      Unpack in specified repository
  git-unpack .git               Unpack using .git directory directly
  git-unpack -d                 Unpack and delete packed files
`);
}

function parseArgs(args) {
  const options = {
    deletePackFiles: false,
    verbose: false,
    help: false,
    path: '.'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-d' || arg === '--delete') {
      options.deletePackFiles = true;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (!arg.startsWith('-')) {
      options.path = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Resolve the git directory
  let gitDir;
  const inputPath = path.resolve(options.path);

  if (inputPath.endsWith('.git') && fs.existsSync(inputPath)) {
    gitDir = inputPath;
  } else if (fs.existsSync(path.join(inputPath, '.git'))) {
    gitDir = path.join(inputPath, '.git');
  } else {
    gitDir = findGitDir(inputPath);
  }

  if (!gitDir) {
    console.error('Error: Could not find .git directory');
    console.error('Run this command from within a Git repository or specify a path');
    process.exit(1);
  }

  console.log(`Git directory: ${gitDir}`);

  // Check if there's anything to unpack
  const packDir = path.join(gitDir, 'objects', 'pack');
  const packedRefsPath = path.join(gitDir, 'packed-refs');

  const hasPackDir = fs.existsSync(packDir);
  const packFiles = hasPackDir ? fs.readdirSync(packDir).filter(f => f.endsWith('.pack')) : [];
  const hasPackedRefs = fs.existsSync(packedRefsPath);

  if (packFiles.length === 0 && !hasPackedRefs) {
    console.log('No pack files or packed-refs found. Nothing to unpack.');
    process.exit(0);
  }

  try {
    const unpacker = new Unpacker(gitDir);
    const result = unpacker.unpack({
      deletePackFiles: options.deletePackFiles,
      verbose: options.verbose
    });

    console.log('\nDone!');
    process.exit(0);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    if (options.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
