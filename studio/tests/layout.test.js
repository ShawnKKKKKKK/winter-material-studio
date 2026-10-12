import test from 'node:test';
import assert from 'node:assert/strict';
import { placement, outputName } from '../src/layout.js';
const settings = { fit: 'cover', zoom: 1, x: 0, y: 0 };
test('portrait media fills square without stretching', () => {
  assert.deepEqual(placement(720, 1280, 800, 800, settings), { x: 0, y: (800 - 1280 * 800 / 720) / 2, w: 800, h: 1280 * 800 / 720 });
});
test('contain leaves equal letterbox space and offsets scale with output', () => {
  assert.deepEqual(placement(800, 800, 1280, 720, { ...settings, fit: 'contain', x: 10, y: -10 }), { x: 408, y: -72, w: 720, h: 720 });
});
test('zoom stays centered', () => {
  assert.deepEqual(placement(800, 800, 800, 800, { ...settings, zoom: 2 }), { x: -400, y: -400, w: 1600, h: 1600 });
});
test('output naming prevents unsafe paths and distinguishes duplicate input names', () => {
  assert.equal(outputName('../a:商品.mov', 0, 'mp4'), '001_.._a_商品_冬藏季.mp4');
  assert.notEqual(outputName('商品.jpg', 0, 'png'), outputName('商品.jpg', 1, 'png'));
});
