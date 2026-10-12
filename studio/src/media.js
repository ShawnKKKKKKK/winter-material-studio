// Open one local file at a time; never retain full video buffers or object URLs.
export async function readMedia(file, type) {
  const url = URL.createObjectURL(file);
  const media = document.createElement(type === 'video' ? 'video' : 'img');
  const close = () => { if (type === 'video') media.pause(); media.removeAttribute('src'); if (type === 'video') media.load(); URL.revokeObjectURL(url); };
  try {
    if (type === 'video') { media.muted = true; media.playsInline = true; media.preload = 'auto'; }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('素材读取超时，请换用浏览器支持的文件')); }, 20000);
      const cleanup = () => { clearTimeout(timer); media.onload = media.onloadeddata = media.onerror = null; };
      media.onload = media.onloadeddata = () => { cleanup(); resolve(); };
      media.onerror = () => { cleanup(); reject(new Error('无法读取素材，请转换为 JPG / PNG 或 MP4')); };
      media.src = url;
    });
    return { media, width: media.naturalWidth || media.videoWidth, height: media.naturalHeight || media.videoHeight, duration: Number.isFinite(media.duration) ? media.duration : 0, close };
  } catch (e) { close(); throw e; }
}
export async function seekFrame(video, time) {
  if (Math.abs(video.currentTime - time) < .01) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.onseeked = video.onerror = null; };
    const timer = setTimeout(() => { cleanup(); reject(new Error('视频抽帧超时')); }, 15000);
    video.onseeked = () => { cleanup(); resolve(); };
    video.onerror = () => { cleanup(); reject(new Error('视频抽帧失败')); };
    video.currentTime = time;
  });
}
