// Removes black bars built into a video while it is fullscreen. The picture
// keeps its shape and is never cut: only rows and columns that were black in
// every sampled frame end up off screen.

const SAMPLE_WIDTH = 480;
const BRIGHT_LEVEL = 24;
const BRIGHT_SHARE = 0.02;
const MIN_BAR = 0.01;
const SAMPLES_BEFORE_ZOOM = 3;
const SAMPLE_MS = 500;
const BOTTOM_CUE_POSITION = 0.92;

let enabled = true;
let active = null;
let timer = null;

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", { willReadFrequently: true });

browser.storage.local.get({ enabled: true }).then((stored) => {
  enabled = stored.enabled;
  update();
});

browser.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    enabled = changes.enabled.newValue;
    update();
  }
});

function newState(video) {
  return {
    video,
    src: video.currentSrc,
    shape: video.videoWidth / video.videoHeight,
    lastTime: -1,
    samples: 0,
    // Fraction of each side that has been black in every sample so far
    barX: 0.5,
    barY: 0.5,
    savedStyles: new Map(),
    cues: new Map(),
  };
}

function fullscreenRoot() {
  let element = document.fullscreenElement;
  while (element && element.shadowRoot && element.shadowRoot.fullscreenElement) {
    element = element.shadowRoot.fullscreenElement;
  }
  return element;
}

function videosIn(root) {
  const found = root instanceof HTMLVideoElement ? [root] : [];
  const scopes = [root];
  if (root.shadowRoot) scopes.push(root.shadowRoot);
  for (const scope of scopes) {
    for (const element of scope.querySelectorAll("*")) {
      if (element instanceof HTMLVideoElement) found.push(element);
      if (element.shadowRoot) found.push(...videosIn(element.shadowRoot));
    }
  }
  return found;
}

function largestVideo(root) {
  let best = null;
  let bestArea = 0;
  for (const video of videosIn(root)) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = video;
      bestArea = area;
    }
  }
  return best;
}

function isBright(data, offset) {
  return (data[offset] * 2 + data[offset + 1] * 5 + data[offset + 2]) / 8 > BRIGHT_LEVEL;
}

// Measures the black border of one frame. Returns null for frames that say
// nothing: unreadable ones (other origin or DRM) and all-dark ones.
function measureFrame(video) {
  const width = SAMPLE_WIDTH;
  const height = Math.max(2, Math.round((width * video.videoHeight) / video.videoWidth));
  canvas.width = width;
  canvas.height = height;
  let data;
  try {
    context.drawImage(video, 0, 0, width, height);
    data = context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }

  const rowCounts = new Uint32Array(height);
  const columnCounts = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBright(data, (y * width + x) * 4)) {
        rowCounts[y]++;
        columnCounts[x]++;
      }
    }
  }

  // Real bars match on opposite sides, so the smaller side wins. A dark sky
  // at the top of a scene can then never pass for a bar.
  const edge = (counts, needed) => {
    const length = counts.length;
    let start = 0;
    while (start < length && counts[start] < needed) start++;
    if (start === length) return null;
    let end = 0;
    while (counts[length - 1 - end] < needed) end++;
    return Math.min(start, end) / length;
  };
  const barY = edge(rowCounts, width * BRIGHT_SHARE);
  const barX = edge(columnCounts, height * BRIGHT_SHARE);
  if (barY === null || barX === null) return null;
  return { barX, barY };
}

function clearCues(state) {
  for (const [cue, saved] of state.cues) {
    cue.snapToLines = saved.snapToLines;
    cue.line = saved.line;
    cue.lineAlign = saved.lineAlign;
  }
  state.cues.clear();
}

function clearZoom(state) {
  // Only the properties set here: sites like YouTube keep the video's size in
  // its inline style, and restoring all of it would bring back a stale size
  const { style } = state.video;
  for (const [name, saved] of state.savedStyles) {
    if (saved.value) style.setProperty(name, saved.value, saved.priority);
    else style.removeProperty(name);
  }
  state.savedStyles.clear();
  clearCues(state);
}

function setStyle(state, name, value) {
  const { style } = state.video;
  if (!state.savedStyles.has(name)) {
    state.savedStyles.set(name, {
      value: style.getPropertyValue(name),
      priority: style.getPropertyPriority(name),
    });
  }
  style.setProperty(name, value, "important");
}

