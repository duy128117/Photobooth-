import { createImageItem, photoboothState, updateState } from "./state.js";
import { createAutoCroppedImageItem } from "./auto-crop.js";

let mediaPipeScriptPromise = null;
let faceApiLandmarkPromise = null;
let faceApiLandmarkLoaded = false;
let nativeFaceDetector = null;
const stickerImageCache = new Map();
let sharedSubjectCanvas = null;
let sharedSubjectContext = null;
let sharedSegmentationMask = null;
let sharedAiMode = "none";
const CAPTURE_COUNTDOWN_SECONDS = 3;
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
  "flower-crown": {
    id: "flower-crown",
    label: "Flower Crown",
    icon: createStickerIconDataUri("flower-crown"),
    placement: "top-wide",
    scaleMul: 1.06,
    offsetY: -0.08
  },
  "bunny-ears": {
    id: "bunny-ears",
    label: "Bunny Ears",
    icon: createStickerIconDataUri("bunny-ears"),
    placement: "top-wide",
    scaleMul: 1.12,
    offsetY: -0.22
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
    placement: "cheeks",
    scaleMul: 0.9
  },
  mustache: {
    id: "mustache",
    label: "Mustache",
    icon: createStickerIconDataUri("mustache"),
    placement: "mouth",
    scaleMul: 0.82
  },
  "star-glasses": {
    id: "star-glasses",
    label: "Star Glasses",
    icon: createStickerIconDataUri("star-glasses"),
    placement: "eyes",
    scaleMul: 1.08
  },
  halo: {
    id: "halo",
    label: "Halo",
    icon: createStickerIconDataUri("halo"),
    placement: "top",
    scaleMul: 0.94,
    offsetY: -0.26
  }
};

