import { createImageItem, photoboothState, updateState } from "./state.js";
import { createAutoCroppedImageItem } from "./auto-crop.js";

let mediaPipeScriptPromise = null;
let faceApiLandmarkPromise = null;
let faceApiLandmarkLoaded = false;
const CAPTURE_COUNTDOWN_SECONDS = 10;
const MIRROR_CAMERA = true;
const FACE_API_MODEL_PATH = "/assets/models/face-api";
const CAPTURE_STICKERS = {
  none: {
    id: "none",
    label: "None",
    icon: "",
    placement: "none"
  },
  glasses: {
    id: "glasses",
    label: "Glasses",
    icon: createStickerIconDataUri("glasses"),
    placement: "eyes"
  },
  bow: {
    id: "bow",
    label: "Bow",
    icon: createStickerIconDataUri("bow"),
    placement: "brow"
  },
  crown: {
    id: "crown",
    label: "Crown",
    icon: createStickerIconDataUri("crown"),
    placement: "top"
  },
  sparkle: {
    id: "sparkle",
    label: "Sparkle",
    icon: createStickerIconDataUri("sparkle"),
    placement: "upper-right"
  },
  heart: {
    id: "heart",
    label: "Heart",
    icon: createStickerIconDataUri("heart"),
    placement: "cheek-right"
  },
  blush: {
    id: "blush",
    label: "Blush",
    icon: createStickerIconDataUri("blush"),
    placement: "cheek-left"
  }
};

