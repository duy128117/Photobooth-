export const LAYOUTS = {
  "classic-strip": { label: "Dải cổ điển", count: 3 },
  "landscape-2": { label: "Ngang", count: 2 },
  "k-style-4": { label: "K-Style 4 khung", count: 4 },
  polaroid: { label: "Polaroid", count: 2 },
  postcard: { label: "Bưu thiếp", count: 2 },
  "collage-2x2": { label: "Cắt dán 2x2", count: 4 }
};

const HISTORY_LIMIT = 60;

export function createImageItem(src) {
  return {
    src: src,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0
  };
}

export function createStickerItem(config) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: config.type,
    character: config.character || "",
    src: config.src || "",
    category: config.category || "custom",
    x: 50,
    y: 16,
    scale: 1,
    rotation: 0,
    zIndex: config.zIndex || 5
  };
}

export const photoboothState = createInitialState();
const listeners = [];
const history = {
  undo: [],
  redo: [],
  applying: false
};

export function subscribe(listener) {
  listeners.push(listener);
  return function unsubscribe() {
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

export function updateState(updater, options) {
  const previousSnapshot = getStateSnapshot();
  updater(photoboothState);
  normalizeState();

  if (!history.applying && shouldRecordHistory(previousSnapshot, photoboothState, options)) {
    history.undo.push(previousSnapshot);
    if (history.undo.length > HISTORY_LIMIT) {
      history.undo.shift();
    }
    history.redo = [];
  }

  notify();
}

export function resetState() {
  const previousSnapshot = getStateSnapshot();
  const freshState = createInitialState();
  assignState(freshState);
  if (!history.applying) {
    history.undo.push(previousSnapshot);
    if (history.undo.length > HISTORY_LIMIT) {
      history.undo.shift();
    }
    history.redo = [];
  }
  notify();
}

export function replaceState(nextState, options) {
  const previousSnapshot = getStateSnapshot();
  assignState(nextState);

  if (!history.applying && shouldRecordHistory(previousSnapshot, photoboothState, options)) {
    history.undo.push(previousSnapshot);
    if (history.undo.length > HISTORY_LIMIT) {
      history.undo.shift();
    }
    history.redo = [];
  }

  notify();
}

export function undoState() {
  if (!history.undo.length) {
    return false;
  }

  const currentSnapshot = getStateSnapshot();
  const previousSnapshot = history.undo.pop();
  history.redo.push(currentSnapshot);
  history.applying = true;
  assignState(previousSnapshot);
  history.applying = false;
  notify();
  return true;
}

export function redoState() {
  if (!history.redo.length) {
    return false;
  }

  const currentSnapshot = getStateSnapshot();
  const nextSnapshot = history.redo.pop();
  history.undo.push(currentSnapshot);
  history.applying = true;
  assignState(nextSnapshot);
  history.applying = false;
  notify();
  return true;
}

export function clearHistory() {
  history.undo = [];
  history.redo = [];
  notify();
}

export function getHistoryState() {
  return {
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    undoCount: history.undo.length,
    redoCount: history.redo.length
  };
}

export function getStateSnapshot() {
  return clonePlain(photoboothState);
}

function createInitialState() {
  return {
    projectId: null,
    shareId: "",
    templateId: "",
    eventId: "",
    images: [],
    layout: "classic-strip",
    imageCount: 3,
    background: "#ffffff",
    filter: "none",
    stickers: [],
    selectedStickerId: null,
    stickerCategory: "fun",
    overlays: {
      eventTitle: "",
      name: "",
      quote: "",
      customDate: ""
    },
    showDate: true,
    createdAt: new Date().toISOString(),
    currentSection: "capture",
    exportLoading: false,
    cameraEnabled: true,
    cameraAiMode: "none",
    isPublic: true
  };
}

function assignState(source) {
  const base = createInitialState();
  const merged = {
    ...base,
    ...clonePlain(source)
  };
  merged.overlays = {
    ...base.overlays,
    ...(source && source.overlays ? clonePlain(source.overlays) : {})
  };
  Object.keys(photoboothState).forEach(function (key) {
    delete photoboothState[key];
  });
  Object.keys(merged).forEach(function (key) {
    photoboothState[key] = merged[key];
  });
  normalizeState();
}

function shouldRecordHistory(previousSnapshot, nextState, options) {
  if (options && options.recordHistory === false) {
    return false;
  }
  return JSON.stringify(previousSnapshot) !== JSON.stringify(nextState);
}

function normalizeState() {
  photoboothState.images = photoboothState.images.slice(0, photoboothState.imageCount);
  if (photoboothState.selectedStickerId) {
    const selectedStillExists = photoboothState.stickers.some(function (sticker) {
      return sticker.id === photoboothState.selectedStickerId;
    });
    if (!selectedStillExists) {
      photoboothState.selectedStickerId = null;
    }
  }
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function notify() {
  listeners.forEach(function (listener) {
    listener(photoboothState);
  });
}
