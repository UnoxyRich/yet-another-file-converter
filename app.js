const fileInput = document.querySelector("#fileInput");
const dropzone = document.querySelector("#dropzone");
const formatSelect = document.querySelector("#formatSelect");
const engineSelect = document.querySelector("#engineSelect");
const convertBtn = document.querySelector("#convertBtn");
const downloadBtn = document.querySelector("#downloadBtn");
const logEl = document.querySelector("#log");
const progressWrap = document.querySelector("#progressWrap");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");

const IMAGE_FORMATS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"];
const AUDIO_FORMATS = ["mp3", "wav", "ogg", "aac", "flac", "m4a"];
const VIDEO_FORMATS = ["mp4", "webm", "mov", "mkv", "avi", "gif"];

const EXT_TO_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo"
};

let selectedFile = null;
let ffmpeg = null;
let ffmpegLoaded = false;
let imagemagickLoaded = false;
let magickApi = null;

function log(message) {
  logEl.textContent = message;
}

function setProgress(value, message) {
  progressWrap.classList.remove("hidden");
  progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  progressText.textContent = message;
}

function resetOutput() {
  if (downloadBtn.href) {
    URL.revokeObjectURL(downloadBtn.href);
  }
  downloadBtn.removeAttribute("href");
  downloadBtn.classList.add("hidden");
}

function extensionFromName(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

function categoryForFile(file) {
  if (!file) {
    return "unknown";
  }
  const mime = file.type || "";
  const ext = extensionFromName(file.name);
  if (mime.startsWith("image/") || IMAGE_FORMATS.includes(ext)) {
    return "image";
  }
  if (mime.startsWith("audio/") || AUDIO_FORMATS.includes(ext)) {
    return "audio";
  }
  if (mime.startsWith("video/") || VIDEO_FORMATS.includes(ext)) {
    return "video";
  }
  return "unknown";
}

function outputFormatsFor(file) {
  const category = categoryForFile(file);
  if (category === "image") {
    return IMAGE_FORMATS;
  }
  if (category === "audio") {
    return AUDIO_FORMATS;
  }
  if (category === "video") {
    return VIDEO_FORMATS;
  }
  return ["png", "jpg", "mp4", "mp3"];
}

function updateFormatOptions(file) {
  const formats = outputFormatsFor(file);
  formatSelect.innerHTML = formats
    .map((format) => `<option value="${format}">${format.toUpperCase()}</option>`)
    .join("");
}

async function ensureFfmpeg() {
  if (ffmpegLoaded) {
    return;
  }

  if (!window.FFmpegWASM || !window.FFmpegUtil) {
    throw new Error("FFmpeg scripts failed to load.");
  }

  const { FFmpeg } = window.FFmpegWASM;
  const { toBlobURL } = window.FFmpegUtil;
  ffmpeg = new FFmpeg();

  ffmpeg.on("progress", ({ progress }) => {
    const percent = Math.round((progress || 0) * 100);
    setProgress(percent, `FFmpeg running: ${percent}%`);
  });

  const coreSources = [
    "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd",
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd"
  ];

  setProgress(5, "Loading FFmpeg core...");

  let lastError = null;
  for (const baseURL of coreSources) {
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript")
      });

      ffmpegLoaded = true;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to load FFmpeg WebAssembly core. ${lastError?.message || "Unknown error."}`);
}

async function ensureImagemagick() {
  if (imagemagickLoaded) {
    return;
  }
  setProgress(5, "Loading ImageMagick core...");
  magickApi = await import("https://knicknic.github.io/wasm-imagemagick/magickApi.js");
  imagemagickLoaded = true;
}

function chooseEngine(file, outputExt) {
  const selected = engineSelect.value;
  if (selected !== "auto") {
    return selected;
  }
  const category = categoryForFile(file);
  if (category === "image") {
    return "imagemagick";
  }
  if (category === "audio" || category === "video") {
    return "ffmpeg";
  }
  if (outputExt === "png" || outputExt === "jpg" || outputExt === "webp") {
    return "imagemagick";
  }
  return "ffmpeg";
}

function outputName(file, outputExt) {
  const base = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
  return `${base}.${outputExt}`;
}

async function convertWithFfmpeg(file, outName) {
  await ensureFfmpeg();
  const { fetchFile } = window.FFmpegUtil;

  const inName = file.name;
  setProgress(10, "Reading input file...");
  await ffmpeg.writeFile(inName, await fetchFile(file));

  setProgress(18, "Converting with FFmpeg...");
  await ffmpeg.exec(["-i", inName, outName]);

  const data = await ffmpeg.readFile(outName);
  try {
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
  } catch (_) {
  }
  return data;
}

async function convertWithImagemagick(file, outName) {
  await ensureImagemagick();

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const command = ["convert", file.name, outName];
  setProgress(18, "Converting with ImageMagick...");

  const result = await magickApi.Call([{ name: file.name, content: sourceBytes }], command);
  const processedFiles = Array.isArray(result) ? result : result?.processedFiles || [];
  const exitCode = Array.isArray(result) ? 0 : (result?.exitCode ?? 0);
  const stderr = result?.stderr || [];

  if (exitCode !== 0) {
    throw new Error(stderr.join("\n") || "ImageMagick conversion failed.");
  }

  const match = processedFiles.find((item) => item.name === outName) || processedFiles[0];
  if (!match) {
    throw new Error("No output file from ImageMagick.");
  }

  if (match.content instanceof Uint8Array) {
    return match.content;
  }
  if (match.blob) {
    return new Uint8Array(await match.blob.arrayBuffer());
  }

  throw new Error("Unsupported ImageMagick output payload.");
}

async function runConversion() {
  if (!selectedFile) {
    return;
  }

  resetOutput();
  convertBtn.disabled = true;
  const outExt = formatSelect.value;
  const outName = outputName(selectedFile, outExt);

  try {
    const engine = chooseEngine(selectedFile, outExt);
    log(`Input: ${selectedFile.name}\nOutput: ${outName}\nEngine: ${engine}`);

    const resultBytes = engine === "imagemagick"
      ? await convertWithImagemagick(selectedFile, outName)
      : await convertWithFfmpeg(selectedFile, outName);

    setProgress(100, "Done");

    const blob = new Blob([resultBytes], { type: EXT_TO_MIME[outExt] || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    downloadBtn.href = url;
    downloadBtn.download = outName;
    downloadBtn.classList.remove("hidden");
    downloadBtn.textContent = `Download ${outName}`;
    log(`${logEl.textContent}\nStatus: Success (${Math.round(blob.size / 1024)} KB)`);
  } catch (error) {
    log(`${logEl.textContent}\nError: ${error?.message || String(error)}`);
    progressWrap.classList.add("hidden");
  } finally {
    convertBtn.disabled = false;
  }
}

function setFile(file) {
  selectedFile = file;
  resetOutput();
  progressWrap.classList.add("hidden");
  updateFormatOptions(file);

  if (!file) {
    convertBtn.disabled = true;
    log("Select a file to start.");
    return;
  }

  convertBtn.disabled = false;
  log(`Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`);
}

fileInput.addEventListener("change", () => {
  setFile(fileInput.files?.[0] || null);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === "drop") {
      const file = event.dataTransfer?.files?.[0] || null;
      if (file) {
        fileInput.files = event.dataTransfer.files;
      }
      setFile(file);
    }
    dropzone.classList.remove("drag-over");
  });
});

convertBtn.addEventListener("click", runConversion);
updateFormatOptions(null);
