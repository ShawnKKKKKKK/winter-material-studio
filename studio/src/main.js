import './style.css';
import { matchTemplate, ratioLabel, geometryReview } from './matching.js';
import { readMedia, seekFrame } from './media.js';
import { compose, outputName } from './layout.js';
import { loadTextAssets, textTemplate, textErrors, clearTextCache, csvEncode, csvParse, csvUpdates } from './text.js';

const $ = id => document.getElementById(id);
const defaults = () => ({ fit: 'cover', zoom: 1, x: 0, y: 0, background: '#ffffff', texts: {} });
const templates = [];
let activeTemplate = { width: 800, height: 800 }, queue = [], selectedId, busy = false, loading = false, stopRequested = false;
let directory = null, previewMedia = null, previewUrl = null, previewVersion = 0, animation = 0, worker = null;
let tempDirectory = null, toastTimer, pendingSettings = defaults();
const canvas = $('preview'), context = canvas.getContext('2d');
const activeItem = () => queue.find(item => item.id === selectedId);
const itemTemplate = item => templates.find(t => t.id === item.templateId);
let preferredTemplateId;
const settings = () => activeItem()?.settings || pendingSettings;
const sizeLabel = n => n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const escapeHtml = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function loadImage(url) { const image = new Image(); image.src = url; await image.decode(); return image; }

