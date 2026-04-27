Place Tiny Face Detector model files in this folder to enable face-api.js auto-crop.

Expected files:
- tiny_face_detector_model-weights_manifest.json
- tiny_face_detector_model-shard1

To enable sticker face landmarks, also add:
- face_landmark_68_tiny_model-weights_manifest.json
- face_landmark_68_tiny_model-shard1

If these files are not present, Photobooth falls back to the browser FaceDetector API.
