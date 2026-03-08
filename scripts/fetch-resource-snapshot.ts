import path from 'node:path';

import { resourceSnapshotSchema } from '../src/shared/schemas';
import { validateWithSchema } from '../src/shared/validation';
import { writeJsonFile } from './lib/node-helpers';

const regionId = process.argv[2];
const resourceId = process.argv[3];

if (!regionId || !resourceId) {
  console.error('usage: npm run fetch:resource -- <regionId> <resourceId>');
  process.exit(1);
}

const url = `https://bcmap-api.bitjita.com/region${regionId}/resource/${resourceId}`;
const response = await fetch(url, {
  headers: {
    Origin: 'https://bitcraftmap.com',
    Referer: 'https://bitcraftmap.com/',
    'User-Agent': 'Mozilla/5.0',
  },
});

if (!response.ok) {
  throw new Error(`fetch failed ${response.status} for ${url}`);
}

const text = await response.text();
const parsed = validateResourcePayload(text, `resource snapshot ${regionId}/${resourceId}`);
if (!parsed) {
  throw new Error(`resource snapshot ${regionId}/${resourceId} failed validation`);
}

const outputPath = path.join(process.cwd(), 'public', 'data', 'resources', String(regionId), `${resourceId}.json`);
await writeJsonFile(outputPath, parsed);
console.log(`saved public/data/resources/${regionId}/${resourceId}.json`);

function validateResourcePayload(textValue: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textValue) as unknown;
  } catch (error) {
    console.warn(`${label} is not valid JSON`, error);
    return null;
  }

  return validateWithSchema(parsed, resourceSnapshotSchema, label);
}
