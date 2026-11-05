import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/* =========================================================================
   The showcase as a video file. Every frame is drawn at an exact 1/60 s step,
   however long it takes to draw, encoded by the browser (WebCodecs, H.264)
   and packed into an MP4 (mp4-muxer), so the file is smooth whatever the
   machine manages live. At each cut the new place gets a moment (real time,
   the film's clock held) for its terrain and shadows to arrive from the
   workers before its frames are kept, and no frame is kept while terrain is
   still streaming in. With cinema detail the picture is drawn at twice the
   size and scaled down (supersampling). Video only: lay your own music over it.
   ========================================================================= */
export type FilmSource = {
  canvas: HTMLCanvasElement;
  /** draw the next frame, dt seconds on; false once the film has ended */
  next(dt: number): boolean;
  /** the frame just drawn opens a new shot */
  cut(): boolean;
  /** draw again without moving on (while a new place settles) */
  settle(): void;
  /** terrain or a region is still streaming in from the workers */
  busy(): boolean;
  progress(f: number): void;
  cancelled(): boolean;
};

// a yield to the event loop (worker messages, encoder output) that a hidden tab does not slow to one a second,
// as it does timers
const chan = new MessageChannel(), waiting: (() => void)[] = [];
chan.port1.onmessage = () => waiting.shift()?.();
const breathe = () => new Promise<void>((r) => { waiting.push(r); chan.port2.postMessage(0); });

export async function exportFilm(src: FilmSource, length: number, { w = 1920, h = 1080, fps = 60, bitrate = 16e6 } = {}) {
  if (!('VideoEncoder' in window)) throw new Error('This browser cannot encode video (no WebCodecs). Try a recent Chrome or Edge.');
  // H.264 High (level 5.1 covers 1080p60 with room), else Main
  const config: VideoEncoderConfig = { codec: 'avc1.640033', width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality' };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) {
    config.codec = 'avc1.4d0033';
    if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This browser cannot encode H.264 video at this size.');
  }
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
  let failed: unknown = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
  enc.configure(config);
  const out = new OffscreenCanvas(w, h), small = out.getContext('2d')!;
  small.imageSmoothingEnabled = true; small.imageSmoothingQuality = 'high';
  try {
    for (let i = 0; ; i++) {
      if (failed) throw failed;
      if (src.cancelled()) return null;
      if (!src.next(1 / fps)) break;
      // terrain, grass, bakes: at a cut at least a second and a half of real time with the film held, and never a
      // frame kept while chunks are still streaming in (at most a few seconds' wait)
      const t0 = performance.now(), min = i === 0 || src.cut() ? 1500 : 0;
      while (performance.now() - t0 < min || (src.busy() && performance.now() - t0 < min + 4000)) { await breathe(); src.settle(); }
      // supersampled: the big canvas scaled down to the video's size, a proper filter averaging the extra pixels
      let picture: CanvasImageSource = src.canvas;
      if (src.canvas.width !== w) { small.drawImage(src.canvas, 0, 0, w, h); picture = out; }
      const frame = new VideoFrame(picture, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 6) await breathe();
      // let the workers' messages and the page breathe
      if (i % 3 === 0) { src.progress(Math.min(i / fps / length, 1)); await breathe(); }
    }
    await enc.flush();
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
}
