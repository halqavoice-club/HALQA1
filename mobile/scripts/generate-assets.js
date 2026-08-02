/**
 * Generate HALQA brand placeholder assets using sharp
 * Run: node scripts/generate-assets.js
 */
const sharp = require('sharp');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');

// HALQA brand indigo: #4f46e5
const assets = [
  { name: 'icon.png',               width: 1024, height: 1024 },
  { name: 'splash.png',             width: 1284, height: 2778 },
  { name: 'adaptive-icon.png',      width: 1024, height: 1024 },
  { name: 'favicon.png',            width: 64,   height: 64   },
  { name: 'notification-icon.png',  width: 96,   height: 96   },
];

async function generate() {
  for (const asset of assets) {
    const outPath = path.join(assetsDir, asset.name);
    await sharp({
      create: {
        width: asset.width,
        height: asset.height,
        channels: 4,
        background: { r: 79, g: 70, b: 229, alpha: 1 }, // #4f46e5
      }
    })
    .png()
    .toFile(outPath);
    const size = require('fs').statSync(outPath).size;
    console.log(`✓ ${asset.name} (${asset.width}x${asset.height}, ${(size/1024).toFixed(1)} KB)`);
  }
  console.log('\n✅ All assets generated — solid indigo (#4f46e5) placeholders.');
  console.log('Replace with real branded icons before Play Store submission.');
}

generate().catch(err => { console.error(err); process.exit(1); });