const modeLabels = { layered: '分层套图', overlay: '透明边框', badge: '叠加贴片', original: '原图下载', inset: '视频包装' };
const baseUrl = import.meta.env.BASE_URL;
async function loadTemplates() {
  const response = await fetch(`${baseUrl}catalog/manifest.json`);
  if (!response.ok) throw new Error('无法读取素材目录');
  const catalog = await response.json();
  for (const entry of catalog) {
    const t = { ...entry, graphicWidth: entry.width, graphicHeight: entry.height };
    t.width = entry.canvasWidth || entry.width;
    t.height = entry.canvasHeight || entry.height;
    // H.264 requires even dimensions: pad one outside pixel instead of stretching artwork.
    if (entry.mode !== 'original') { t.width += t.width % 2; t.height += t.height % 2; }
    for (const key of ['url', 'thumb', 'bg', 'fg']) if (t[key]) t[key] = `${baseUrl}${t[key]}`;
    templates.push(t);
  }
  $('categorySelect').innerHTML = '<option value="all">全部素材</option>' + [...new Set(templates.map(t => t.category))].map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)} · ${templates.filter(t => t.category === c).length}</option>`).join('');
  $('matchScope').innerHTML += [...new Set(templates.filter(t => t.mode !== 'original').map(t => t.category))].map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  await chooseTemplate(templates.find(t => t.name === '商品主图框') || templates[0]);
}
async function ensureAssets(t) {
  if (!t.image) t.image = await loadImage(t.url);
  if (t.bg && !t.bgImage) t.bgImage = await loadImage(t.bg);
  if (t.fg && !t.fgImage) t.fgImage = await loadImage(t.fg);
  await loadTextAssets(t, baseUrl, loadImage);
}
async function chooseTemplate(t, assign = true) {
  if (busy || loading) return;
  loading = true; setBusy(false); $('templateNote').textContent = '正在加载模板和原稿字体…';
  try {
    await ensureAssets(t); activeTemplate = t;
    if (assign) {
      preferredTemplateId = t.id;
      if (activeItem()) { activeItem().templateId = t.id; activeItem().manualTemplate = true; activeItem().matchError = '';  activeItem().settings.fit = t.mode === 'layered' ? 'contain' : 'cover'; markChanged(activeItem()); }
    }
    // Keep decoded assets only for the active template, not the entire 57-style library.
    for (const other of templates) if (other !== t) { delete other.image; delete other.bgImage; delete other.fgImage; delete other.textCleanBGImage; delete other.textCleanFGImage; delete other.textCleanImage; for (const field of other.texts || []) delete field.image; }
    const fit = t.mode === 'layered' ? 'contain' : 'cover';
    pendingSettings = { ...defaults(), fit, texts: pendingSettings.texts || {} };

    $('templateNote').textContent = t.mode === 'layered' ? '已从 PSD 分离示例主体，保留原稿背景、文字和前景装饰。' : t.mode === 'original' ? '这是完整主题成图，可直接下载；不作为遮挡客户素材的透明模板。' : t.mode === 'badge' ? '原版透明贴片叠加在客户素材上，图案与文字保持原样。' : '按原稿固定画幅合成，设计内容保持不变。';
    $('modeNote').textContent = t.mode === 'layered' ? '商品、人像建议使用已抠好的透明 PNG。可在下方填写模板文案。视频可放入主体位置。' : t.mode === 'original' ? '当前是原图下载类。选择套图或边框类后可批量合成。' : ((t.graphicWidth % 2 || t.graphicHeight % 2) && t.mode === 'overlay' ? '原稿尺寸为奇数，画布右下补 1 像素以兼容 MP4，设计不拉伸。' : '视频导出 MP4，最高 30 帧/秒。画面尺寸跟随模板。');
    clearTextCache(); $('batchProgress').hidden = true; renderCopyFields(); syncSettings(); drawPreview();
  } catch (e) { toast('模板加载失败：' + e.message); }
  finally { loading = false; setBusy(false); }
}
function renderTemplates() {
  const category = $('categorySelect').value, query = $('templateSearch').value.trim();
  const visible = templates.filter(t => (category === 'all' || category === t.category) && (!query || (t.name + t.category).includes(query)));
  $('templates').innerHTML = visible.map(t => `<button class="template-card ${t.id === activeTemplate.id ? 'selected' : ''}" data-template="${t.id}" aria-pressed="${t.id === activeTemplate.id}" ${busy || loading ? 'disabled' : ''}><div class="template-thumb"><img loading="lazy" src="${t.thumb || t.url}" alt="${escapeHtml(t.name)}" /></div><h3>${escapeHtml(t.name)}</h3><div class="template-meta"><span>${t.width} × ${t.height}</span><span>${modeLabels[t.mode] || '透明边框'}</span></div></button>`).join('') || '<p class="small-note">没有匹配的素材。</p>';
  $('templateCount').textContent = `${visible.length} / ${templates.length} 款`;
}
function drawPreview() {
  canvas.width = activeTemplate.width; canvas.height = activeTemplate.height;
  if (previewMedia && activeTemplate.image && (previewMedia.naturalWidth || previewMedia.videoWidth)) {
    compose(context, previewMedia, previewMedia.naturalWidth || previewMedia.videoWidth, previewMedia.naturalHeight || previewMedia.videoHeight, textTemplate(activeTemplate, settings()), settings());
  } else {
    context.fillStyle = '#f8f5ef'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (activeTemplate.image) { const t = textTemplate(activeTemplate, settings()); if (t.mode === 'layered') { context.drawImage(t.bgImage, 0, 0); context.drawImage(t.fgImage, 0, 0); } else context.drawImage(t.image, 0, 0, canvas.width, canvas.height); }
  }
  $('canvasSize').textContent = `${canvas.width} × ${canvas.height}`;
  $('emptyHint').hidden = !!activeItem() || activeTemplate.mode === 'original';
}
function previewLoop() { drawPreview(); if (previewMedia instanceof HTMLVideoElement && !previewMedia.paused) animation = requestAnimationFrame(previewLoop); }
function releasePreview() {
  cancelAnimationFrame(animation);
  if (previewMedia instanceof HTMLVideoElement) { previewMedia.pause(); previewMedia.removeAttribute('src'); previewMedia.load(); }
  previewMedia = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $('playBtn').hidden = true; $('videoSeek').hidden = true;
}
async function selectItem(id) {
  if (busy || loading) return;
  selectedId = id;
  const item = activeItem(), version = ++previewVersion;
  releasePreview();
  if (item && itemTemplate(item)) await chooseTemplate(itemTemplate(item), false);
  if (version !== previewVersion) return;
  renderCopyFields(); syncSettings(); renderQueue(); drawPreview();
  if (!item) { $('previewLabel').textContent = '原版透明模板 · 等待素材'; return; }
  const url = URL.createObjectURL(item.file); previewUrl = url;
  $('previewLabel').textContent = item.file.name;
  try {
    let media;
    if (item.type === 'image') media = await loadImage(url);
    else {
      media = document.createElement('video'); media.muted = true; media.playsInline = true; media.preload = 'auto';
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('视频预览读取超时')), 20000);
        media.onloadeddata = () => { clearTimeout(timer); resolve(); };
        media.onerror = () => { clearTimeout(timer); reject(new Error('浏览器无法预览此视频，导出时将再次检测格式。')); };
        media.src = url;
      });
    }
    if (version !== previewVersion) { if (media instanceof HTMLVideoElement) { media.removeAttribute('src'); media.load(); } return; }
    previewMedia = media;
    $('videoSeek').hidden = item.type !== 'video';
    $('videoSeek').value = 0;
    if (item.type === 'video') media.ontimeupdate = () => { $('videoSeek').value = media.duration ? media.currentTime / media.duration * 100 : 0; };
    $('playBtn').hidden = item.type !== 'video'; $('playBtn').textContent = '播放预览';
    if (media instanceof HTMLVideoElement) media.onended = () => $('playBtn').textContent = '播放预览';
    if (media instanceof HTMLVideoElement) media.onseeked = drawPreview;
    drawPreview();
  } catch (e) { if (version === previewVersion) toast(e.message); }
}
function syncSettings() {
  const s = settings();
  $('coverBtn').classList.toggle('selected', s.fit === 'cover'); $('containBtn').classList.toggle('selected', s.fit === 'contain');
  $('zoom').value = s.zoom * 100; $('zoomValue').value = `${Math.round(s.zoom * 100)}%`;
  $('offsetX').value = Math.round(s.x); $('offsetY').value = Math.round(s.y); $('background').value = s.background;
}
function markChanged(item) {
  item.review = null; item.approved = false;
  $('batchProgress').hidden = true;
  if (item.status === 'done' || item.status === 'error' || item.status === 'canceled') { item.status = 'pending'; item.message = '设置已更新，待生成'; item.progress = 0; }
}
function updateSettings(patch) { if (busy || loading) return; Object.assign(settings(), patch); if (activeItem()) markChanged(activeItem()); syncSettings(); drawPreview(); renderQueue(); }
function renderQueue() {
  $('queueCount').textContent = queue.length;
  $('queueEmpty').hidden = queue.length > 0;
  $('queueList').innerHTML = queue.map(item => `<div class="queue-item ${item.id === selectedId ? 'active' : ''}" data-id="${item.id}" tabindex="0" role="button" aria-label="预览 ${escapeHtml(item.file.name)}"><img class="file-thumb" src="${item.thumb}" alt=""/><div class="file-info"><div class="file-name">${escapeHtml(item.file.name)}</div><div class="file-meta">${item.type === 'image' ? '图片' : '视频'} · ${item.width ? item.width + ' × ' + item.height + ' · ' : ''}${sizeLabel(item.file.size)} · ${escapeHtml(ratioLabel(item.width, item.height))}<br>→ ${escapeHtml(itemTemplate(item)?.name || '未匹配模板')}${item.manualTemplate ? ' · 手动指定' : ' · 自动匹配'}</div></div><span class="file-status ${item.status}" title="${escapeHtml(item.message)}">${escapeHtml(item.message)}</span>${item.status === 'running' ? `<progress value="${item.progress}" max="100"></progress>` : ''}<div class="item-actions">${item.result && item.status === 'done' ? `<button class="small-btn" data-download="${item.id}" ${busy ? 'disabled' : ''}>${item.result.saved ? '已保存 · 下载副本' : '下载'}</button>` : ''}<button class="text-btn" data-remove="${item.id}" aria-label="移除 ${escapeHtml(item.file.name)}" ${busy ? 'disabled' : ''}>移除</button></div></div>`).join('');
  const pending = queue.filter(i => i.status !== 'done').length;
  $('exportCount').textContent = pending;
  $('exportBtn').disabled = busy || loading || pending === 0 || !queue.some(i => itemTemplate(i)?.mode !== 'original');
  renderReviews();
  $('clearBtn').disabled = busy || loading || queue.length === 0;
  $('queueSummary').textContent = queue.length ? `${queue.length} 个文件 · ${queue.filter(i => i.type === 'image').length} 张图片 · ${queue.filter(i => i.type === 'video').length} 个视频${busy ? ' · 正在本地处理' : ''}` : '支持多选或拖入图片 / 视频，按顺序逐个处理';
}
function setBusy(value) {
  busy = value; $('settingsFields').disabled = value || loading; $('copyFields').disabled = value || loading;
  for (const id of ['importBtn', 'emptyImport', 'demoBtn', 'folderBtn', 'templateInput', 'mediaInput', 'categorySelect', 'templateSearch', 'downloadOriginal', 'resetCopy', 'applyCopyAll', 'downloadCsv', 'importCsv', 'csvInput', 'autoMatch', 'matchScope', 'rematchBtn', 'templateAllBtn', 'reviewBtn', 'approveAllBtn', 'autoCurrentBtn', 'videoSeek']) $(id).disabled = value || loading;
  $('cancelBtn').hidden = !value;
  renderTemplates(); renderQueue();
}
async function addFiles(files) {
  if (busy || loading) return;
  loading = true; setBusy(false);
  let skipped = 0;
  for (const file of files) {
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm)$/i.test(file.name) ? 'video' : null;
    if (!type) { skipped++; continue; }
    const item = { id: crypto.randomUUID(), file, type, settings: structuredClone(pendingSettings), status: 'pending', message: '待生成', progress: 0, thumb: '', result: null, templateId: preferredTemplateId || activeTemplate.id, manualTemplate: !$('autoMatch').checked };
    try {
      const source = await readMedia(file, type);
      try {
        item.width = source.width; item.height = source.height; item.duration = source.duration;
        const c = document.createElement('canvas'); c.width = 120; c.height = Math.max(1, Math.round(120 * item.height / item.width));
        if (c.height > 200) { c.width = Math.max(1, Math.round(200 * item.width / item.height)); c.height = 200; }
        c.getContext('2d').drawImage(source.media, 0, 0, c.width, c.height); item.thumb = c.toDataURL('image/jpeg', .7);
      } finally { source.close(); }
      if ($('autoMatch').checked) assignMatch(item);
    } catch (e) { item.status = 'error'; item.message = e.message; item.readError = e.message; }
    queue.push(item);
  }
  loading = false; setBusy(false);
  if (!selectedId && queue.length) await selectItem(queue[0].id);
  else renderQueue();
  await reviewBatch();
  if (skipped) toast(`已跳过 ${skipped} 个不支持的文件。`);
}
async function releaseResult(item) {
  if (!item.result) return;
  const result = item.result; item.result = null;
  if (result.temp && tempDirectory) await tempDirectory.removeEntry(result.storageName).catch(() => {});
}
async function getTempDirectory() {
  if (tempDirectory) return tempDirectory;
  if (!navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    // Only remove this application's abandoned temporary runs older than a day.
    for await (const name of root.keys()) {
      const timestamp = /^winter-studio-(\d+)-/.exec(name)?.[1];
      if (timestamp && Date.now() - Number(timestamp) > 86400000) await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
    tempDirectory = await root.getDirectoryHandle(`winter-studio-${Date.now()}-${crypto.randomUUID()}`, { create: true });
    return tempDirectory;
  } catch { return null; }
}
async function destination(name) {
  const dir = directory || await getTempDirectory();
  if (!dir) return { handle: null, name, saved: false, temp: false };
  let storageName = name;
  if (directory) {
    const dot = name.lastIndexOf('.'); let suffix = 1;
    while (true) {
      try { await dir.getFileHandle(storageName); storageName = `${name.slice(0, dot)}_${suffix++}${name.slice(dot)}`; }
      catch (e) { if (e.name === 'NotFoundError') break; throw e; }
    }
  } else storageName = crypto.randomUUID() + '-' + name;
  const handle = await dir.getFileHandle(storageName, { create: true });
  return { handle, name: directory ? storageName : name, storageName, dir, saved: !!directory, temp: !directory };
}
async function exportImage(item, dest) {
  const t = itemTemplate(item);
  const bitmap = await createImageBitmap(item.file);
  const c = new OffscreenCanvas(t.width, t.height);
  compose(c.getContext('2d'), bitmap, bitmap.width, bitmap.height, textTemplate(itemTemplate(item), item.settings), item.settings); bitmap.close();
  const blob = await c.convertToBlob({ type: `image/${$('imageFormat').value}`, quality: .94 });
  if (stopRequested) throw new Error('已停止');
  if (dest.handle) { const stream = await dest.handle.createWritable(); try { await stream.write(blob); await stream.close(); } catch (e) { await stream.abort().catch(() => {}); throw e; } }
  return dest.handle ? null : blob;
}
async function exportVideo(item, dest, onProgress) {
  const rendered = textTemplate(itemTemplate(item), item.settings);
  const layerKeys = ['image', 'bgImage', 'fgImage'];
  const template = {};
  const transfer = [];
  for (const key of ['mode', 'slot', 'radius', 'overlayWidth', 'overlayX', 'overlayY', 'graphicWidth', 'graphicHeight']) template[key] = rendered[key];
  for (const key of layerKeys) if (rendered[key]) { template[key] = await createImageBitmap(rendered[key]); transfer.push(template[key]); }
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL('./video-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return onProgress(data.value);
      worker.terminate(); worker = null;
      if (data.type === 'done') resolve(data.buffer ? new Blob([data.buffer], { type: 'video/mp4' }) : null);
      else reject(new Error(data.message || '已停止'));
    };
    worker.onerror = e => { worker?.terminate(); worker = null; reject(new Error(e.message || '视频处理失败')); };
    worker.postMessage({ type: 'start', file: item.file, template, settings: { ...item.settings }, width: itemTemplate(item).width, height: itemTemplate(item).height, handle: dest.handle, keepAudio: $('keepAudio').checked }, transfer);
    if (stopRequested) worker.postMessage({ type: 'cancel' });
  });
}
async function runBatch() {
  if (busy || loading) return;
  const jobs = queue.filter(i => i.status !== 'done');
  if (!jobs.length) return;
  stopRequested = false; setBusy(true);
  if (previewMedia instanceof HTMLVideoElement) { previewMedia.pause(); cancelAnimationFrame(animation); $('playBtn').textContent = '播放预览'; }
  $('batchProgress').hidden = false;
  let wakeLock = null, completed = 0;
  const progress = (fraction, label) => {
    $('overallProgress').value = Math.round((completed + fraction) / jobs.length * 100);
    $('batchPercent').textContent = `${$('overallProgress').value}%`; $('batchText').textContent = label;
  };
  try {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Optional. */ }
    for (const item of jobs) {
      if (stopRequested) break;
      await releaseResult(item);
      item.status = 'running'; item.progress = 0; item.message = '准备中'; renderQueue();
      let dest;
      try {
        const t = itemTemplate(item);
        if (item.matchError) throw new Error(item.matchError);
        if (!t || t.mode === 'original') throw new Error('请为此素材选择可合成的模板');
        await ensureAssets(t);
        const copyProblems = textErrors(t, item.settings);
        if (copyProblems.length) throw new Error(copyProblems.map(e => e.message).join('；'));
        const ext = item.type === 'video' ? 'mp4' : $('imageFormat').value === 'jpeg' ? 'jpg' : 'png';
        dest = await destination(outputName(item.file.name, queue.indexOf(item), ext));
        if (!dest.handle && queue.reduce((n, i) => n + (i.result?.blob?.size || 0), 0) > 200 * 1024 * 1024) throw new Error('临时内存已满，请下载后清空队列，或选择保存文件夹。');
        progress(0, `正在处理 ${completed + 1} / ${jobs.length}：${item.file.name}`);
        const blob = item.type === 'image' ? await exportImage(item, dest) : await exportVideo(item, dest, value => {
          item.progress = Math.min(99, Math.round(value * 100)); item.message = `处理中 ${item.progress}%`;
          progress(value, `正在处理 ${completed + 1} / ${jobs.length}：${item.file.name}`); renderQueue();
        });
        item.result = { ...dest, blob }; item.status = 'done'; item.progress = 100; item.message = dest.saved ? '已保存到文件夹' : '已完成 · 待下载';
      } catch (e) {
        if (dest?.handle) await dest.dir.removeEntry(dest.storageName).catch(() => {});
        item.status = stopRequested ? 'canceled' : 'error';
        item.message = stopRequested ? '已停止 · 可重新生成' : e.message;
      }
      trimAssets(activeTemplate); clearTextCache();
      completed++; renderQueue(); progress(0, `已处理 ${completed} / ${jobs.length}`);
    }
  } finally {
    await wakeLock?.release().catch(() => {});
    setBusy(false);
    const errors = jobs.filter(i => i.status === 'error').length;
    const done = jobs.filter(i => i.status === 'done').length;
    $('batchText').textContent = stopRequested ? `已停止 · 本次完成 ${done} 个，剩余任务可继续生成` : `本次完成 ${done} 个${errors ? `，失败 ${errors} 个，请查看文件旁提示` : ''}${directory ? ' · 已保存到所选文件夹' : ' · 请在队列中下载成品'}`;
    toast($('batchText').textContent);
  }
}
async function downloadResult(item) {
  try {
    const blob = item.result.handle ? await item.result.handle.getFile() : item.result.blob;
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = item.result.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { toast('无法读取成品，请重新生成。'); }
}

$('templates').addEventListener('click', e => {
  const button = e.target.closest('[data-template]'); if (!button || busy || loading) return;
  chooseTemplate(templates.find(t => t.id === button.dataset.template));
});
$('categorySelect').onchange = renderTemplates;
$('templateSearch').oninput = renderTemplates;
$('downloadOriginal').onclick = async () => {
  if (!activeTemplate.url) return;
  const response = await fetch(activeTemplate.url); const blob = await response.blob();
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url;
  a.download = `${activeTemplate.name}.${blob.type.includes('jpeg') ? 'jpg' : 'png'}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
