# git-unpack

CLI tool to unpack Git pack files to loose objects.

[![npm version](https://img.shields.io/npm/v/git-unpack.svg)](https://www.npmjs.com/package/git-unpack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install -g git-unpack
```

Or run directly without installing:

```bash
npx git-unpack
```

## Usage

```bash
# Unpack in current repository
git-unpack

# Unpack a specific repository
git-unpack /path/to/repo

# Unpack and delete pack files
git-unpack -d

# Verbose output
git-unpack -v
```

## Options

| Option | Description |
|--------|-------------|
| `-d, --delete` | Delete pack files after unpacking |
| `-v, --verbose` | Show each object as it's unpacked |
| `-h, --help` | Show help message |

## What does it do?

Git stores objects in two formats:
- **Loose objects**: Individual files in `.git/objects/`
- **Pack files**: Compressed bundles in `.git/objects/pack/`

This tool converts pack files back to loose objects, useful for debugging, recovery, or understanding Git internals.

## Documentation

Full documentation available at [https://markjameshoward.github.io/git-unpack](https://markjameshoward.github.io/git-unpack)

## License

MIT
