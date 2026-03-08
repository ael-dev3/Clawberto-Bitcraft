import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://127.0.0.1:8131/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors: string[] = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(`console:${message.text()}`);
  }
});
page.on('pageerror', (error) => {
  errors.push(`pageerror:${error.message}`);
});

await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(7_000);

const state = await page.evaluate(() => {
  const terrainImage = document.querySelector<HTMLImageElement>('.leaflet-pane img');
  const map = document.querySelector<HTMLElement>('#map');
  const text = document.body.innerText;

  return {
    terrainLoaded: Boolean(terrainImage && terrainImage.complete && terrainImage.naturalWidth > 0),
    terrainSrc: terrainImage?.src || null,
    mapSize: map ? { width: map.clientWidth, height: map.clientHeight } : null,
    status: document.querySelector('#status')?.textContent?.trim() || '',
    source: document.querySelector('#coordSource')?.textContent?.trim() || '',
    x: document.querySelector('#coordX')?.textContent?.trim() || '',
    z: document.querySelector('#coordZ')?.textContent?.trim() || '',
    diagnostics: document.querySelector('#diagnosticsStatus')?.textContent?.trim() || '',
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    regionLabelPresent: text.includes('Region 12'),
    hasJericcho: text.includes('Jericcho'),
    hasPinkCrayon: text.includes('PinkCrayon'),
    hasJelly: text.includes('Jelly'),
    hasLongitude: text.includes('Longitude'),
  };
});

await page.screenshot({ path: 'smoke-test.png', fullPage: true });
await browser.close();

if (!state.terrainLoaded) throw new Error(`Terrain image not loaded: ${JSON.stringify(state)}`);
if (!/region12\.png(?:\?.*)?$/i.test(state.terrainSrc || '')) {
  throw new Error(`Unexpected terrain asset: ${JSON.stringify(state)}`);
}
if (!state.regionLabelPresent) throw new Error(`Region label missing: ${JSON.stringify(state)}`);
if (state.markers < 5) throw new Error(`Too few markers rendered: ${JSON.stringify(state)}`);
if (!state.mapSize || state.mapSize.width < 500 || state.mapSize.height < 400) {
  throw new Error(`Map container size invalid: ${JSON.stringify(state)}`);
}
if (!state.status || /Boot error|Live feed error/i.test(state.status)) {
  throw new Error(`Bad status: ${JSON.stringify(state)}`);
}
if (!['live', 'cached', 'detail', 'detail-home', 'player-detail-location', 'player-detail-teleport'].includes(state.source)) {
  throw new Error(`Unexpected coordinate source: ${JSON.stringify(state)}`);
}
if (state.x === '-' || state.z === '-') throw new Error(`Coordinates missing: ${JSON.stringify(state)}`);
if (!state.hasJericcho || !state.hasPinkCrayon || !state.hasJelly || !state.hasLongitude) {
  throw new Error(`Tracked player names missing: ${JSON.stringify(state)}`);
}
if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ ok: true, url: targetUrl, state }, null, 2));