$('templateInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file || busy || loading) return;
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.width > 3840 || image.height > 3840) throw new Error('试用版模板最长边支持 3840 像素。');
    const c = new OffscreenCanvas(image.width, image.height), ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let transparent = false; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) { transparent = true; break; }
    if (!transparent) throw new Error('这张 PNG 没有透明区域，会挡住素材。请使用带透明区域的模板。');
    const t = { id: crypto.randomUUID(), name: file.name.replace(/\.png$/i, ''), url, image, width: image.width, height: image.height, category: '自定义模板', mode: 'overlay', graphicWidth: image.width, graphicHeight: image.height };
    templates.push(t); $('categorySelect').value = 'all'; $('templateSearch').value = ''; await chooseTemplate(t);
  } catch (error) { URL.revokeObjectURL(url); toast(error.message); }
  e.target.value = '';
});
for (const id of ['emptyImport', 'importBtn']) $(id).onclick = () => $('mediaInput').click();
$('mediaInput').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
for (const type of ['dragenter', 'dragover']) $('dropZone').addEventListener(type, e => { e.preventDefault(); if (!busy) $('dropZone').classList.add('dragover'); });
$('dropZone').addEventListener('dragleave', e => { if (!$('dropZone').contains(e.relatedTarget)) $('dropZone').classList.remove('dragover'); });
$('dropZone').addEventListener('drop', e => { e.preventDefault(); $('dropZone').classList.remove('dragover'); addFiles([...e.dataTransfer.files]); });
window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => e.preventDefault());
$('queueList').onclick = async e => {
  if (busy || loading) return;
  const dl = e.target.closest('[data-download]'); if (dl) return downloadResult(queue.find(i => i.id === dl.dataset.download));
  const remove = e.target.closest('[data-remove]');
  if (remove) { const item = queue.find(i => i.id === remove.dataset.remove); await releaseResult(item); queue = queue.filter(i => i !== item); if (selectedId === item.id) await selectItem(queue[0]?.id); else renderQueue(); return; }
  const row = e.target.closest('[data-id]'); if (row) selectItem(row.dataset.id);
};
$('queueList').onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.queue-item')) { e.preventDefault(); selectItem(e.target.dataset.id); } };
$('clearBtn').onclick = async () => { if (busy || loading) return; for (const item of queue) await releaseResult(item); queue = []; await selectItem(undefined); $('batchProgress').hidden = true; };
$('coverBtn').onclick = () => updateSettings({ fit: 'cover' }); $('containBtn').onclick = () => updateSettings({ fit: 'contain' });
$('zoom').oninput = e => updateSettings({ zoom: Number(e.target.value) / 100 });
for (const [id, key] of [['offsetX', 'x'], ['offsetY', 'y']]) $(id).oninput = e => updateSettings({ [key]: Math.max(-100, Math.min(100, Number(e.target.value) || 0)) });
$('background').oninput = e => updateSettings({ background: e.target.value });
$('resetBtn').onclick = () => updateSettings({ ...defaults(), texts: settings().texts });
$('applyAllBtn').onclick = () => { if (busy) return; const { texts, ...copy } = settings(); Object.assign(pendingSettings, copy); for (const item of queue) { Object.assign(item.settings, copy); markChanged(item); } renderQueue(); toast('当前适配、缩放、位置和底色已应用到全部素材。'); };
for (const id of ['imageFormat', 'keepAudio']) $(id).onchange = () => { queue.filter(i => id === 'imageFormat' ? i.type === 'image' : i.type === 'video').forEach(markChanged); renderQueue(); };
$('playBtn').onclick = async () => {
  if (!(previewMedia instanceof HTMLVideoElement) || busy) return;
  if (previewMedia.paused) { try { await previewMedia.play(); $('playBtn').textContent = '暂停预览'; previewLoop(); } catch { toast('此视频无法播放，请换用浏览器支持的格式。'); } }
  else { previewMedia.pause(); cancelAnimationFrame(animation); $('playBtn').textContent = '播放预览'; }
};
let drag;
canvas.onpointerdown = e => { if (busy || loading || !previewMedia) return; drag = { x: e.clientX, y: e.clientY, settings: { ...settings() } }; canvas.setPointerCapture(e.pointerId); };
canvas.onpointermove = e => { if (!drag) return; const rect = canvas.getBoundingClientRect(); updateSettings({ x: Math.max(-100, Math.min(100, drag.settings.x + (e.clientX - drag.x) / rect.width * activeTemplate.width / (activeTemplate.slot?.width || activeTemplate.width) * 100)), y: Math.max(-100, Math.min(100, drag.settings.y + (e.clientY - drag.y) / rect.height * activeTemplate.height / (activeTemplate.slot?.height || activeTemplate.height) * 100)) }); };
canvas.onpointerup = canvas.onpointercancel = () => drag = null;
$('folderBtn').onclick = async () => {
  if (!window.showDirectoryPicker) return toast('此浏览器不支持选择文件夹。仍可批量生成，再逐个下载；推荐使用 Chrome / Edge。');
  try { directory = await window.showDirectoryPicker({ mode: 'readwrite', id: 'winter-studio-output' }); $('folderLabel').textContent = `保存到：${directory.name}（同名文件自动编号）`; $('folderBtn').textContent = '更换保存文件夹'; }
  catch (e) { if (e.name !== 'AbortError') toast('无法取得文件夹权限，可以继续生成并逐个下载。'); }
};
$('exportBtn').onclick = runBatch;
$('cancelBtn').onclick = () => { stopRequested = true; worker?.postMessage({ type: 'cancel' }); $('batchText').textContent = '正在停止并清理未完成文件…'; };
$('helpBtn').onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });
$('demoBtn').onclick = async () => {
  if (busy || loading) return;
  const files = [];
  for (const [i, color] of ['#ded8c4', '#d7dbcd', '#e8d2bb'].entries()) {
    const c = new OffscreenCanvas(i === 1 ? 1280 : 900, i === 2 ? 1200 : 900), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, '#faf6ee'); g.addColorStop(1, color); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#0000000d'; x.beginPath(); x.ellipse(c.width / 2, c.height * .79, c.width * .24, 30, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = ['#89765b', '#7a8770', '#aa795a'][i]; x.fillRect(c.width * .31, c.height * .29, c.width * .38, c.height * .48);
    x.fillStyle = '#f7edda'; x.fillRect(c.width * .335, c.height * .32, c.width * .33, c.height * .42);
    x.textAlign = 'center'; x.fillStyle = '#67543d'; x.font = '16px sans-serif'; x.fillText('WINTER COLLECTION', c.width / 2, c.height * .40);
    x.font = '48px serif'; x.fillText(['冬藏好茶', '暖冬谷物', '甄选好礼'][i], c.width / 2, c.height * .53);
    x.font = '20px sans-serif'; x.fillText('示例素材 · 可替换', c.width / 2, c.height * .64);
    files.push(new File([await c.convertToBlob({ type: 'image/png' })], `示例商品_${i + 1}.png`, { type: 'image/png' }));
  }
  await addFiles(files);
};
$('capability').textContent = typeof VideoEncoder !== 'undefined' ? '图片与视频本地处理可用 · 视频格式将在导出时检测' : '图片处理可用 · 视频导出请使用电脑端 Chrome / Edge';
await loadTemplates().catch(e => toast('模板加载失败：' + e.message));
renderQueue();