export function initializeCamera(elements, showToast) {
  const { video, cameraPreview, captureBtn, countdown, errorMessage, cameraAiButtons, captureStickerButtons } = elements;
  const audio = createCameraAudio();
  const previewContext = cameraPreview.getContext("2d");
  const processingCanvas = document.createElement("canvas");
  const processingContext = processingCanvas.getContext("2d");
  let stream = null;
  let animationFrameId = 0;
  let isCapturing = false;
  let activeCaptureSticker = "";
  let faceDetector = null;
  let faceDetectionBusy = false;
  let lastFaceBounds = null;
  let lastFaceGeometry = null;
  let smoothedFaceGeometry = null;
  let lastFaceDetectionAt = 0;
  let lastFaceSeenAt = 0;

  bindAiButtons();
  bindCaptureStickerButtons();
  preloadCaptureStickerIcons();
  startCamera();

  return {
    resetCaptures: function () {},
    destroy: function () {
      window.cancelAnimationFrame(animationFrameId);
      if (stream) {
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
      }
    }
  };

  function bindAiButtons() {
    Array.from(cameraAiButtons || []).forEach(function (button) {
      button.addEventListener("click", function () {
        const mode = button.getAttribute("data-ai-mode") || "none";
        updateState(function (state) {
          state.cameraAiMode = mode;
        });
        if (mode !== "none") {
          updateState(function (state) {
            state.cameraAiMode = "none";
          });
          showToast("Phông nền ảo chưa được bật trên máy này.");
        }
      });
    });
  }

  function bindCaptureStickerButtons() {
    Array.from(captureStickerButtons || []).forEach(function (button) {
      button.addEventListener("click", function () {
        activeCaptureSticker = normalizeCaptureStickerId(button.getAttribute("data-capture-sticker"));
        updateStickerButtonState();
      });
      const stickerId = normalizeCaptureStickerId(button.getAttribute("data-capture-sticker"));
      const sticker = getCaptureStickerDefinition(stickerId);
      button.innerHTML = [
        sticker.icon ? '<span class="sticker-chip__icon"><img src="' + sticker.icon + '" alt="" /></span>' : '<span class="sticker-chip__icon sticker-chip__icon--none" aria-hidden="true">⊘</span>',
        '<span class="sticker-chip__label">' + sticker.label + '</span>'
      ].join("");
    });
    updateStickerButtonState();
  }

  function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(function (mediaStream) {
        stream = mediaStream;
        video.srcObject = mediaStream;
        errorMessage.style.display = "none";
        video.addEventListener("loadedmetadata", handleVideoReady, { once: true });
        updateState(function (state) {
          state.cameraEnabled = true;
        });
      })
      .catch(function (error) {
        console.error("Error accessing camera:", error);
        reportCameraError("Không thể mở camera", error);
        errorMessage.style.display = "block";
        errorMessage.textContent = "Unable to access camera. Please allow camera permissions in your browser settings and ensure you're using HTTPS.";
        captureBtn.disabled = true;
        updateState(function (state) {
          state.cameraEnabled = false;
        });
      });
  }

  function handleVideoReady() {
    resizeCanvases();
    renderPreview();
  }

  function resizeCanvases() {
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 960;
    cameraPreview.width = width;
    cameraPreview.height = height;
    processingCanvas.width = width;
    processingCanvas.height = height;
  }

  function renderPreview() {
    if (!video.videoWidth || !video.videoHeight) {
      animationFrameId = window.requestAnimationFrame(renderPreview);
      return;
    }

    resizeCanvases();
    maybeDetectFace();

    drawFrame(previewContext, video, cameraPreview.width, cameraPreview.height);
    drawCaptureSticker(previewContext, cameraPreview.width, cameraPreview.height);

    animationFrameId = window.requestAnimationFrame(renderPreview);
  }

  captureBtn.addEventListener("click", function () {
    reportCameraProgress("Đã nhận click nút chụp.");
    if (isCapturing) {
      reportCameraProgress("Đang xử lý một lượt chụp khác.");
      return;
    }

    const currentCaptureIndex = getNextCaptureIndex();

    if (!photoboothState.cameraEnabled) {
      showToast("Camera is unavailable on this device.");
      reportCameraError("Camera chưa sẵn sàng", new Error("Camera is unavailable on this device."));
      return;
    }

    if (currentCaptureIndex === -1) {
      showToast("You already captured enough photos. Open the editor or reset.");
      reportCameraProgress("Đã đầy ảnh, không còn ô trống để chụp.");
      return;
    }

    isCapturing = true;
    captureBtn.textContent = "Starting...";
    reportCameraProgress("Bắt đầu đếm ngược 10 giây...");
    startCountdown(async function () {
      try {
        reportCameraProgress("Đang chụp...");
        audio.playShutter();
        const captureSource = photoboothState.cameraAiMode === "none" ? video : cameraPreview;
        const dataUrl = captureSnapshot(captureSource, activeCaptureSticker, smoothedFaceGeometry || lastFaceGeometry || (lastFaceBounds ? buildGeometryFromBounds(lastFaceBounds) : null));
        const rawImageItem = createImageItem(dataUrl);
        reportCameraProgress("Đang lưu ảnh vào ô " + (currentCaptureIndex + 1) + "...");
        updateState(function (state) {
          state.images[currentCaptureIndex] = rawImageItem;
        });

        try {
          const croppedImageItem = await createAutoCroppedImageItem(dataUrl);
          updateState(function (state) {
            state.images[currentCaptureIndex] = croppedImageItem;
          });
        } catch (error) {
          console.warn("Auto crop failed, keeping raw capture.", error);
        }

        reportCameraSuccess("Đã lưu ảnh vào ô " + (currentCaptureIndex + 1) + ".");
        scrollCaptureGalleryIntoView();

        if (getNextCaptureIndex() === -1) {
          showToast("Capture complete. You can continue in the editor or upload replacements.");
        }
      } catch (error) {
        console.error("Capture failed", error);
        reportCameraError("Chụp ảnh thất bại", error);
        showToast("Unable to save the photo. Please try again.");
      } finally {
        isCapturing = false;
      }
    });
  });

  function startCountdown(onComplete) {
    let timeLeft = CAPTURE_COUNTDOWN_SECONDS;
    captureBtn.disabled = true;
    captureBtn.setAttribute("data-state", "counting");
    countdown.style.display = "flex";
    countdown.textContent = timeLeft;
    audio.playCountdownBeep(timeLeft);

    const countdownInterval = window.setInterval(function () {
      timeLeft -= 1;
      if (timeLeft > 0) {
        countdown.textContent = timeLeft;
        audio.playCountdownBeep(timeLeft);
        reportCameraProgress("Chụp sau " + timeLeft + " giây...");
        return;
      }

      countdown.style.display = "none";
      window.clearInterval(countdownInterval);
      Promise.resolve()
        .then(onComplete)
        .finally(function () {
          captureBtn.disabled = false;
          captureBtn.removeAttribute("data-state");
          captureBtn.textContent = "Capture";
          isCapturing = false;
        });
    }, 1000);
  }

  function getNextCaptureIndex() {
    const firstEmptyIndex = photoboothState.images.findIndex(function (item) {
      return !item || !item.src;
    });

    if (firstEmptyIndex >= 0) {
      return firstEmptyIndex;
    }

    if (photoboothState.images.length < photoboothState.imageCount) {
      return photoboothState.images.length;
    }

    return -1;
  }

  function maybeDetectFace() {
    if (!activeCaptureSticker || faceDetectionBusy || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const now = Date.now();
    if (now - lastFaceDetectionAt < 220) {
      return;
    }

    lastFaceDetectionAt = now;
    faceDetectionBusy = true;
    detectStickerFace(video).then(function (faceGeometry) {
      lastFaceBounds = faceGeometry ? faceGeometry.box : null;
      lastFaceGeometry = faceGeometry;
      if (faceGeometry) {
        smoothedFaceGeometry = smoothFaceGeometry(smoothedFaceGeometry, faceGeometry, 0.24);
        lastFaceSeenAt = Date.now();
      } else if (Date.now() - lastFaceSeenAt > 900) {
        smoothedFaceGeometry = null;
      }
      faceDetectionBusy = false;
      drawCaptureSticker(previewContext, cameraPreview.width, cameraPreview.height);
    }).catch(function (error) {
      console.warn("Face detection unavailable", error);
      lastFaceBounds = null;
      lastFaceGeometry = null;
      faceDetectionBusy = false;
    });
  }

  function drawCaptureSticker(context, width, height) {
    const sticker = getCaptureStickerDefinition(activeCaptureSticker);
    if (!sticker || sticker.id === "none") {
      return;
    }

    const face = smoothedFaceGeometry || lastFaceGeometry || (lastFaceBounds ? buildGeometryFromBounds(lastFaceBounds) : null);
    const placement = getStickerPlacement(sticker, face, width, height);
    const image = ensureStickerImage(sticker.id);
    if (!image || !image.complete || !image.naturalWidth) {
      return;
    }

    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.16)";
    context.shadowBlur = 14;
    context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
    context.restore();
  }

  function updateStickerButtonState() {
    Array.from(captureStickerButtons || []).forEach(function (button) {
      button.classList.toggle("active", normalizeCaptureStickerId(button.getAttribute("data-capture-sticker")) === activeCaptureSticker);
    });
  }

  function reportCameraError(prefix, error) {
    if (typeof window.__photoboothReportError === "function") {
      window.__photoboothReportError(error, { prefix: prefix });
    }
  }

  function reportCameraProgress(message) {
    if (typeof window.__photoboothReportCaptureStatus === "function") {
      window.__photoboothReportCaptureStatus(message, false);
    }
  }

  function reportCameraSuccess(message) {
    if (typeof window.__photoboothReportCaptureStatus === "function") {
      window.__photoboothReportCaptureStatus(message, true);
    }
  }

  function scrollCaptureGalleryIntoView() {
    const gallery = document.getElementById("capture-gallery");
    if (gallery && typeof gallery.scrollIntoView === "function") {
      window.requestAnimationFrame(function () {
        gallery.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }
}

function capturePhoto(sourceCanvas) {
  return sourceCanvas.toDataURL("image/png");
}

function captureSnapshot(sourceCanvas, sticker, faceGeometry) {
  const canvas = document.createElement("canvas");
  const width = sourceCanvas.videoWidth || sourceCanvas.width;
  const height = sourceCanvas.videoHeight || sourceCanvas.height;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  drawFrame(context, sourceCanvas, width, height);

  const stickerDef = getCaptureStickerDefinition(sticker);
  if (stickerDef && stickerDef.id !== "none") {
    const placement = getStickerPlacement(stickerDef, faceGeometry, width, height);
    const image = ensureStickerImage(stickerDef.id);
    if (image && image.complete && image.naturalWidth) {
      context.save();
      context.shadowColor = "rgba(0, 0, 0, 0.16)";
      context.shadowBlur = 14;
      context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
      context.restore();
    }
  }

  return canvas.toDataURL("image/png");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCaptureStickerId(value) {
  if (!value || value === "none") {
    return "";
  }
  return value;
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function smoothFaceGeometry(current, next, amount) {
  if (!current) {
    return cloneFaceGeometry(next);
  }

  return {
    box: smoothBox(current.box, next.box, amount),
    eyeCenter: smoothPoint(current.eyeCenter, next.eyeCenter, amount),
    leftEye: smoothPoint(current.leftEye, next.leftEye, amount),
    rightEye: smoothPoint(current.rightEye, next.rightEye, amount),
    browCenter: smoothPoint(current.browCenter, next.browCenter, amount),
    mouthCenter: smoothPoint(current.mouthCenter, next.mouthCenter, amount),
    noseCenter: smoothPoint(current.noseCenter, next.noseCenter, amount),
    chinCenter: smoothPoint(current.chinCenter, next.chinCenter, amount),
    eyeDistance: lerp(current.eyeDistance, next.eyeDistance, amount)
  };
}

function smoothBox(current, next, amount) {
  return {
    x: lerp(current.x, next.x, amount),
    y: lerp(current.y, next.y, amount),
    width: lerp(current.width, next.width, amount),
    height: lerp(current.height, next.height, amount)
  };
}

function smoothPoint(current, next, amount) {
  return {
    x: lerp(current.x, next.x, amount),
    y: lerp(current.y, next.y, amount)
  };
}

function cloneFaceGeometry(faceGeometry) {
  return {
    box: {
      x: faceGeometry.box.x,
      y: faceGeometry.box.y,
      width: faceGeometry.box.width,
      height: faceGeometry.box.height
    },
    eyeCenter: { x: faceGeometry.eyeCenter.x, y: faceGeometry.eyeCenter.y },
    leftEye: { x: faceGeometry.leftEye.x, y: faceGeometry.leftEye.y },
    rightEye: { x: faceGeometry.rightEye.x, y: faceGeometry.rightEye.y },
    browCenter: { x: faceGeometry.browCenter.x, y: faceGeometry.browCenter.y },
    mouthCenter: { x: faceGeometry.mouthCenter.x, y: faceGeometry.mouthCenter.y },
    noseCenter: { x: faceGeometry.noseCenter.x, y: faceGeometry.noseCenter.y },
    chinCenter: { x: faceGeometry.chinCenter.x, y: faceGeometry.chinCenter.y },
    eyeDistance: faceGeometry.eyeDistance
  };
}

function getCaptureStickerDefinition(stickerId) {
  return CAPTURE_STICKERS[stickerId] || CAPTURE_STICKERS.none;
}

function getStickerPlacement(sticker, faceGeometry, width, height) {
  const face = faceGeometry || null;
  const fallbackWidth = Math.min(width, height) * 0.32;
  const box = face ? face.box : null;
  const faceWidth = box ? box.width : fallbackWidth;
  const faceHeight = box ? box.height : fallbackWidth * 1.15;
  const centerX = face ? face.eyeCenter.x : width / 2;
  const displayX = MIRROR_CAMERA ? (width - centerX) : centerX;
  const placementMode = sticker.placement || "center";
  const stickerScale = face ? 1 : 0.92;
  const sizeBase = face ? faceWidth : fallbackWidth;

  if (placementMode === "eyes" && face) {
    const widthSize = clamp(face.eyeDistance * 2.35, 110, 280);
    return {
      x: Math.round(displayX - widthSize / 2),
      y: Math.round(face.eyeCenter.y - widthSize * 0.18),
      width: Math.round(widthSize),
      height: Math.round(widthSize * 0.42)
    };
  }

  if (placementMode === "top" && face) {
    const crownWidth = clamp(faceWidth * 1.02, 140, 320);
    return {
      x: Math.round(displayX - crownWidth / 2),
      y: Math.round(box.y - faceHeight * 0.32),
      width: Math.round(crownWidth),
      height: Math.round(crownWidth * 0.46)
    };
  }

  if (placementMode === "brow" && face) {
    const bowWidth = clamp(faceWidth * 0.78, 96, 220);
    return {
      x: Math.round(displayX - bowWidth / 2),
      y: Math.round(face.browCenter.y - faceHeight * 0.18),
      width: Math.round(bowWidth),
      height: Math.round(bowWidth * 0.6)
    };
  }

  if ((placementMode === "cheek-right" || placementMode === "cheek-left") && face) {
    const cheekWidth = clamp(faceWidth * 0.34, 72, 140);
    const side = placementMode === "cheek-right" ? 1 : -1;
    const cheekCenterX = face.eyeCenter.x + side * faceWidth * 0.28;
    return {
      x: Math.round((MIRROR_CAMERA ? width - cheekCenterX : cheekCenterX) - cheekWidth / 2),
      y: Math.round(face.mouthCenter.y - faceHeight * 0.18),
      width: Math.round(cheekWidth),
      height: Math.round(cheekWidth)
    };
  }

  if (placementMode === "upper-right" && face) {
    const sparkleSize = clamp(faceWidth * 0.4, 70, 150);
    return {
      x: Math.round(displayX + faceWidth * 0.23),
      y: Math.round(face.browCenter.y - faceHeight * 0.32),
      width: Math.round(sparkleSize),
      height: Math.round(sparkleSize)
    };
  }

  const defaultSize = clamp(sizeBase * (face ? 0.72 : 0.56) * stickerScale, 80, face ? 220 : 160);
  return {
    x: Math.round(displayX - defaultSize / 2),
    y: Math.round((face ? face.box.y + face.box.height * 0.52 : height * 0.48) - defaultSize / 2),
    width: Math.round(defaultSize),
    height: Math.round(defaultSize)
  };
}

function ensureStickerImage(stickerId) {
  const sticker = getCaptureStickerDefinition(stickerId);
  if (!sticker || !sticker.icon) {
    return null;
  }

  if (!stickerImageCache.has(stickerId)) {
    const image = new Image();
    image.decoding = "async";
    image.src = sticker.icon;
    stickerImageCache.set(stickerId, image);
  }

  return stickerImageCache.get(stickerId) || null;
}

function preloadCaptureStickerIcons() {
  Object.keys(CAPTURE_STICKERS).forEach(function (key) {
    if (key !== "none") {
      ensureStickerImage(key);
    }
  });
}

async function detectStickerFace(source) {
  const landmarkFace = await detectWithFaceApiLandmarks(source);
  if (landmarkFace) {
    return landmarkFace;
  }

  const nativeFace = await detectWithNativeFaceDetector(source);
  if (nativeFace) {
    return nativeFace;
  }

  return null;
}

async function detectWithNativeFaceDetector(source) {
  if (!window.FaceDetector) {
    return null;
  }

  try {
    if (!faceDetector) {
      faceDetector = new window.FaceDetector({
        fastMode: true,
        maxDetectedFaces: 1
      });
    }

    const faces = await faceDetector.detect(source);
    if (!faces.length) {
      return null;
    }

    return buildGeometryFromBounds(faces[0].boundingBox);
  } catch (error) {
    console.warn("Native FaceDetector failed", error);
    return null;
  }
}

async function detectWithFaceApiLandmarks(source) {
  try {
    const faceapi = await loadFaceApiLandmarks();
    if (!faceapi) {
      return null;
    }

    const detection = await faceapi.detectSingleFace(
      source,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 224,
        scoreThreshold: 0.4
      })
    ).withFaceLandmarks(true);

    if (!detection || !detection.detection || !detection.landmarks) {
      return null;
    }

    return buildGeometryFromFaceApiResult(detection);
  } catch (error) {
    console.warn("face-api landmark detection unavailable", error);
    return null;
  }
}

function buildGeometryFromBounds(box) {
  const width = box.width;
  const height = box.height;
  const x = box.x;
  const y = box.y;
  const eyeCenter = {
    x: x + width / 2,
    y: y + height * 0.4
  };
  const leftEye = {
    x: x + width * 0.36,
    y: y + height * 0.39
  };
  const rightEye = {
    x: x + width * 0.64,
    y: y + height * 0.39
  };
  const browCenter = {
    x: x + width / 2,
    y: y + height * 0.2
  };
  const mouthCenter = {
    x: x + width / 2,
    y: y + height * 0.73
  };
  const noseCenter = {
    x: x + width / 2,
    y: y + height * 0.56
  };
  const chinCenter = {
    x: x + width / 2,
    y: y + height * 0.94
  };

  return {
    box: { x: x, y: y, width: width, height: height },
    eyeCenter: eyeCenter,
    leftEye: leftEye,
    rightEye: rightEye,
    browCenter: browCenter,
    mouthCenter: mouthCenter,
    noseCenter: noseCenter,
    chinCenter: chinCenter,
    eyeDistance: pointDistance(leftEye, rightEye)
  };
}

function buildGeometryFromFaceApiResult(detection) {
  const box = detection.detection.box;
  const landmarks = detection.landmarks;
  const leftEye = averagePoints(landmarks.getLeftEye());
  const rightEye = averagePoints(landmarks.getRightEye());
  const browLeft = averagePoints(landmarks.getLeftEyeBrow());
  const browRight = averagePoints(landmarks.getRightEyeBrow());
  const mouthCenter = averagePoints(landmarks.getMouth());
  const noseCenter = averagePoints(landmarks.getNose());
  const jaw = landmarks.getJawOutline();
  const chinCenter = jaw && jaw.length ? jaw[Math.floor(jaw.length / 2)] : {
    x: box.x + box.width / 2,
    y: box.y + box.height
  };
  const eyeCenter = averagePoints([leftEye, rightEye]);
  const browCenter = averagePoints([browLeft, browRight]);

  return {
    box: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height
    },
    eyeCenter: eyeCenter,
    leftEye: leftEye,
    rightEye: rightEye,
    browCenter: browCenter,
    mouthCenter: mouthCenter,
    noseCenter: noseCenter,
    chinCenter: chinCenter,
    eyeDistance: pointDistance(leftEye, rightEye)
  };
}

function averagePoints(points) {
  if (!points || !points.length) {
    return { x: 0, y: 0 };
  }

  const total = points.reduce(function (sum, point) {
    return {
      x: sum.x + point.x,
      y: sum.y + point.y
    };
  }, { x: 0, y: 0 });

  return {
    x: total.x / points.length,
    y: total.y / points.length
  };
}

function pointDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

async function loadFaceApiLandmarks() {
  if (faceApiLandmarkPromise) {
    return faceApiLandmarkPromise;
  }

  faceApiLandmarkPromise = (async function () {
    const tinyFaceDetectorManifest = await hasModelManifest("tiny_face_detector_model-weights_manifest.json");
    const tinyLandmarkManifest = await hasModelManifest("face_landmark_68_tiny_model-weights_manifest.json");
    const fullLandmarkManifest = !tinyLandmarkManifest && await hasModelManifest("face_landmark_68_model-weights_manifest.json");

    if (!tinyFaceDetectorManifest || (!tinyLandmarkManifest && !fullLandmarkManifest)) {
      return null;
    }

    const faceapi = await import("/node_modules/face-api.js/build/es6/index.js");
    if (!faceApiLandmarkLoaded) {
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_PATH);
      if (tinyLandmarkManifest) {
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_API_MODEL_PATH);
      } else {
        await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_MODEL_PATH);
      }
      faceApiLandmarkLoaded = true;
    }
    return faceapi;
  })();

  return faceApiLandmarkPromise;
}

