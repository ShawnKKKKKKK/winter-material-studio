export function placement(sw, sh, width, height, settings) {
  const base = settings.fit === 'contain' ? Math.min(width / sw, height / sh) : Math.max(width / sw, height / sh);
  const scale = base * settings.zoom;
  const w = sw * scale, h = sh * scale;
  return { x: (width - w) / 2 + settings.x * width / 100, y: (height - h) / 2 + settings.y * height / 100, w, h };
}

export function compose(ctx, source, sw, sh, template, settings, sample = false) {
  const { width, height } = ctx.canvas;
  // Both preview and video worker receive the same immutable layer descriptor.
  const t = template.image ? template : { image: template, mode: 'overlay' };
  ctx.fillStyle = settings.background;
  ctx.fillRect(0, 0, width, height);
  if (t.mode === 'original') { ctx.drawImage(t.image, 0, 0, width, height); return; }
  if (t.bgImage) ctx.drawImage(t.bgImage, 0, 0);
  if (t.mode === 'inset') ctx.drawImage(t.image, 0, 0);
  const slot = t.slot || { x: 0, y: 0, width, height };
  const r = placement(sw, sh, slot.width, slot.height, settings);
  r.x += slot.x; r.y += slot.y;
  ctx.save();
  if (t.mode === 'inset') {
    ctx.beginPath();
    // The right-hand edge borders the white panel and remains square.
    ctx.roundRect(slot.x, slot.y, slot.width, slot.height, [t.radius || 0, 0, 0, t.radius || 0]);
    ctx.clip();
    ctx.fillStyle = settings.background;
    ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
  }
  if (sample) source.draw(ctx, r.x, r.y, r.w, r.h);
  else ctx.drawImage(source, r.x, r.y, r.w, r.h);
  ctx.restore();
  if (t.mode === 'layered') ctx.drawImage(t.fgImage, 0, 0);
  else if (t.mode === 'badge') {
    const badgeWidth = width * t.overlayWidth;
    ctx.drawImage(t.image, width * t.overlayX, height * t.overlayY, badgeWidth, badgeWidth * t.image.height / t.image.width);
  } else if (t.mode !== 'inset') ctx.drawImage(t.image, 0, 0, t.graphicWidth || width, t.graphicHeight || height);
}

export function outputName(name, index, ext) {
  const stem = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90);
  return `${String(index + 1).padStart(3, '0')}_${stem}_冬藏季.${ext}`;
}