// Zooming pushes the bottom of the frame off screen, along with cues placed
// there. Lays them out against the part of the frame that stays visible.
function moveCues(state, visibleBottom) {
  for (const track of state.video.textTracks) {
    if (track.mode !== "showing" || !track.cues) continue;
    for (const cue of track.cues) {
      if (!(cue instanceof VTTCue) || cue.line !== "auto" || state.cues.has(cue)) continue;
      state.cues.set(cue, {
        snapToLines: cue.snapToLines,
        line: cue.line,
        lineAlign: cue.lineAlign,
      });
      cue.snapToLines = false;
      cue.lineAlign = "end";
      cue.line = visibleBottom * 100;
    }
  }
}

function applyZoom(state, root) {
  const { video, barX, barY } = state;
  const pictureWidth = video.videoWidth * (1 - 2 * barX);
  const pictureHeight = video.videoHeight * (1 - 2 * barY);
  if (barX < MIN_BAR && barY < MIN_BAR) {
    clearZoom(state);
    return;
  }

  // Not the root's rect: YouTube fullscreens <html>, whose rect is the page
  const screen = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  if (root === video) {
    // Firefox ignores transforms on a fullscreen <video>. object-fit cover
    // is the only zoom left, and it is safe only if no picture overflows.
    const cover = Math.max(screen.width / video.videoWidth, screen.height / video.videoHeight);
    const fit = Math.min(screen.width / pictureWidth, screen.height / pictureHeight);
    if (cover <= fit * 1.01) setStyle(state, "object-fit", "cover");
    else clearZoom(state);
    return;
  }

  const box = {
    width: video.offsetWidth,
    height: video.offsetHeight,
  };
  const drawn = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  const scale = Math.min(
    screen.width / (pictureWidth * drawn),
    screen.height / (pictureHeight * drawn)
  );
  if (scale <= 1) return;

  const current = state.savedStyles.has("transform") ? video.style.transform : null;
  video.style.removeProperty("transform");
  const rect = video.getBoundingClientRect();
  if (current) video.style.setProperty("transform", current, "important");
  const moveX = screen.left + screen.width / 2 - (rect.left + rect.width / 2);
  const moveY = screen.top + screen.height / 2 - (rect.top + rect.height / 2);
  setStyle(state, "transform", `translate(${moveX}px, ${moveY}px) scale(${scale})`);

  const visibleHeight = screen.height / (drawn * video.videoHeight * scale);
  moveCues(state, 0.5 + visibleHeight * (BOTTOM_CUE_POSITION - 0.5));
}

function sample() {
  if (!active) return;
  const { video } = active;
  const root = fullscreenRoot();
  if (!root || !video.videoWidth) return;

  // A new shape means new content, such as an ad ending on the same element
  const shape = video.videoWidth / video.videoHeight;
  if (active.src !== video.currentSrc || Math.abs(shape / active.shape - 1) > 0.01) {
    clearZoom(active);
    active = newState(video);
  }

  if (!video.paused && video.currentTime !== active.lastTime) {
    active.lastTime = video.currentTime;
    const frame = measureFrame(video);
    if (frame) {
      active.barX = Math.min(active.barX, frame.barX);
      active.barY = Math.min(active.barY, frame.barY);
      active.samples++;
    }
  }
  if (active.samples >= SAMPLES_BEFORE_ZOOM) applyZoom(active, root);
}

function update() {
  const root = enabled ? fullscreenRoot() : null;
  const video = root ? largestVideo(root) : null;
  if (active && active.video !== video) {
    clearZoom(active);
    active = null;
  }
  if (!video) {
    if (active) clearZoom(active);
    active = null;
    clearInterval(timer);
    timer = null;
    return;
  }
  if (!active) active = newState(video);
  if (!timer) timer = setInterval(sample, SAMPLE_MS);
  sample();
}

document.addEventListener("fullscreenchange", () => {
  // The fullscreen layout settles a moment after the event, but the zoom has
  // to go at once on exit
  if (document.fullscreenElement) setTimeout(update, 200);
  else update();
});
window.addEventListener("resize", () => {
  if (active) sample();
});
