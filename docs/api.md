# API

You can also use git-unpack programmatically in your Node.js projects.

## Unpacker Class

```javascript
const Unpacker = require('git-unpack/lib/unpacker');

const unpacker = new Unpacker('/path/to/.git');
const result = unpacker.unpack({
  deletePackFiles: false,
  verbose: false
});

console.log(result);
// { totalObjects: 150, newObjects: 150, packFiles: 1 }
```

### Constructor

```javascript
new Unpacker(gitDir)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `gitDir` | string | Path to the `.git` directory |

### Methods

#### `unpack(options)`

Unpacks all pack files in the repository.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `deletePackFiles` | boolean | `false` | Delete pack files after unpacking |
| `verbose` | boolean | `false` | Log each object as it's unpacked |

**Returns:**

```javascript
{
  totalObjects: number,  // Total objects processed
  newObjects: number,    // New objects written (excludes existing)
  packFiles: number      // Number of pack files processed
}
```

## PackReader Class

Lower-level API for reading pack files directly.

```javascript
const PackReader = require('git-unpack/lib/pack-reader');

const reader = new PackReader('/path/to/.git/objects/pack/pack-xxx.pack');
const objects = reader.parse();

for (const [sha, obj] of objects) {
  console.log(`${sha}: ${obj.type} (${obj.data.length} bytes)`);
}
```

### Constructor

```javascript
new PackReader(packPath, objectsDir?)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `packPath` | string | Path to the `.pack` file |
| `objectsDir` | string | Optional: path to objects dir for thin pack support |

### Methods

#### `parse()`

Parses the pack file and returns a Map of all objects.

**Returns:** `Map<string, { type: string, data: Buffer }>`