function renderCopyFields() {
  const fields = activeTemplate.texts || [], values = settings().texts?.[activeTemplate.id] || {};
  $('copyScope').textContent = fields.length ? (activeItem() ? `正在编辑：${activeItem().file.name} · ${activeTemplate.name}` : `正在编辑默认文案 · ${activeTemplate.name}（添加素材后自动使用）`) : '此模板没有独立的可替换文字层，固定 Logo / 图稿保持原样。';
  $('copyInputs').innerHTML = fields.map(f => `<label class="copy-field">${escapeHtml(f.label)}<textarea data-copy="${f.id}" aria-label="${escapeHtml(f.label)}" rows="${f.vertical ? 1 : Math.min(3, f.original.split('\n').length)}" maxlength="1000">${escapeHtml(values[f.id] ?? f.original)}</textarea><span class="copy-style">${escapeHtml(f.font)} · ${(f.fontSize * Math.abs(f.transform[3])).toFixed(1)} px${f.vertical ? ' · 竖排' : ''}</span><span class="copy-field-error" data-copy-error="${f.id}"></span></label>`).join('');
  $('copyPanel').classList.toggle('no-copy', !fields.length);
  renderCopyErrors();
}
function renderCopyErrors() {
  const problems = textErrors(activeTemplate, settings());
  for (const field of document.querySelectorAll('[data-copy-error]')) field.textContent = problems.find(e => e.id === field.dataset.copyError)?.message || '';
  $('copyErrors').textContent = problems.length ? '请修改提示中的文案；存在问题的素材不会导出，批次中的其他素材继续处理。' : '';
}
function setCopy(values) {
  if (busy || loading) return;
  settings().texts ||= {}; settings().texts[activeTemplate.id] = { ...values };
  if (activeItem()) markChanged(activeItem());
  clearTextCache(); renderCopyErrors(); drawPreview(); renderQueue();
}
$('copyInputs').oninput = e => {
  if (!e.target.dataset.copy) return;
  setCopy({ ...(settings().texts?.[activeTemplate.id] || {}), [e.target.dataset.copy]: e.target.value });
};
$('resetCopy').onclick = () => { setCopy({}); renderCopyFields(); };
$('applyCopyAll').onclick = () => {
  if (busy || loading) return;
  const values = structuredClone(settings().texts?.[activeTemplate.id] || {});
  pendingSettings.texts ||= {}; pendingSettings.texts[activeTemplate.id] = structuredClone(values);
  for (const item of queue.filter(i => i.templateId === activeTemplate.id)) { item.settings.texts ||= {}; item.settings.texts[activeTemplate.id] = structuredClone(values); markChanged(item); }
  renderQueue(); toast(`文案已应用到使用当前模板的素材；其他模板文案保持不变`);
};
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('downloadCsv').onclick = () => {
  const fields = activeTemplate.texts || []; if (!fields.length) return;
  if (!queue.length) return toast('先添加客户素材，再下载带文件名的 CSV');
  const rows = [['文件名', ...fields.map(f => `${f.label} [${f.id}]`)], ...queue.filter(i => i.templateId === activeTemplate.id).map(item => [item.file.name, ...fields.map(f => item.settings.texts?.[activeTemplate.id]?.[f.id] ?? f.original)])];
  downloadBlob(new Blob([csvEncode(rows)], { type: 'text/csv;charset=utf-8' }), `${activeTemplate.name}_批量文案.csv`);
};
$('importCsv').onclick = () => $('csvInput').click();
$('csvInput').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || busy || loading) return;
  loading = true; setBusy(false);
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('CSV 超过 5 MB，请分批导入');
    const updates = csvUpdates(csvParse(await file.text()), queue.filter(i => i.templateId === activeTemplate.id).map(i => i.file.name), activeTemplate.texts || []);
    for (const update of updates) { const item = queue.find(i => i.file.name === update.name); item.settings.texts ||= {}; item.settings.texts[activeTemplate.id] = { ...(item.settings.texts[activeTemplate.id] || {}), ...update.values }; markChanged(item); }
    clearTextCache(); renderCopyFields(); drawPreview(); renderQueue();
    const errors = queue.filter(i => i.templateId === activeTemplate.id && textErrors(activeTemplate, i.settings).length).length;
    toast(`已匹配 ${updates.length} 个素材的文案${errors ? `；${errors} 个素材有超长或字体问题，请逐个检查` : ''}`);
  } catch (error) { toast('导入失败：' + error.message); }
  finally { loading = false; setBusy(false); }
};

