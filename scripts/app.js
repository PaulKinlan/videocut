const $ = (selector) => document.querySelector(selector);
const els = {
  file: $("#video-file"), drop: $("#drop-zone"), fileError: $("#file-error"),
  editor: $("#editor"), video: $("#video"), fileName: $("#file-name"), fileDetails: $("#file-details"),
  startRange: $("#start-range"), endRange: $("#end-range"), startTime: $("#start-time"), endTime: $("#end-time"),
  selectedRange: $("#selected-range"), summary: $("#clip-summary"), setStart: $("#set-start"), setEnd: $("#set-end"),
  preview: $("#preview"), trim: $("#trim"), editorError: $("#editor-error"),
  progressPanel: $("#progress-panel"), progress: $("#progress"), progressStatus: $("#progress-status"), cancel: $("#cancel"),
  result: $("#result"), output: $("#output-video"), download: $("#download"), startOver: $("#start-over"),
};

let sourceUrl = "";
let outputUrl = "";
let currentFile = null;
let activeRecorder = null;
let cancelled = false;
let stopPreview = null;

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(secs < 10 ? 2 : 1).padStart(5, "0")}`;
};
const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes > 10_000_000 ? 0 : 1)} MB`;
const showError = (el, message = "") => { el.textContent = message; el.hidden = !message; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function values() {
  return { start: Number(els.startTime.value), end: Number(els.endTime.value), duration: els.video.duration };
}

function syncRange() {
  const { start, end, duration } = values();
  const left = duration ? start / duration * 100 : 0;
  const right = duration ? end / duration * 100 : 100;
  els.selectedRange.style.insetInlineStart = `${left}%`;
  els.selectedRange.style.inlineSize = `${Math.max(0, right - left)}%`;
  els.summary.textContent = `${formatTime(start)}–${formatTime(end)} · ${formatTime(end - start)} selected`;
  const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= duration + 0.001 && start < end;
  els.trim.disabled = !valid;
  els.preview.disabled = !valid;
  showError(els.editorError, valid ? "" : "Choose an end time after the start, within the video duration.");
}

function updateFromRange(changed) {
  let start = Number(els.startRange.value);
  let end = Number(els.endRange.value);
  if (changed === "start") start = Math.min(start, end - 0.05);
  else end = Math.max(end, start + 0.05);
  els.startRange.value = start;
  els.endRange.value = end;
  els.startTime.value = start.toFixed(3);
  els.endTime.value = end.toFixed(3);
  els.video.currentTime = changed === "start" ? start : end;
  syncRange();
}

function updateFromTime(changed) {
  const duration = els.video.duration || 0;
  let start = clamp(Number(els.startTime.value), 0, duration);
  let end = clamp(Number(els.endTime.value), 0, duration);
  if (changed === "start") start = Math.min(start, end - 0.05);
  else end = Math.max(end, start + 0.05);
  els.startTime.value = start.toFixed(3);
  els.endTime.value = end.toFixed(3);
  els.startRange.value = start;
  els.endRange.value = end;
  els.video.currentTime = changed === "start" ? start : end;
  syncRange();
}

async function loadVideo(file) {
  showError(els.fileError);
  if (!file || (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name))) {
    showError(els.fileError, "That doesn’t look like a video. Choose an MP4, WebM, MOV, or another playable video file.");
    return;
  }
  currentFile = file;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  els.fileName.textContent = file.name;
  els.fileDetails.textContent = formatSize(file.size);
  els.editor.hidden = false;
  els.result.hidden = true;
  els.progressPanel.hidden = true;
  try {
    await new Promise((resolve, reject) => {
      els.video.onloadedmetadata = resolve;
      els.video.onerror = () => reject(new Error("This browser cannot play that video format."));
      els.video.src = sourceUrl;
    });
    const duration = els.video.duration;
    els.startRange.max = els.endRange.max = duration;
    els.startTime.max = els.endTime.max = duration;
    els.startRange.value = els.startTime.value = "0.000";
    els.endRange.value = els.endTime.value = String(duration);
    els.fileDetails.textContent = `${formatTime(duration)} · ${formatSize(file.size)}`;
    syncRange();
    els.editor.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } catch (error) {
    els.editor.hidden = true;
    showError(els.fileError, error.message);
  }
}

