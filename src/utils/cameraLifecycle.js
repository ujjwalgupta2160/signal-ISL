export const CAMERA_STATES = {
  IDLE: 'idle',
  REQUESTING_PERMISSION: 'requesting_permission',
  INITIALIZING: 'initializing',
  ACTIVE: 'active',
  STOPPING: 'stopping',
  ERROR: 'error'
};

export function hasCameraApi() {
  return typeof navigator !== 'undefined'
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

export function getCameraConstraints(preferFrontFacing = true) {
  const idealFacingMode = preferFrontFacing ? 'user' : 'environment';
  return {
    video: {
      width: { ideal: 1280, min: 640 },
      height: { ideal: 720, min: 480 },
      facingMode: { ideal: idealFacingMode }
    },
    audio: false
  };
}

export function stopMediaStream(stream) {
  if (!stream) return;

  const tracks = typeof stream.getTracks === 'function' ? stream.getTracks() : [];
  tracks.forEach((track) => {
    if (track && typeof track.stop === 'function') {
      track.stop();
    }
  });

  if (typeof stream.getVideoTracks === 'function') {
    stream.getVideoTracks().forEach((track) => track.stop());
  }

  if (typeof stream.getAudioTracks === 'function') {
    stream.getAudioTracks().forEach((track) => track.stop());
  }
}

export function waitForVideoReady(video, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    if (!video) {
      reject(new Error('Video element is not available.'));
      return;
    }

    if (video.readyState >= 2) {
      resolve(video);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Camera video did not initialize in time.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('loadedmetadata', onReady);
    };

    const onReady = () => {
      if (video.readyState >= 2) {
        cleanup();
        resolve(video);
      }
    };

    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('loadedmetadata', onReady, { once: true });
  });
}

export function getFriendlyCameraError(error, fallbackMessage = 'Could not access the camera.') {
  if (!error) return fallbackMessage;

  const name = error.name || error.message || String(error);
  const message = error.message || String(error);

  if (name === 'NotAllowedError' || message.includes('Permission denied') || message.includes('denied')) {
    return 'Camera permission was denied. Please allow access to your webcam and try again.';
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError' || message.includes('No camera') || message.includes('device')) {
    return 'No usable camera was found. Please connect a webcam or switch to an available device.';
  }

  if (name === 'NotReadableError' || message.includes('busy') || message.includes('in use')) {
    return 'The camera is busy or could not be read. Close other apps using it and try again.';
  }

  if (name === 'SecurityError' || message.includes('insecure')) {
    return 'Camera access is unavailable in this context. Use a secure origin (localhost or HTTPS) and try again.';
  }

  return message || fallbackMessage;
}

export function getMediaPipeStatus(win = globalThis.window) {
  if (!win) {
    return { ready: false, hands: false, pose: false, drawing: false };
  }

  const ready = Boolean(win.Hands && win.Pose);

  return {
    ready,
    hands: Boolean(win.Hands),
    pose: Boolean(win.Pose),
    drawing: Boolean(win.drawConnectors && win.drawLandmarks)
  };
}