function trimAssets(keep) {
  for (const t of templates) if (t !== keep) {
    for (const key of ['image', 'bgImage', 'fgImage', 'textCleanBGImage', 'textCleanFGImage', 'textCleanImage']) delete t[key];
    for (const f of t.texts || []) delete f.image;
  }
}
function assignMatch(item) {
  const preferred = templates.find(t => t.id === preferredTemplateId);
  const t = matchTemplate(item, templates, preferred, $('matchScope').value);
  if (!t) { markChanged(item); item.manualTemplate = false; item.matchError = '当前范围没有可用模板，请扩大匹配范围或手动指定'; return; }
  item.matchError = ''; item.templateId = t.id; item.manualTemplate = false;
  item.settings = { ...defaults(), background: item.settings.background, texts: item.settings.texts, fit: 'contain' };
  markChanged(item);
}
function renderReviews() {
  const ready = queue.filter(i => i.review).length, issues = queue.filter(i => i.review?.notes.length).length;
  $('reviewSummary').textContent = `${ready} / ${queue.length} 已检查 · ${issues} 项有提示 · ${queue.filter(i => i.approved).length} 项已人工确认`;
  $('reviewList').innerHTML = queue.filter(i => !$('issuesOnly').checked || !i.review || i.review.notes.length).map(item => {
    const t = itemTemplate(item), r = item.review;
    return `<article class="review-card"><div class="review-images">${r?.images.length ? r.images.map((image, n) => `<button data-review-open="${item.id}" data-time="${r.times[n] || 0}" aria-label="检查 ${escapeHtml(item.file.name)}${item.type === 'video' ? ' 第 ' + (n + 1) + ' 个抽帧' : ''}"><img src="${image}" alt="合成预览"/>${item.type === 'video' ? `<span>${r.times[n].toFixed(1)} 秒</span>` : ''}</button>`).join('') : '<span class="small-note">待生成合成预览</span>'}</div><strong>${escapeHtml(item.file.name)}</strong><p>${escapeHtml(ratioLabel(item.width, item.height))} → ${escapeHtml(t?.name || '未匹配')}<br>${t ? `${t.width} × ${t.height}` : ''}${item.manualTemplate ? ' · 手动指定' : ''}</p><ul>${(r?.notes || ['设置已更新，请重新 review']).map(note => `<li>${escapeHtml(note)}</li>`).join('') || '<li>未发现比例或文案问题，请检查实际画面</li>'}</ul><div class="review-actions"><button class="small-btn" data-review-open="${item.id}" ${busy || loading ? 'disabled' : ''}>调整／播放</button><button class="small-btn" data-approve="${item.id}" ${!r || r.blocked || busy || loading ? 'disabled' : ''}>${item.approved ? '✓ 已确认' : '确认画面'}</button></div></article>`;
  }).join('');
}
async function reviewBatch() {
  if (busy || loading || !queue.length) return;
  loading = true; setBusy(false);
  if (previewMedia instanceof HTMLVideoElement) { previewMedia.pause(); cancelAnimationFrame(animation); $('playBtn').textContent = '播放预览'; }
  try {
    for (const [index, item] of queue.entries()) {
      if (item.review && !item.review.blocked) continue;
      $('reviewSummary').textContent = `正在本地检查 ${index + 1} / ${queue.length}：${item.file.name}`;
      let source;
      try {
        const t = itemTemplate(item);
        if (item.readError) throw new Error(item.readError);
        if (item.matchError) throw new Error(item.matchError);
        if (!t || t.mode === 'original') throw new Error('此模板仅供原图下载，请选择可套图的模板');
        await ensureAssets(t);
        const errors = textErrors(t, item.settings).map(e => e.message);
        const notes = [...geometryReview(item, t).notes, ...errors];
        source = await readMedia(item.file, item.type);
        const times = item.type === 'video' ? [.1, .5, .9].map(f => source.duration * f) : [0];
        const images = [], c = new OffscreenCanvas(t.width, t.height), thumb = document.createElement('canvas');
        thumb.width = Math.max(1, Math.round(t.width * Math.min(320 / t.width, 320 / t.height)));
        thumb.height = Math.max(1, Math.round(t.height * Math.min(320 / t.width, 320 / t.height)));
        const rendered = textTemplate(t, item.settings);
        for (const time of times) {
          if (item.type === 'video') await seekFrame(source.media, time);
          compose(c.getContext('2d'), source.media, source.width, source.height, rendered, item.settings);
          thumb.getContext('2d').drawImage(c, 0, 0, thumb.width, thumb.height);
          images.push(thumb.toDataURL('image/jpeg', .8));
        }
        if (item.type === 'video') notes.push('视频仅抽查 10% / 50% / 90% 三帧，请播放检查全片');
        item.review = { images, times, notes, blocked: errors.length > 0 };
      } catch (e) { item.review = { images: [], times: [], notes: [e.message], blocked: true }; }
      finally { source?.close(); trimAssets(activeTemplate); clearTextCache(); }
      renderReviews();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { loading = false; setBusy(false); }
}
$('rematchBtn').onclick = async () => {
  if (busy || loading) return;
  for (const item of queue) if (!item.manualTemplate) assignMatch(item);
  await selectItem(selectedId); await reviewBatch();
};
$('templateAllBtn').onclick = async () => {
  if (busy || loading) return;
  for (const item of queue) { item.templateId = activeTemplate.id; item.manualTemplate = true; item.matchError = ''; item.settings.fit = settings().fit; markChanged(item); }
  renderQueue(); await reviewBatch();
};
$('autoCurrentBtn').onclick = async () => {
  if (busy || loading || !activeItem()) return;
  assignMatch(activeItem()); await selectItem(selectedId); await reviewBatch();
};
$('reviewBtn').onclick = reviewBatch;
$('issuesOnly').onchange = renderReviews;
$('approveAllBtn').onclick = () => { if (busy || loading) return; for (const item of queue) if (item.review && !item.review.blocked && !item.review.notes.length) item.approved = true; renderReviews(); };
$('reviewList').onclick = async e => {
  if (busy || loading) return;
  const approve = e.target.closest('[data-approve]');
  if (approve) { const item = queue.find(i => i.id === approve.dataset.approve); if (item.review && !item.review.blocked) item.approved = !item.approved; renderReviews(); return; }
  const open = e.target.closest('[data-review-open]');
  if (open) { await selectItem(open.dataset.reviewOpen); if (previewMedia instanceof HTMLVideoElement) previewMedia.currentTime = Number(open.dataset.time || 0); $('previewStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
};
$('videoSeek').oninput = () => { if (previewMedia instanceof HTMLVideoElement && !busy && !loading) { previewMedia.currentTime = Number($('videoSeek').value) / 100 * previewMedia.duration; } };
