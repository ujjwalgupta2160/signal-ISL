# Uni-Sign — Indian Sign Language Recognition & Speech

Uni-Sign is a Vite + React application that turns hand gestures and sign-language cues into text and speech. It is designed for Indian Sign Language (ISL) workflows and includes a live camera preview, temporal gesture tracking, a vocabulary reference panel, and speech synthesis support.

## Features

- Live webcam capture with camera permission handling and retry paths
- MediaPipe Hands and Pose-based landmark detection
- Rule-based sign recognition and phrase detection
- Sign input modes for phrases, alphabet, and numbers
- Detected text output and recent-sign history
- Speech playback and session tracking
- Dark, cyan-accented interface with professional dashboard styling

## Tech stack

- React 19
- Vite 8
- MediaPipe Hands / Pose
- Lucide icons
- canvas-confetti
- Vitest for utility tests

## Repository layout

- `src/App.jsx` — app shell and session orchestration
- `src/components/` — UI panels for camera, text output, speech, settings, and session history
- `src/utils/signClassifier.js` — sign recognition rules and normalization logic
- `src/utils/uniSignEngine.js` — sequence aggregator and gesture processing helpers
- `src/utils/uniSignSpeechConverter.js` — speech synthesis integration
- `public/` — static assets

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open the local Vite URL shown in the terminal.

## Production build

```bash
npm run build
```

## Quality checks

```bash
npm run test
npm run lint
```

## Camera usage notes

- Camera access requires an HTTPS origin or localhost.
- The app requests video-only access and does not require microphone permission.
- MediaPipe assets are loaded from the jsDelivr CDN; if those resources fail to load, the UI surfaces a clear recognition-unavailable message instead of pretending the model is active.
- If a camera is denied, unavailable, or locked by another app, the start flow surfaces an actionable error and allows retry.

## Notes

This project keeps a rule-based recognition engine as its working baseline and exposes a clean path for later integration of a trained model or more advanced recognition pipeline without misrepresenting the current implementation as a neural-network model that is not actually present.

