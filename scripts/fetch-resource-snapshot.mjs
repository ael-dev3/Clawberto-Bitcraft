import fs from 'node:fs/promises';
import path from 'node:path';

const regionId = process.argv[2];
const resourceId = process.argv[3];

if (!regionId || !resourceId) {
  console.error('usage: node scripts/fetch-resource-snapshot.mjs <regionId> <resourceId>');
  process.exit(1);
}

const url = `https://bcmap-api.bitjita.com/region${regionId}/resource/${resourceId}`;
const res = await fetch(url, {
  headers: {
    Origin: 'https://bitcraftmap.com',
    Referer: 'https://bitcraftmap.com/',
    'User-Agent': 'Mozilla/5.0',
  },
});

if (!res.ok) {
  throw new Error(`fetch failed ${res.status} for ${url}`);
}

const data = await res.text();
const outDir = path.join(process.cwd(), 'data', 'resources', String(regionId));
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, `${resourceId}.json`), data);
console.log(`saved data/resources/${regionId}/${resourceId}.json`);
