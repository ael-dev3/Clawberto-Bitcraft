import { TERRAIN_PATH } from '../config';
import { parseCenter, parseIdList, parseRequestedZoom, resolvePublicUrl } from '../shared/bitcraft';
import { getDom } from '../ui/dom';
import { MapController } from './map-controller';
import { AppController } from './services/app-controller';
import type { QueryState } from './types';

export async function bootApp(): Promise<void> {
  const controller = new AppController({
    dom: getDom(),
    mapController: new MapController(resolvePublicUrl(TERRAIN_PATH)),
    queryState: readQueryState(),
  });

  try {
    await controller.boot();
  } catch (error) {
    console.error(error);
    controller.handleBootError(error);
  }
}

function readQueryState(): QueryState {
  const params = new URLSearchParams(window.location.search);
  return {
    requestedResourceIds: parseIdList(params.get('resourceId')),
    requestedCenter: parseCenter(params.get('center')),
    requestedZoom: parseRequestedZoom(params.get('zoom')),
  };
}
