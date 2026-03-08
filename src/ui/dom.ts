function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

export interface AppDom {
  status: HTMLElement;
  entityId: HTMLElement;
  coordSource: HTMLElement;
  coordX: HTMLElement;
  coordZ: HTMLElement;
  coordRegion: HTMLElement;
  coordTimestamp: HTMLElement;
  requestedRegions: HTMLElement;
  requestedResources: HTMLElement;
  resourceStatus: HTMLElement;
  diagnosticsStatus: HTMLElement;
  officialLink: HTMLAnchorElement;
  recenterBtn: HTMLButtonElement;
  followToggle: HTMLInputElement;
  manualX: HTMLInputElement;
  manualZ: HTMLInputElement;
  manualPinBtn: HTMLButtonElement;
  clearManualPinBtn: HTMLButtonElement;
  trackedPlayersList: HTMLElement;
}

export function getDom(): AppDom {
  return {
    status: requireElement('status'),
    entityId: requireElement('entityId'),
    coordSource: requireElement('coordSource'),
    coordX: requireElement('coordX'),
    coordZ: requireElement('coordZ'),
    coordRegion: requireElement('coordRegion'),
    coordTimestamp: requireElement('coordTimestamp'),
    requestedRegions: requireElement('requestedRegions'),
    requestedResources: requireElement('requestedResources'),
    resourceStatus: requireElement('resourceStatus'),
    diagnosticsStatus: requireElement('diagnosticsStatus'),
    officialLink: requireElement('officialLink'),
    recenterBtn: requireElement('recenterBtn'),
    followToggle: requireElement('followToggle'),
    manualX: requireElement('manualX'),
    manualZ: requireElement('manualZ'),
    manualPinBtn: requireElement('manualPinBtn'),
    clearManualPinBtn: requireElement('clearManualPinBtn'),
    trackedPlayersList: requireElement('trackedPlayersList'),
  };
}
