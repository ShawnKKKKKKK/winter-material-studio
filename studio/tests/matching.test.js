import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchTemplate, geometryReview, ratioLabel } from '../src/matching.js';
const catalog = JSON.parse(readFileSync(new URL('../public/catalog/manifest.json', import.meta.url))).map(t => ({ ...t, width: t.canvasWidth || t.width, height: t.canvasHeight || t.height }));
const preferred = catalog.find(t => t.id === 't16');
const item = (width, height, type = 'image') => ({ width, height, type, settings: { fit: 'contain', zoom: 1, x: 0, y: 0 } });
test('mixed square, landscape, portrait assets keep direction with fixed templates', () => {
  assert.equal(matchTemplate(item(900,900),catalog,preferred).id,'t16');
  assert.equal(matchTemplate(item(1920,1080),catalog,preferred).id,'t17');
  assert.equal(matchTemplate(item(900,1200),catalog,preferred).id,'t56');
  assert.equal(matchTemplate(item(1080,1920,'video'),catalog,preferred).id,'t06');
  assert.equal(matchTemplate(item(1080,1920,'video'),catalog,preferred,'视频边框').id,'t06');
});
test('scope is strict and download-only art is never selected', () => {
  assert.equal(matchTemplate(item(900,1200),catalog,preferred,'商品方图').category,'商品方图');
  assert.equal(matchTemplate(item(900,1200),catalog,preferred,'主题与 KV'),null);
  assert.equal(matchTemplate(item(0,0),catalog,preferred),null);
});
test('review reflects crop, blank area, offsets, scaling and template slots', () => {
  const t={width:1000,height:1000};
  let i=item(2000,1000); let r=geometryReview(i,t);
  assert.equal(r.crop,0); assert.equal(r.blank,.5);
  i.settings.fit='cover'; r=geometryReview(i,t); assert.equal(r.crop,.5); assert.equal(r.blank,0);
  i.settings.x=100; r=geometryReview(i,t); assert.equal(r.blank,.5); assert.equal(r.crop,.75);
  r=geometryReview(item(100,100),{...t,slot:{width:200,height:200}}); assert.equal(r.upscale,2);
  assert.equal(ratioLabel(1080,1920),'竖版 9:16');
});
