# How It Works

## Git Pack File Format

Git pack files are a compact way to store multiple Git objects. They consist of:

### Header (12 bytes)
- 4 bytes: Signature `PACK`
- 4 bytes: Version number (usually 2)
- 4 bytes: Number of objects

### Object Entries

Each object entry contains:
1. **Type and size** (variable length encoding)
2. **Object data** (zlib compressed)

### Object Types

| Type | Value | Description |
|------|-------|-------------|
| OBJ_COMMIT | 1 | Commit object |
| OBJ_TREE | 2 | Tree object |
| OBJ_BLOB | 3 | Blob (file content) |
| OBJ_TAG | 4 | Tag object |
| OBJ_OFS_DELTA | 6 | Delta with offset reference |
| OBJ_REF_DELTA | 7 | Delta with SHA reference |

## Delta Compression

Pack files use delta compression to save space. Instead of storing complete objects, they store:
- A reference to a "base" object
- Instructions to reconstruct the target from the base

### Delta Instructions

1. **Copy**: Copy bytes from base object
2. **Insert**: Insert new literal bytes

## Unpacking Process

1. **Parse header** - Read signature, version, object count
2. **Read objects** - For each object:
   - Decode type and size
   - Decompress zlib data
   - If delta: store for later resolution
   - If regular: compute SHA and store
3. **Resolve deltas** - Apply delta instructions to reconstruct objects
4. **Write loose objects** - Write each object to `.git/objects/XX/YYY...`

## Loose Object Format

Loose objects are stored as:
```
zlib_compress(type + " " + size + "\0" + content)
```

The filename is the SHA-1 hash split as: `objects/XX/YYYYYYYY...`
