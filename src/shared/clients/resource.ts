import { BITCRAFT_WEB_ORIGIN, buildResourceSnapshotUrl } from '../bitcraft';
import { resourceSnapshotSchema, type ResourceSnapshot } from '../schemas';
import { fetchJsonWithSchema } from './fetch-json';

export async function fetchResourceSnapshot(
  regionId: number | string,
  resourceId: number | string,
  label = `resource snapshot ${regionId}/${resourceId}`,
): Promise<ResourceSnapshot | null> {
  return fetchJsonWithSchema(buildResourceSnapshotUrl(regionId, resourceId), resourceSnapshotSchema, label, {
    init: {
      headers: {
        Origin: BITCRAFT_WEB_ORIGIN,
        Referer: `${BITCRAFT_WEB_ORIGIN}/`,
        'User-Agent': 'Mozilla/5.0',
      },
    },
  });
}
