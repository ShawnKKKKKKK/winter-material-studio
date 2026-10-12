import test from 'node:test';
import assert from 'node:assert/strict';
import { fitLines, csvEncode, csvParse, csvUpdates } from '../src/text.js';
test('fixed-size text wraps only within the original line count and does not truncate', () => {
 const measure = s => [...s].length * 20;
 assert.deepEqual(fitLines('冬藏好茶', '文案文案\n文案文案', measure).lines, ['冬藏好茶']);
 assert.deepEqual(fitLines('冬藏好茶满两件优惠', '文案文案\n文案文案', measure).error, '文案过长：最多 2 行，请缩短文案');
 assert.equal(fitLines('四个字呀', '四个字', measure).lines, undefined);
});
test('CSV round trips Chinese filenames, commas, quotes, newlines and empty values', () => {
 const rows = [['文件名','标题'], ['茶,礼.png', '一行\n"二行"'], ['video.mp4','']];
 assert.deepEqual(csvParse(csvEncode(rows)), rows);
 assert.throws(() => csvParse('文件名,标题\na,"未闭合'), /未闭合/);
});
test('CSV filename matching is transactional, explicit blanks clear text, unknown fields fail', () => {
 const fields = [{id:'text1',label:'活动标题'}];
 const rows = [['文件名','活动标题 [text1]'],['a.png','']];
 assert.deepEqual(csvUpdates(rows,['a.png'],fields),[{name:'a.png',values:{text1:''}}]);
 assert.throws(() => csvUpdates(rows,['a.png','a.png'],fields), /不唯一/);
 assert.throws(() => csvUpdates(rows,['b.png'],fields), /未在队列/);
 assert.throws(() => csvUpdates([rows[0],rows[1],rows[1]],['a.png'],fields), /重复/);
 assert.throws(() => csvUpdates([['文件名','未知字段'],['a.png','x']],['a.png'],fields), /不属于当前模板/);
});