export function initializeCamera(elements, showToast) {
  const { video, cameraPreview, captureBtn, countdown, errorMessage, cameraAiButtons, captureStickerButtons, suggestCaptureStickerBtn } = elements;
  const audio = createCameraAudio();
  const previewContext = cameraPreview.getContext("2d");
  const processingCanvas = document.createElement("canvas");
  const processingContext = processingCanvas.getContext("2d");
  const subjectCanvas = document.createElement("canvas");
  const subjectContext = subjectCanvas.getContext("2d");
  sharedSubjectCanvas = subjectCanvas;
  sharedSubjectContext = subjectContext;
  let stream = null;
  let animationFrameId = 0;
  let isCapturing = false;
  let activeCaptureSticker = "";
  let selfieSegmentation = null;
  let segmentationBusy = false;
  let segmentationReady = false;
  let latestSegmentationMask = null;
  let faceDetectionBusy = false;
  let lastFaceBounds = null;
  let lastFaceGeometry = null;
  let smoothedFaceGeometry = null;
  let lastFaceDetectionAt = 0;
  let lastFaceSeenAt = 0;
  let cameraReadyTimeoutId = 0;
  let cameraStartupInProgress = false;

  video.playsInline = true;

  bindAiButtons();
  bindCaptureStickerButtons();
  bindSuggestionButton();
  preloadCaptureStickerIcons();
  captureBtn.disabled = false;
  captureBtn.removeAttribute("disabled");
  captureBtn.textContent = "Mở camera";
  reportCameraProgress("Dang khoi dong camera...");
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
      button.addEventListener("click", async function () {
        const mode = button.getAttribute("data-ai-mode") || "none";
        if (mode !== "none") {
          try {
            await ensureSelfieSegmentation();
          } catch (error) {
            reportCameraError("Khong the bat phong nen AI", error);
            showToast("Khong the bat phong nen AI tren may nay.");
            return;
          }
        }
        updateState(function (state) {
          state.cameraAiMode = mode;
        });
        showToast(mode === "none" ? "Da tat phong nen AI." : "Da bat phong nen AI.");
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
        sticker.icon ? '<span class="sticker-chip__icon"><img src="' + sticker.icon + '" alt="" /></span>' : '<span class="sticker-chip__icon sticker-chip__icon--none" aria-hidden="true">x</span>',
        '<span class="sticker-chip__label">' + sticker.label + '</span>'
      ].join("");
    });
    updateStickerButtonState();
  }

  function bindSuggestionButton() {
    if (!suggestCaptureStickerBtn) {
      return;
    }
    suggestCaptureStickerBtn.addEventListener("click", function () {
      const suggestion = suggestBestCaptureSticker();
      activeCaptureSticker = suggestion;
      updateStickerButtonState();
      const sticker = getCaptureStickerDefinition(suggestion);
      if (sticker && sticker.id !== "none") {
        showToast("AI goi y: " + sticker.label);
        reportCameraProgress("AI goi y sticker: " + sticker.label);
      } else {
        showToast("AI chua tim duoc sticker phu hop.");
      }
    });
  }

  function startCamera() {
    if (cameraStartupInProgress) {
      return;
    }

    cameraStartupInProgress = true;
    captureBtn.disabled = false;
    captureBtn.removeAttribute("disabled");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraInlineError("Trinh duyet khong ho tro camera.");
      captureBtn.textContent = "Mở camera lại";
      updateState(function (state) {
        state.cameraEnabled = false;
      });
      reportCameraError("Trinh duyet khong ho tro camera", new Error("getUserMedia is not supported."));
      cameraStartupInProgress = false;
      return;
    }

    captureBtn.textContent = "Đang mở camera...";
    updateState(function (state) {
      state.cameraEnabled = false;
    });
    reportCameraProgress("Dang xin quyen camera...");

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(function (mediaStream) {
        stream = mediaStream;
        video.srcObject = mediaStream;
        reportCameraProgress("Da ket noi camera. Dang cho video san sang...");

        Promise.resolve()
          .then(function () {
            return video.play();
          })
          .catch(function (error) {
            console.warn("Video play failed:", error);
          })
          .finally(function () {
            let hasActivatedCamera = false;
            const activateCamera = function () {
              if (hasActivatedCamera) {
                return;
              }
              hasActivatedCamera = true;
              window.clearTimeout(cameraReadyTimeoutId);
              errorMessage.style.display = "none";
              handleVideoReady();
              updateState(function (state) {
                state.cameraEnabled = true;
              });
              captureBtn.removeAttribute("disabled");
              captureBtn.textContent = "Chup";
              cameraStartupInProgress = false;
              reportCameraProgress("Camera da san sang.");
            };

            if (video.readyState >= 1 && video.videoWidth > 0) {
              activateCamera();
            } else {
              video.addEventListener("loadedmetadata", activateCamera, { once: true });
              video.addEventListener("loadeddata", activateCamera, { once: true });
              video.addEventListener("canplay", activateCamera, { once: true });
              cameraReadyTimeoutId = window.setTimeout(function () {
                if (video.readyState >= 1 && video.videoWidth > 0) {
                  activateCamera();
                  return;
                }
                showCameraInlineError("Camera da duoc cap quyen nhung video chua san sang. Hay thu tai lai trang.");
                reportCameraError("Video chua san sang", new Error("Camera stream started but metadata was not loaded."));
                cameraStartupInProgress = false;
                captureBtn.textContent = "Mở camera lại";
              }, 8000);
            }
          });
      })
      .catch(function (error) {
        console.error("Error accessing camera:", error);
        reportCameraError("Khong the mo camera", error);
        showCameraInlineError("Khong the mo camera. Hay cap quyen camera va chay bang localhost hoac HTTPS.");
        captureBtn.disabled = false;
        captureBtn.removeAttribute("disabled");
        captureBtn.textContent = "Mở camera lại";
        updateState(function (state) {
          state.cameraEnabled = false;
        });
        cameraStartupInProgress = false;
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
    subjectCanvas.width = width;
    subjectCanvas.height = height;
  }

  function renderPreview() {
    if (!video.videoWidth || !video.videoHeight) {
      animationFrameId = window.requestAnimationFrame(renderPreview);
      return;
    }

    resizeCanvases();
    maybeDetectFace();
    sharedAiMode = photoboothState.cameraAiMode || "none";
    maybeRunSegmentation();
    drawFrame(previewContext, video, cameraPreview.width, cameraPreview.height);
    drawCaptureSticker(previewContext, cameraPreview.width, cameraPreview.height);

    animationFrameId = window.requestAnimationFrame(renderPreview);
  }

  captureBtn.addEventListener("pointerdown", function () {
    reportCameraProgress("Dang nhan nut chup...");
  });
  captureBtn.addEventListener("click", handleCaptureClick);

  function handleCaptureClick(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    captureBtn.textContent = "Da nhan";
    reportCameraProgress("Da nhan click nut chup.");
    if (isCapturing) {
      reportCameraProgress("Dang xu ly mot luot chup khac.");
      return;
    }

    if (!photoboothState.cameraEnabled) {
      if (!cameraStartupInProgress) {
        showToast("Camera chua san sang. Dang thu mo lai...");
        reportCameraProgress("Camera chua san sang, dang thu mo lai.");
        startCamera();
      } else {
        showToast("Camera dang khoi dong. Vui long cho mot chut.");
        reportCameraProgress("Camera dang khoi dong, vui long cho.");
      }
      captureBtn.textContent = cameraStartupInProgress ? "Đang mở camera..." : "Mở camera lại";
      return;
    }

    const currentCaptureIndex = getNextCaptureIndex();

    if (currentCaptureIndex === -1) {
      captureBtn.textContent = "Da day";
      showToast("Da chup du anh. Hay mo editor hoac reset.");
      reportCameraProgress("Da day anh, khong con o trong de chup.");
      return;
    }

    isCapturing = true;
    captureBtn.textContent = "Dang chuan bi...";
    reportCameraProgress("Bat dau dem nguoc 3 giay...");
    startCountdown(async function () {
      try {
        reportCameraProgress("Dang chup...");
        audio.playShutter();
        const captureSource = cameraPreview;
        const faceGeometry = smoothedFaceGeometry || lastFaceGeometry || (lastFaceBounds ? buildGeometryFromBounds(lastFaceBounds) : null);
        const dataUrl = captureSnapshot(captureSource, activeCaptureSticker, faceGeometry);
        const rawImageItem = createImageItem(dataUrl);
        rawImageItem.faceGeometry = faceGeometry;
        reportCameraProgress("Dang luu anh vao o " + (currentCaptureIndex + 1) + "...");
        updateState(function (state) {
          state.images[currentCaptureIndex] = rawImageItem;
        });

        try {
          const croppedImageItem = await createAutoCroppedImageItem(dataUrl);
          if (faceGeometry && !croppedImageItem.faceGeometry) {
            croppedImageItem.faceGeometry = faceGeometry;
          }
          updateState(function (state) {
            state.images[currentCaptureIndex] = croppedImageItem;
          });
        } catch (error) {
          console.warn("Auto crop failed, keeping raw capture.", error);
        }

        reportCameraSuccess("Da luu anh vao o " + (currentCaptureIndex + 1) + ".");
        scrollCaptureGalleryIntoView();

        if (getNextCaptureIndex() === -1) {
          showToast("Chup xong. Ban co the vao editor hoac tai anh thay the.");
        }
      } catch (error) {
        console.error("Capture failed", error);
        reportCameraError("Chup anh that bai", error);
        showToast("Khong the luu anh. Hay thu lai.");
      }
    });
  }

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
        reportCameraProgress("Chup sau " + timeLeft + " giay...");
        return;
      }

      countdown.style.display = "none";
      window.clearInterval(countdownInterval);
      Promise.resolve()
        .then(onComplete)
        .finally(function () {
          captureBtn.disabled = false;
          captureBtn.removeAttribute("data-state");
          captureBtn.textContent = "Chup";
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

  async function ensureSelfieSegmentation() {
    if (segmentationReady && selfieSegmentation) {
      return selfieSegmentation;
    }

    await loadMediaPipeScript();
    if (!window.SelfieSegmentation) {
      throw new Error("SelfieSegmentation is unavailable.");
    }

    if (!selfieSegmentation) {
      selfieSegmentation = new window.SelfieSegmentation({
        locateFile: function (file) {
          return "/node_modules/@mediapipe/selfie_segmentation/" + file;
        }
      });
      selfieSegmentation.setOptions({
        modelSelection: 1
      });
      selfieSegmentation.onResults(function (results) {
        latestSegmentationMask = results && results.segmentationMask ? results.segmentationMask : null;
        sharedSegmentationMask = latestSegmentationMask;
        segmentationBusy = false;
      });
    }

    segmentationReady = true;
    return selfieSegmentation;
  }

  function maybeRunSegmentation() {
    if (photoboothState.cameraAiMode === "none" || !segmentationReady || !selfieSegmentation || segmentationBusy) {
      return;
    }
    segmentationBusy = true;
    selfieSegmentation.send({ image: video }).catch(function (error) {
      segmentationBusy = false;
      console.warn("Segmentation failed", error);
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

  function suggestBestCaptureSticker() {
    const face = smoothedFaceGeometry || lastFaceGeometry || (lastFaceBounds ? buildGeometryFromBounds(lastFaceBounds) : null);
    const suggestions = ["glasses", "flower-crown", "sparkle", "heart", "bunny-ears", "halo"];

    if (!face || !video.videoWidth || !video.videoHeight) {
      return suggestions[Math.floor(Math.random() * suggestions.length)];
    }

    const faceRatio = face.box.width / Math.max(face.box.height, 1);
    const eyeRatio = face.eyeDistance / Math.max(face.box.width, 1);
    const faceSizeRatio = face.box.width / video.videoWidth;
    const centerRatioX = face.eyeCenter.x / video.videoWidth;

    if (faceSizeRatio < 0.18) {
      return "halo";
    }
    if (eyeRatio > 0.34 || faceRatio > 0.78) {
      return "star-glasses";
    }
    if (faceRatio < 0.66) {
      return "flower-crown";
    }
    if (centerRatioX < 0.32 || centerRatioX > 0.68) {
      return "sparkle";
    }
    if (face.box.y < video.videoHeight * 0.18) {
      return "bunny-ears";
    }
    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  function reportCameraError(prefix, error) {
    if (typeof window.__photoboothReportCaptureStatus === "function") {
      const message = error && error.message ? prefix + ": " + error.message : prefix;
      window.__photoboothReportCaptureStatus(message, false);
    }
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

  function showCameraInlineError(message) {
    if (errorMessage) {
      errorMessage.style.display = "block";
      errorMessage.textContent = message;
    }
    reportCameraProgress(message);
  }
}

function capturePhoto(sourceCanvas) {
  return sourceCanvas.toDataURL("image/png");
}

function captureSnapshot(sourceCanvas, sticker, faceGeometry) {
  const canvas = document.createElement("canvas");
  const width = sourceCanvas.width || sourceCanvas.videoWidth || 1280;
  const height = sourceCanvas.height || sourceCanvas.videoHeight || 960;
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
  const stickerScale = (face ? 1 : 0.92) * (sticker.scaleMul || 1);
  const sizeBase = face ? faceWidth : fallbackWidth;
  const offsetY = sticker.offsetY || 0;

  if (placementMode === "eyes" && face) {
    const widthSize = clamp(face.eyeDistance * 2.35, 110, 280);
    return {
      x: Math.round(displayX - widthSize / 2),
      y: Math.round(face.eyeCenter.y - widthSize * (0.18 - offsetY)),
      width: Math.round(widthSize),
      height: Math.round(widthSize * 0.42)
    };
  }

  if (placementMode === "top" && face) {
    const crownWidth = clamp(faceWidth * 1.02 * stickerScale, 140, 340);
    return {
      x: Math.round(displayX - crownWidth / 2),
      y: Math.round(box.y - faceHeight * (0.32 - offsetY)),
      width: Math.round(crownWidth),
      height: Math.round(crownWidth * 0.46)
    };
  }

  if (placementMode === "top-wide" && face) {
    const widthSize = clamp(faceWidth * 1.2 * stickerScale, 150, 360);
    return {
      x: Math.round(displayX - widthSize / 2),
      y: Math.round(box.y - faceHeight * (0.24 - offsetY)),
      width: Math.round(widthSize),
      height: Math.round(widthSize * 0.56)
    };
  }

  if (placementMode === "brow" && face) {
    const bowWidth = clamp(faceWidth * 0.78 * stickerScale, 96, 240);
    return {
      x: Math.round(displayX - bowWidth / 2),
      y: Math.round(face.browCenter.y - faceHeight * (0.18 - offsetY)),
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

  if (placementMode === "cheeks" && face) {
    const widthSize = clamp(faceWidth * 0.82 * stickerScale, 110, 280);
    return {
      x: Math.round(displayX - widthSize / 2),
      y: Math.round(face.mouthCenter.y - widthSize * (0.06 - offsetY)),
      width: Math.round(widthSize),
      height: Math.round(widthSize * 0.42)
    };
  }

  if (placementMode === "upper-right" && face) {
    const sparkleSize = clamp(faceWidth * 0.4 * stickerScale, 70, 160);
    return {
      x: Math.round(displayX + faceWidth * 0.23),
      y: Math.round(face.browCenter.y - faceHeight * (0.32 - offsetY)),
      width: Math.round(sparkleSize),
      height: Math.round(sparkleSize)
    };
  }

  if (placementMode === "mouth" && face) {
    const widthSize = clamp(faceWidth * 0.58 * stickerScale, 84, 220);
    return {
      x: Math.round(displayX - widthSize / 2),
      y: Math.round(face.mouthCenter.y - widthSize * (0.18 - offsetY)),
      width: Math.round(widthSize),
      height: Math.round(widthSize * 0.34)
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

  const segmentationFace = detectWithSegmentationMask(source);
  if (segmentationFace) {
    return segmentationFace;
  }

  return null;
}

function detectWithSegmentationMask(source) {
  if (!sharedSegmentationMask) {
    return null;
  }

  const width = source.videoWidth || source.width || 0;
  const height = source.videoHeight || source.height || 0;
  if (!width || !height) {
    return null;
  }

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = width;
  sampleCanvas.height = height;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  sampleContext.drawImage(sharedSegmentationMask, 0, 0, width, height);
  const imageData = sampleContext.getImageData(0, 0, width, Math.max(1, Math.floor(height * 0.58))).data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hitCount = 0;
  const sampleHeight = Math.max(1, Math.floor(height * 0.58));

  for (let y = 0; y < sampleHeight; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const index = (y * width + x) * 4;
      const alpha = imageData[index + 3];
      if (alpha < 96) {
        continue;
      }
      hitCount += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (hitCount < 24 || minX >= maxX || minY >= maxY) {
    return null;
  }

  const personWidth = maxX - minX;
  const personHeight = maxY - minY;
  const faceWidth = Math.max(70, personWidth * 0.46);
  const faceHeight = Math.max(80, personHeight * 0.42);
  const faceX = minX + (personWidth - faceWidth) / 2;
  const faceY = minY + personHeight * 0.04;

  return buildGeometryFromBounds({
    x: faceX,
    y: faceY,
    width: faceWidth,
    height: faceHeight
  });
}

async function detectWithNativeFaceDetector(source) {
  if (!window.FaceDetector) {
    return null;
  }

  try {
    if (!nativeFaceDetector) {
      nativeFaceDetector = new window.FaceDetector({
        fastMode: true,
        maxDetectedFaces: 1
      });
    }

    const faces = await nativeFaceDetector.detect(source);
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
    case "flower-crown":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><path d="M18 72c12-21 29-31 46-31 17 0 34 10 46 31" stroke="#7ab77b" stroke-width="8" stroke-linecap="round"/><circle cx="28" cy="69" r="10" fill="#ff8fb1"/><circle cx="48" cy="55" r="10" fill="#ffd166"/><circle cx="64" cy="50" r="10" fill="#7ec7ff"/><circle cx="82" cy="55" r="10" fill="#c792ea"/><circle cx="101" cy="69" r="10" fill="#ff9f68"/><circle cx="64" cy="64" r="7" fill="#fff5ce"/></svg>';
    case "bunny-ears":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><ellipse cx="42" cy="38" rx="14" ry="32" transform="rotate(-16 42 38)" fill="#fff6fb" stroke="#f2b7d6" stroke-width="6"/><ellipse cx="86" cy="38" rx="14" ry="32" transform="rotate(16 86 38)" fill="#fff6fb" stroke="#f2b7d6" stroke-width="6"/><ellipse cx="42" cy="38" rx="6" ry="20" transform="rotate(-16 42 38)" fill="#ffc4dc"/><ellipse cx="86" cy="38" rx="6" ry="20" transform="rotate(16 86 38)" fill="#ffc4dc"/><path d="M28 74c10-13 22-20 36-20s26 7 36 20" stroke="#fff6fb" stroke-width="8" stroke-linecap="round"/></svg>';
    case "heart":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><path d="M64 108 24 68c-12-12-12-31 0-43 11-11 29-11 40 0l0 0 0 0c11-11 29-11 40 0 12 12 12 31 0 43L64 108Z" fill="#ff8aa6" stroke="#e85a7a" stroke-width="6" stroke-linejoin="round"/><path d="M64 28c8-10 25-8 32 2" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.55"/></svg>';
    case "blush":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><circle cx="40" cy="70" r="18" fill="#ff9bb4" opacity="0.78"/><circle cx="88" cy="70" r="18" fill="#ff9bb4" opacity="0.78"/><path d="M49 92c9 9 21 9 30 0" stroke="#ff7b9b" stroke-width="6" stroke-linecap="round"/><path d="M47 38c9-9 25-9 34 0" stroke="#ffd58a" stroke-width="8" stroke-linecap="round"/></svg>';
    case "mustache":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><path d="M18 66c10-16 24-18 37-9 4 3 7 8 9 14 2-6 5-11 9-14 13-9 27-7 37 9-8 14-18 21-31 21-7 0-12-3-15-8-3 5-8 8-15 8-13 0-23-7-31-21Z" fill="#3b2a22"/></svg>';
    case "star-glasses":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><path d="m33 49 6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2 6-12Z" fill="#ffd45e" stroke="#ec9d24" stroke-width="5" stroke-linejoin="round"/><path d="m95 49 6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2 6-12Z" fill="#7ec7ff" stroke="#327bda" stroke-width="5" stroke-linejoin="round"/><path d="M46 64h36" stroke="#2b3447" stroke-width="7" stroke-linecap="round"/></svg>';
    case "halo":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><ellipse cx="64" cy="26" rx="34" ry="11" fill="#ffe8a8" stroke="#f5ba4f" stroke-width="6"/><ellipse cx="64" cy="26" rx="18" ry="4" fill="rgba(255,255,255,0.55)"/></svg>';
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
  const aiMode = sharedAiMode || "none";
  context.save();
  context.clearRect(0, 0, width, height);

  if (aiMode === "none" || !sharedSegmentationMask || !sharedSubjectCanvas || !sharedSubjectContext) {
    drawSourceLayer(context, source, width, height, 0);
    context.restore();
    return;
  }

  drawBackgroundLayer(context, source, width, height, aiMode);
  sharedSubjectContext.clearRect(0, 0, width, height);
  drawSourceLayer(sharedSubjectContext, sharedSegmentationMask, width, height, 0);
  sharedSubjectContext.globalCompositeOperation = "source-in";
  drawSourceLayer(sharedSubjectContext, source, width, height, 0);
  sharedSubjectContext.globalCompositeOperation = "source-over";
  context.drawImage(sharedSubjectCanvas, 0, 0, width, height);
  context.restore();
}

function drawSourceLayer(context, source, width, height, blurAmount) {
  context.save();
  if (blurAmount > 0) {
    context.filter = "blur(" + blurAmount + "px) saturate(1.05)";
  }
  if (MIRROR_CAMERA) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, 0, 0, width, height);
  context.restore();
}

function drawBackgroundLayer(context, source, width, height, mode) {
  if (mode === "blur") {
    drawSourceLayer(context, source, width, height, 18);
    context.save();
    context.fillStyle = "rgba(20, 22, 30, 0.18)";
    context.fillRect(0, 0, width, height);
    context.restore();
    return;
  }

  if (mode === "sky") {
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#8fd4ff");
    sky.addColorStop(0.55, "#dff4ff");
    sky.addColorStop(1, "#fff7f0");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    context.save();
    context.globalAlpha = 0.22;
    drawSourceLayer(context, source, width, height, 16);
    context.restore();
    return;
  }

  if (mode === "studio") {
    const studio = context.createRadialGradient(width * 0.5, height * 0.24, 20, width * 0.5, height * 0.5, width * 0.9);
    studio.addColorStop(0, "#f7f2ed");
    studio.addColorStop(0.42, "#d7d8df");
    studio.addColorStop(1, "#8f96a8");
    context.fillStyle = studio;
    context.fillRect(0, 0, width, height);
    context.save();
    context.globalAlpha = 0.16;
    drawSourceLayer(context, source, width, height, 12);
    context.restore();
    return;
  }

  drawSourceLayer(context, source, width, height, 0);
}