async function hasModelManifest(fileName) {
  try {
    const response = await fetch(`${FACE_API_MODEL_PATH}/${fileName}`, { method: "HEAD" });
    return response.ok;
  } catch (error) {
    return false;
  }
}

function createStickerIconDataUri(type) {
  const svg = createStickerIconSvg(type);
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function createStickerIconSvg(type) {
  switch (type) {
    case "glasses":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><defs><linearGradient id="g" x1="0" y1="0" x2="128" y2="128"><stop stop-color="#10131b"/><stop offset="1" stop-color="#2b3447"/></linearGradient></defs><rect x="14" y="52" width="30" height="18" rx="9" stroke="url(#g)" stroke-width="8"/><rect x="84" y="52" width="30" height="18" rx="9" stroke="url(#g)" stroke-width="8"/><path d="M44 60h40" stroke="url(#g)" stroke-width="8" stroke-linecap="round"/><circle cx="29" cy="61" r="5" fill="#7ec7ff"/><circle cx="99" cy="61" r="5" fill="#ffb48f"/></svg>';
    case "bow":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><circle cx="64" cy="64" r="9" fill="#ff8d62"/><path d="M59 63 27 40c-7 16-2 32 12 40l20-17Z" fill="#ff9cc4"/><path d="M69 63 101 40c7 16 2 32-12 40L69 63Z" fill="#ff9cc4"/><path d="M60 60c-4-14-1-23 6-28 8 5 11 14 7 28" stroke="#f05a87" stroke-width="6" stroke-linecap="round"/></svg>';
    case "crown":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><path d="M18 88 28 42l24 23 12-34 16 34 20-24 10 47H18Z" fill="#ffd34f" stroke="#e4a527" stroke-width="6" stroke-linejoin="round"/><path d="M24 88h80" stroke="#e4a527" stroke-width="6" stroke-linecap="round"/><circle cx="28" cy="42" r="5" fill="#7ec7ff"/><circle cx="64" cy="31" r="6" fill="#ff8d62"/><circle cx="100" cy="50" r="5" fill="#ff9cc4"/></svg>';
    case "sparkle":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><path d="M64 16 73 50l34 14-34 14-9 34-9-34-34-14 34-14 9-34Z" fill="#ffd58a" stroke="#ff9d71" stroke-width="6" stroke-linejoin="round"/><path d="M30 18 35 32l14 5-14 5-5 14-5-14-14-5 14-5 5-14Z" fill="#7ec7ff" stroke="#4ea1ff" stroke-width="4" stroke-linejoin="round"/><path d="M94 82 99 96l14 5-14 5-5 14-5-14-14-5 14-5 5-14Z" fill="#ff9cc4" stroke="#ff7ba8" stroke-width="4" stroke-linejoin="round"/></svg>';
    case "heart":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><path d="M64 108 24 68c-12-12-12-31 0-43 11-11 29-11 40 0l0 0 0 0c11-11 29-11 40 0 12 12 12 31 0 43L64 108Z" fill="#ff8aa6" stroke="#e85a7a" stroke-width="6" stroke-linejoin="round"/><path d="M64 28c8-10 25-8 32 2" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.55"/></svg>';
    case "blush":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><circle cx="40" cy="70" r="18" fill="#ff9bb4" opacity="0.78"/><circle cx="88" cy="70" r="18" fill="#ff9bb4" opacity="0.78"/><path d="M49 92c9 9 21 9 30 0" stroke="#ff7b9b" stroke-width="6" stroke-linecap="round"/><path d="M47 38c9-9 25-9 34 0" stroke="#ffd58a" stroke-width="8" stroke-linecap="round"/></svg>';
    default:
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><circle cx="64" cy="64" r="44" stroke="#9aa7b8" stroke-width="10" stroke-dasharray="10 12"/><path d="M46 64h36" stroke="#9aa7b8" stroke-width="10" stroke-linecap="round"/></svg>';
  }
}

function loadMediaPipeScript() {
  if (window.SelfieSegmentation) {
    return Promise.resolve();
  }

  if (mediaPipeScriptPromise) {
    return mediaPipeScriptPromise;
  }

  mediaPipeScriptPromise = new Promise(function (resolve, reject) {
    const script = document.createElement("script");
    script.src = "/node_modules/@mediapipe/selfie_segmentation/selfie_segmentation.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return mediaPipeScriptPromise;
}

function createCameraAudio() {
  let audioContext = null;

  return {
    playCountdownBeep: function (step) {
      const context = getContext();
      if (!context) {
        return;
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 720 + step * 60;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
    },
    playShutter: function () {
      const context = getContext();
      if (!context) {
        return;
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(1200, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(220, context.currentTime + 0.08);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.1);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
    }
  };

  function getContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    return audioContext;
  }
}

function drawFrame(context, source, width, height) {
  context.save();
  context.clearRect(0, 0, width, height);

  if (MIRROR_CAMERA) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }

  context.drawImage(source, 0, 0, width, height);
  context.restore();
}

const stickerImageCache = new Map();
