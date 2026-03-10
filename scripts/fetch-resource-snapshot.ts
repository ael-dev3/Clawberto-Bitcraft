import path from 'node:path';

import { fetchResourceSnapshot } from '../src/shared/clients/resource';
import { writeJsonFile } from './lib/node-helpers';

const regionId = process.argv[2];
const resourceId = process.argv[3];

if (!regionId || !resourceId) {
  console.error('usage: npm run fetch:resource -- <regionId> <resourceId>');
  process.exit(1);
}

const parsed = await fetchResourceSnapshot(regionId, resourceId);
if (!parsed) {
  throw new Error(`resource snapshot ${regionId}/${resourceId} failed validation`);
}

const outputPath = path.join(process.cwd(), 'public', 'data', 'resources', String(regionId), `${resourceId}.json`);
await writeJsonFile(outputPath, parsed);
console.log(`saved public/data/resources/${regionId}/${resourceId}.json`);
