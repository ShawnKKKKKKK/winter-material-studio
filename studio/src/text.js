const fontLoads = new Map();
let coveragePromise;
export async function loadTextAssets(t, baseUrl, loadImage) {
  if (!t.texts?.length) return;
  coveragePromise ||= fetch(baseUrl + 'fonts/coverage.json').then(r => r.json());
  const coverage = await coveragePromise;
  for (const [key, target] of [['textCleanBG', 'textCleanBGImage'], ['textCleanFG', 'textCleanFGImage'], ['textClean', 'textCleanImage']]) {
    if (t[key] && !t[target]) t[target] = await loadImage(baseUrl + t[key]);
  }
  await Promise.all(t.texts.map(async f => {
    if (!f.image) f.image = await loadImage(baseUrl + f.url);
    if (!fontLoads.has(f.font)) fontLoads.set(f.font, (async () => {
      const face = new FontFace(f.font, `url("${baseUrl}fonts/${f.font}.${f.font.startsWith('HONOR') ? 'ttf' : 'woff2'}")`);
      await face.load(); document.fonts.add(face); return true;
    })().catch(() => false));
    f.fontReady = await fontLoads.get(f.font);
    f.coverage = coverage[f.font] || [];
  }));
}
function font(ctx, f) { ctx.font = `${f.fontSize}px "${f.font}"`; ctx.letterSpacing = `${f.tracking}px`; ctx.textAlign = f.align; ctx.textBaseline = 'alphabetic'; }
// Preserve the original type size and number of lines. Never squeeze or silently truncate text.
export function fitLines(text, original, measure, maxLines = original.split('\n').length) {
  const maxWidth = Math.max(...original.split('\n').map(measure)) + .5;
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (measure(line + char) > maxWidth && line) { lines.push(line); line = ''; }
      if (measure(char) > maxWidth) return { error: '字符超出原文字区域' };
      line += char;
    }
    lines.push(line);
  }
  return lines.length > maxLines ? { error: `文案过长：最多 ${maxLines} 行，请缩短文案` } : { lines, maxWidth };
}
function layout(ctx, f, value) {
  if (!f.fontReady) return { error: `缺少原字体 ${f.font}，无法保持原样式` };
  const missing = [...value].find(char => char !== '\n' && !f.coverage.some(([lo, hi]) => char.codePointAt(0) >= lo && char.codePointAt(0) <= hi));
  if (missing) return { error: `原字体不含字符“${missing}”，请换用支持的文字` };
  font(ctx, f);
  if (f.vertical) return [...value.replace(/\n/g, '')].length > [...f.original].length ? { error: '文案过长，请缩短竖排文案' } : { lines: [...value.replace(/\n/g, '')] };
  return fitLines(value, f.original, text => ctx.measureText(text).width);
}
export function textErrors(t, settings) {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  const values = settings.texts?.[t.id] || {};
  return (t.texts || []).flatMap(f => {
    const value = values[f.id] ?? f.original;
    if (value === f.original || value === '') return [];
    const { error } = layout(ctx, f, value);
    return error ? [{ id: f.id, message: `${f.label}：${error}` }] : [];
  });
}
function drawText(ctx, f, value) {
  if (value === '') return;
  if (value === f.original) { ctx.drawImage(f.image, f.rasterBox[0], f.rasterBox[1]); return; }
  const result = layout(ctx, f, value);
  if (result.error) return; // The form explains the error and export is blocked for this item.
  ctx.save(); ctx.globalAlpha = f.opacity; ctx.fillStyle = f.fill;
  const [x, y, w, h] = f.box;
  for (const effect of f.effects) {
    if (effect.type === 'gradient') {
      const angle = effect.angle * Math.PI / 180;
      const length = (Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) * effect.scale;
      const dx = Math.cos(angle) * length / 2, dy = -Math.sin(angle) * length / 2;
      const cx = x + w / 2 + w * effect.offset[0] / 100, cy = y + h / 2 + h * effect.offset[1] / 100;
      const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      for (const [pos, color] of effect.stops) g.addColorStop(effect.reverse ? 1 - pos : pos, color);
      ctx.fillStyle = g;
    } else if (effect.type === 'shadow') {
      ctx.shadowColor = effect.color; ctx.shadowBlur = effect.blur;
      ctx.shadowOffsetX = -Math.cos(effect.angle * Math.PI / 180) * effect.distance;
      ctx.shadowOffsetY = Math.sin(effect.angle * Math.PI / 180) * effect.distance;
    }
  }
  if (f.vertical) {
    // PSD vertical text keeps upright glyphs in the original fixed column.
    const size = f.fontSize * f.transform[3]; ctx.font = `${size}px "${f.font}"`; ctx.letterSpacing = '0px';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const advance = h / [...f.original].length;
    result.lines.forEach((char, i) => {
      const metrics = ctx.measureText(char);
      const baseline = y + i * advance + (advance + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
      ctx.fillText(char, x + w / 2, baseline);
    });
  } else {
    ctx.transform(...f.transform); font(ctx, f);
    result.lines.forEach((line, i) => ctx.fillText(line, 0, i * f.leading));
  }
  ctx.restore();
}
let cached;
export function textTemplate(t, settings) {
  const values = settings.texts?.[t.id] || {};
  if (!t.texts?.some(f => (values[f.id] ?? f.original) !== f.original)) return t;
  const key = t.id + JSON.stringify(values);
  if (cached?.key === key) return cached.template;
  const c = new OffscreenCanvas(t.graphicWidth || t.width, t.graphicHeight || t.height), ctx = c.getContext('2d');
  const base = t.textCleanFGImage || t.textCleanImage;
  if (base) ctx.drawImage(base, 0, 0);
  for (const f of t.texts) drawText(ctx, f, values[f.id] ?? f.original);
  const template = t.mode === 'layered' ? { ...t, bgImage: t.textCleanBGImage, fgImage: c } : { ...t, image: c };
  cached = { key, template }; return template;
}
export function clearTextCache() { cached = undefined; }
export function csvEncode(rows) { return '\ufeff' + rows.map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'); }
export function csvParse(input) {
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  input = input.replace(/^\ufeff/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === '"' && value === '' && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(value); value = ''; closed = false;
      if (c !== ',') { if (c === '\r' && input[i + 1] === '\n') i++; rows.push(row); row = []; }
    } else { if (closed || c === '"') throw new Error('CSV 引号格式错误'); value += c; }
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (value || row.length || closed) { row.push(value); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}
export function csvUpdates(rows, names, fields) {
  if (rows.length < 2) throw new Error('CSV 没有数据行');
  const headers = rows[0];
  if (headers[0] !== '文件名') throw new Error('第一列必须是“文件名”，请下载当前模板的 CSV');
  if (new Set(headers).size !== headers.length) throw new Error('CSV 列名重复');
  const columns = headers.slice(1).map(h => {
    const f = fields.find(f => `${f.label} [${f.id}]` === h);
    if (!f) throw new Error(`不属于当前模板的列：${h}`); return f.id;
  });
  if (!columns.length) throw new Error('CSV 至少需要一列文案');
  const seen = new Set();
  return rows.slice(1).map((r, i) => {
    if (r.length !== headers.length) throw new Error(`第 ${i + 2} 行列数不匹配`);
    if (seen.has(r[0])) throw new Error(`CSV 文件名重复：${r[0]}`); seen.add(r[0]);
    const matches = names.filter(n => n === r[0]);
    if (matches.length !== 1) throw new Error(`文件名${matches.length ? '不唯一' : '未在队列中找到'}：${r[0]}`);
    return { name: r[0], values: Object.fromEntries(columns.map((c, j) => [c, r[j + 1].replace(/\r\n?/g, '\n')])) };
  });
}
