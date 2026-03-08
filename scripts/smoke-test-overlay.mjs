import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://127.0.0.1:8131/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console:${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror:${err.message}`));

await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(7000);

const state = await page.evaluate(() => {
  const terrainImg = document.querySelector('.leaflet-pane img');
  const map = document.querySelector('#map');
  const status = document.querySelector('#status')?.textContent?.trim() || '';
  const source = document.querySelector('#coordSource')?.textContent?.trim() || '';
  const x = document.querySelector('#coordX')?.textContent?.trim() || '';
  const z = document.querySelector('#coordZ')?.textContent?.trim() || '';
  const diagnostics = document.querySelector('#diagnosticsStatus')?.textContent?.trim() || '';
  const markers = document.querySelectorAll('.leaflet-marker-icon').length;
  const regionLabels = document.body.innerText.includes('Region 12');
  const bodyText = document.body.innerText;
  return {
    terrainLoaded: Boolean(terrainImg && terrainImg.complete && terrainImg.naturalWidth > 0),
    terrainSrc: terrainImg?.src || null,
    mapSize: map ? { width: map.clientWidth, height: map.clientHeight } : null,
    status,
    source,
    x,
    z,
    diagnostics,
    markers,
    regionLabels,
    hasJericcho: bodyText.includes('Jericcho'),
    hasPinkCrayon: bodyText.includes('PinkCrayon'),
    hasJelly: bodyText.includes('Jelly'),
    hasLongitude: bodyText.includes('Longitude'),
  };
});

await page.screenshot({ path: 'smoke-test.png', fullPage: true });
await browser.close();

if (!state.terrainLoaded) throw new Error(`Terrain image not loaded: ${JSON.stringify(state)}`);
if (!/region12\.png$/i.test(state.terrainSrc || '')) throw new Error(`Unexpected terrain asset: ${JSON.stringify(state)}`);
if (!state.regionLabels) throw new Error(`Region label missing: ${JSON.stringify(state)}`);
if (state.markers < 5) throw new Error(`Too few markers rendered: ${JSON.stringify(state)}`);
if (!state.mapSize || state.mapSize.width < 500 || state.mapSize.height < 400) throw new Error(`Map container size invalid: ${JSON.stringify(state)}`);
if (!state.status || /Boot error|Live feed error/i.test(state.status)) throw new Error(`Bad status: ${JSON.stringify(state)}`);
if (!['live', 'cached', 'detail', 'detail-home'].includes(state.source)) throw new Error(`Unexpected coordinate source: ${JSON.stringify(state)}`);
if (state.x === '—' || state.z === '—') throw new Error(`Coordinates missing: ${JSON.stringify(state)}`);
if (!state.hasJericcho || !state.hasPinkCrayon || !state.hasJelly || !state.hasLongitude) throw new Error(`Tracked player names missing: ${JSON.stringify(state)}`);
if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ ok: true, url: targetUrl, state }, null, 2));
