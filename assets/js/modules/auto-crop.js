import { createImageItem } from "./state.js";

const FACE_API_MODEL_PATH = "/assets/models/face-api";
let faceApiModulePromise = null;
let tinyModelLoaded = false;

export async function createAutoCroppedImageItem(src) {
  const image = await loadImage(src);
  const faceBounds = await detectFaceBounds(image);
  const imageItem = createImageItem(src);

  if (!faceBounds) {
    return imageItem;
  }

  const faceCenterX = (faceBounds.x + faceBounds.width / 2) / image.width;
  const faceCenterY = (faceBounds.y + faceBounds.height / 2) / image.height;
  const targetCenterX = 0.5;
  const targetCenterY = 0.4;
  const faceWidthRatio = faceBounds.width / image.width;
  const faceHeightRatio = faceBounds.height / image.height;
  const desiredFaceRatio = 0.34;
  const zoom = clamp(
    Math.max(desiredFaceRatio / Math.max(faceWidthRatio, 0.01), desiredFaceRatio / Math.max(faceHeightRatio, 0.01)),
    1,
    2.4
  );

  imageItem.zoom = zoom;
  imageItem.offsetX = clamp((targetCenterX - faceCenterX) * 100, -22, 22);
  imageItem.offsetY = clamp((targetCenterY - faceCenterY) * 100, -24, 24);
  return imageItem;
}

async function detectFaceBounds(image) {
  const nativeBounds = await detectWithNativeApi(image);
  if (nativeBounds) {
    return nativeBounds;
  }

  const faceApiBounds = await detectWithFaceApi(image);
  if (faceApiBounds) {
    return faceApiBounds;
  }

  return null;
}

async function detectWithNativeApi(image) {
  if (!("FaceDetector" in window)) {
    return null;
  }

  try {
    const detector = new window.FaceDetector({
      fastMode: true,
      maxDetectedFaces: 1
    });
    const faces = await detector.detect(image);
    if (!faces.length) {
      return null;
    }
    const box = faces[0].boundingBox;
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height
    };
  } catch (error) {
    console.warn("Native FaceDetector failed", error);
    return null;
  }
}

async function detectWithFaceApi(image) {
  try {
    const faceapi = await loadFaceApi();
    if (!faceapi) {
      return null;
    }

    const detection = await faceapi.detectSingleFace(
      image,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 224,
        scoreThreshold: 0.4
      })
    );

    if (!detection || !detection.box) {
      return null;
    }

    return {
      x: detection.box.x,
      y: detection.box.y,
      width: detection.box.width,
      height: detection.box.height
    };
  } catch (error) {
    console.warn("face-api detection unavailable", error);
    return null;
  }
}

async function loadFaceApi() {
  if (faceApiModulePromise) {
    return faceApiModulePromise;
  }

  faceApiModulePromise = (async function () {
    const manifestExists = await fetch(`${FACE_API_MODEL_PATH}/tiny_face_detector_model-weights_manifest.json`, {
      method: "HEAD"
    }).then(function (response) {
      return response.ok;
    }).catch(function () {
      return false;
    });

    if (!manifestExists) {
      return null;
    }

    const faceapi = await import("/node_modules/face-api.js/build/es6/index.js");
    if (!tinyModelLoaded) {
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_PATH);
      tinyModelLoaded = true;
    }
    return faceapi;
  })();

  return faceApiModulePromise;
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.onload = function () {
      resolve(image);
    };
    image.onerror = reject;
    image.src = src;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