async function previewSelection() {
  if (stopPreview) stopPreview();
  const { start, end } = values();
  els.video.currentTime = start;
  await els.video.play();
  const check = () => { if (els.video.currentTime >= end) { els.video.pause(); cleanup(); } };
  const cleanup = () => { els.video.removeEventListener("timeupdate", check); stopPreview = null; };
  stopPreview = cleanup;
  els.video.addEventListener("timeupdate", check);
}

function supportedMime() {
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function createClip() {
  showError(els.editorError);
  const capture = els.video.captureStream || els.video.mozCaptureStream;
  if (!capture || !window.MediaRecorder) {
    showError(els.editorError, "This browser cannot record a video element. Try current Chrome, Edge, or Firefox on desktop.");
    return;
  }
  const { start, end } = values();
  cancelled = false;
  els.progressPanel.hidden = false;
  els.result.hidden = true;
  els.trim.disabled = true;
  els.preview.disabled = true;
  els.progress.value = 0;
  els.progressStatus.textContent = "Preparing playback…";
  els.progressPanel.scrollIntoView({ block: "nearest" });
  const chunks = [];
  let recorder;
  try {
    els.video.pause();
    els.video.currentTime = start;
    await new Promise((resolve) => els.video.addEventListener("seeked", resolve, { once: true }));
    const stream = capture.call(els.video);
    recorder = new MediaRecorder(stream, supportedMime() ? { mimeType: supportedMime() } : undefined);
    activeRecorder = recorder;
    recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
    const finished = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(recorder.error || new Error("Recording failed."));
    });
    recorder.start(250);
    await els.video.play();
    els.progressStatus.textContent = "Recording the selected section in real time…";
    await new Promise((resolve) => {
      const tick = () => {
        const elapsed = Math.max(0, els.video.currentTime - start);
        els.progress.value = Math.min(100, elapsed / (end - start) * 100);
        els.progress.textContent = `${Math.round(els.progress.value)}%`;
        if (cancelled || els.video.currentTime >= end || els.video.ended) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
    els.video.pause();
    if (recorder.state !== "inactive") recorder.stop();
    await finished;
    if (cancelled) { els.progressPanel.hidden = true; return; }
    if (!chunks.length) throw new Error("The browser did not produce any video data.");
    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    els.output.onloadedmetadata = () => {
      if (!Number.isFinite(els.output.duration)) {
        els.output.ontimeupdate = () => {
          els.output.ontimeupdate = null;
          els.output.currentTime = 0;
        };
        els.output.currentTime = 1e101;
      }
    };
    els.output.src = outputUrl;
    els.download.href = outputUrl;
    els.download.download = `${currentFile.name.replace(/\.[^.]+$/, "")}-trimmed.webm`;
    els.progress.value = 100;
    els.progressPanel.hidden = true;
    els.result.hidden = false;
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    els.progressPanel.hidden = true;
    showError(els.editorError, `Couldn’t create the clip: ${error.message}`);
  } finally {
    activeRecorder = null;
    syncRange();
  }
}

els.file.addEventListener("change", () => loadVideo(els.file.files[0]));
for (const event of ["dragenter", "dragover"]) els.drop.addEventListener(event, (e) => { e.preventDefault(); els.drop.classList.add("is-dragging"); });
for (const event of ["dragleave", "drop"]) els.drop.addEventListener(event, (e) => { e.preventDefault(); els.drop.classList.remove("is-dragging"); });
els.drop.addEventListener("drop", (e) => loadVideo(e.dataTransfer.files[0]));
els.startRange.addEventListener("input", () => updateFromRange("start"));
els.endRange.addEventListener("input", () => updateFromRange("end"));
els.startTime.addEventListener("change", () => updateFromTime("start"));
els.endTime.addEventListener("change", () => updateFromTime("end"));
els.setStart.addEventListener("click", () => { els.startTime.value = els.video.currentTime.toFixed(2); updateFromTime("start"); });
els.setEnd.addEventListener("click", () => { els.endTime.value = els.video.currentTime.toFixed(2); updateFromTime("end"); });
els.preview.addEventListener("click", previewSelection);
els.trim.addEventListener("click", createClip);
els.cancel.addEventListener("click", () => { cancelled = true; if (activeRecorder?.state !== "inactive") activeRecorder.stop(); els.video.pause(); });
els.startOver.addEventListener("click", () => { els.result.hidden = true; els.editor.scrollIntoView({ block: "start" }); });
window.addEventListener("beforeunload", () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (outputUrl) URL.revokeObjectURL(outputUrl); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
