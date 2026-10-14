import { readFileSync } from 'node:fs';
import { buildRegions } from '../../js/regions.js';

export function loadRegionMap() {
  const src = readFileSync(new URL('../../data/region-map-anon.js', import.meta.url), 'utf8');
  return new Function(`${src};\nreturn REGION_MAP_ANON;`)();
}

export function loadRegions() {
  return buildRegions(loadRegionMap());
}
