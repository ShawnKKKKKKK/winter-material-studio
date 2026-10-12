import { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, StreamTarget, BufferTarget, Conversion, QUALITY_HIGH, EncodedAudioPacketSource, EncodedPacketSink } from 'mediabunny';
import { compose } from './layout.js';

let conversion, canceled = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    canceled = true;
    await conversion?.cancel().catch(() => {});
    return;
  }
  const { file, template, settings, width, height, handle, keepAudio } = data;
  let input, output, writable;
  try {
    if (typeof VideoEncoder === 'undefined') throw new Error('此浏览器不支持视频编码，请使用电脑端最新版 Chrome / Edge。');
    if (width % 2 || height % 2) throw new Error('MP4 模板的宽高需要为偶数，请导入偶数尺寸的 PNG。');
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error('无法解码此视频。请先转为 H.264 编码的 MP4 再试。');
    const audioTracks = keepAudio ? await input.getAudioTracks() : [];
    // Preserve ordinary MP4 AAC packets instead of adding another encoder's priming delay.
    const copyAudio = audioTracks.length === 1 && await audioTracks[0].getCodec() === 'aac'
      && Math.abs(await track.getFirstTimestamp()) < 1e-6
      && await audioTracks[0].getFirstTimestamp() <= 0 ? audioTracks[0] : null;
    if (canceled) throw new Error('已停止');
    writable = handle ? await handle.createWritable() : null;
    const target = writable ? new StreamTarget(writable, { chunked: true, chunkSize: 2 ** 20 }) : new BufferTarget();
    if (!handle) target.on('write', ({ end }) => {
      if (end > 180 * 1024 * 1024) throw new Error('成品超过临时内存上限，请选择保存文件夹后重试。');
    });
    output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
    const audioSource = copyAudio ? new EncodedAudioPacketSource('aac') : null;
    if (audioSource) output.addAudioTrack(audioSource);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    const packetStats = await track.computePacketStats(120);
    conversion = await Conversion.init({
      input, output, showWarnings: false, composable: !!copyAudio,
      video: (t) => t.id !== track.id ? { discard: true } : {
        codec: 'avc', bitrate: QUALITY_HIGH, forceTranscode: true,
        allowRotationMetadata: false, frameRate: Math.min(30, packetStats.averagePacketRate || 30),
        processedWidth: width, processedHeight: height,
        process: (sample) => {
          if (canceled) return null;
          compose(ctx, sample, sample.displayWidth, sample.displayHeight, template, settings, true);
          return canvas;
        },
      },
      audio: keepAudio && !copyAudio ? {} : { discard: true },
    });
    if (!conversion.isValid || conversion.discardedTracks.some(d => d.track.id === track.id)) {
      throw new Error('当前设备无法导出此尺寸的 H.264 视频，请换用 Chrome / Edge 或较小的模板。');
    }
    if (audioTracks.some(t => t !== copyAudio && conversion.discardedTracks.some(d => d.track.id === t.id))) {
      throw new Error('当前浏览器无法保留这个音轨。请转为 AAC 音轨，或取消“保留视频原声”后重试。');
    }
    if (canceled) { await conversion.cancel(); throw new Error('已停止'); }
    let lastProgress = 0;
    conversion.onProgress = (progress) => {
      const now = performance.now();
      if (now - lastProgress > 180 || progress === 1) {
        lastProgress = now; self.postMessage({ type: 'progress', value: progress });
      }
    };
    if (copyAudio) {
      await output.start();
      const duration = await copyAudio.computeDuration();
      const config = await copyAudio.getDecoderConfig();
      const copyPackets = async () => {
        for await (const packet of new EncodedPacketSink(copyAudio).packets()) {
          if (canceled) break;
          if (packet.timestamp < 0 || packet.timestamp >= duration) continue;
          await audioSource.add(packet.clone({ duration: Math.min(packet.duration, duration - packet.timestamp) }), { decoderConfig: config });
        }
        audioSource.close();
      };
      await Promise.all([conversion.execute(), copyPackets()]);
      if (canceled) throw new Error('已停止');
      await output.finalize();
    } else await conversion.execute();
    if (canceled) throw new Error('已停止');
    self.postMessage({ type: 'done', buffer: handle ? null : target.buffer }, handle ? [] : [target.buffer]);
  } catch (error) {
    await output?.cancel().catch(() => {});
    await writable?.abort().catch(() => {});
    let message = error.message || String(error);
    if (/unsupported or unrecognizable format/i.test(message)) message = '文件格式无法识别或已损坏，请更换视频文件。';
    if (/quota/i.test(message)) message = '本地可用空间不足，请清理空间或选择其他保存文件夹。';
    self.postMessage({ type: canceled ? 'canceled' : 'error', message });
  } finally {
    input?.dispose();
    template.image?.close(); template.bgImage?.close(); template.fgImage?.close();
  }
};
