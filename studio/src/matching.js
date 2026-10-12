import { placement } from './layout.js';
export function ratioLabel(w, h) {
  if (!(w > 0 && h > 0)) return '比例未知';
  const r = w / h;
  const named = [[1, '1:1'], [16 / 9, '16:9'], [9 / 16, '9:16'], [4 / 3, '4:3'], [3 / 4, '3:4']].find(([v]) => Math.abs(Math.log(r / v)) < .025);
  return `${r > 1.05 ? '横版' : r < .95 ? '竖版' : '方形'} ${named?.[1] || r.toFixed(2) + ':1'}`;
}
export function matchTemplate(item, templates, preferred, category = 'all') {
  if (!(item.width > 0 && item.height > 0)) return null;
  const candidates = templates.filter(t => t.mode !== 'original' && (category === 'all' || t.category === category) && (!['badge', 'inset'].includes(t.mode) || t.id === preferred?.id || category !== 'all'));
  const r = item.width / item.height;
  const score = t => {
    const output = Math.abs(Math.log(r / (t.width / t.height)));
    const slot = t.slot || t;
    const fit = Math.abs(Math.log(r / (slot.width / slot.height)));
    const direction = v => v > 1.05 ? 'landscape' : v < .95 ? 'portrait' : 'square';
    return (direction(r) === direction(t.width / t.height) ? 0 : .35) + output + fit * .15 + (item.type === 'video' && t.mode === 'layered' ? .35 : 0) - (t.id === preferred?.id ? .07 : 0) - (t.category === preferred?.category ? .015 : 0);
  };
  return candidates.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0] || null;
}
export function geometryReview(item, t) {
  if (!(item.width > 0 && item.height > 0)) return { crop: 0, blank: 0, upscale: 0, notes: ['无法读取素材尺寸，请重新选择文件'] };
  const slot = t.slot || { width: t.width, height: t.height };
  const r = placement(item.width, item.height, slot.width, slot.height, item.settings);
  const intersection = Math.max(0, Math.min(slot.width, r.x + r.w) - Math.max(0, r.x)) * Math.max(0, Math.min(slot.height, r.y + r.h) - Math.max(0, r.y));
  const crop = Math.max(0, 1 - intersection / (r.w * r.h));
  const blank = Math.max(0, 1 - intersection / (slot.width * slot.height));
  const upscale = r.w / item.width;
  const notes = [];
  if (crop > .02) notes.push(`约 ${Math.round(crop * 100)}% 素材超出摆放区域，检查边缘裁切或遮挡`);
  if (blank > .02) notes.push(`摆放区域约 ${Math.round(blank * 100)}% 未铺满${t.mode === 'layered' ? '，显示原稿背景' : '，显示底色'}`);
  if (upscale > 1.1) notes.push(`素材放大至 ${Math.round(upscale * 100)}%，请检查清晰度`);
  if (t.mode === 'layered' || t.mode === 'inset') notes.push('请检查商品／人物与固定文字、前景的遮挡关系');
  return { crop, blank, upscale, notes };
}
