import { describe, expect, it, vi } from 'vitest';
import {
  CAMERA_STATES,
  getCameraConstraints,
  getFriendlyCameraError,
  getMediaPipeStatus,
  stopMediaStream,
  waitForVideoReady
} from './cameraLifecycle.js';

describe('camera lifecycle helpers', () => {
  it('returns front-facing constraints by default', () => {
    const constraints = getCameraConstraints(true);
    expect(constraints.audio).toBe(false);
    expect(constraints.video.facingMode).toEqual({ ideal: 'user' });
  });

  it('returns environment-facing constraints when requested', () => {
    const constraints = getCameraConstraints(false);
    expect(constraints.video.facingMode).toEqual({ ideal: 'environment' });
  });

  it('maps blocked permissions to a clear user-friendly message', () => {
    const error = new DOMException('Permission denied', 'NotAllowedError');
    expect(getFriendlyCameraError(error)).toContain('Camera permission was denied');
  });

  it('returns a missing camera message when no device is available', () => {
    const error = new DOMException('No camera found', 'NotFoundError');
    expect(getFriendlyCameraError(error)).toContain('No usable camera was found');
  });

  it('stops every media stream track when told to stop', () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
      getVideoTracks: () => [],
      getAudioTracks: () => []
    };

    stopMediaStream(stream);

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('resolves when the video element has metadata', async () => {
    const video = {
      readyState: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    await expect(waitForVideoReady(video, 500)).resolves.toBe(video);
  });

  it('reports MediaPipe availability correctly', () => {
    const fakeWindow = { Hands: {}, Pose: {} };
    expect(getMediaPipeStatus(fakeWindow)).toMatchObject({ ready: true, hands: true, pose: true });
  });

  it('contains the allowed camera lifecycle states', () => {
    expect(Object.values(CAMERA_STATES)).toEqual([
      'idle',
      'requesting_permission',
      'initializing',
      'active',
      'stopping',
      'error'
    ]);
  });
});
