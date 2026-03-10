import { TERRAIN_PATH } from '../config';
import { parseBitcraftQuery, resolvePublicUrl } from '../shared/bitcraft';
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
  return parseBitcraftQuery(window.location.search);
}
