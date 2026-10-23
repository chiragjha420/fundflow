'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, RefreshCw, SwitchCamera, AlertCircle } from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File, previewUrl: string) => void;
  title?: string;
  defaultFacingMode?: 'user' | 'environment';
}

/**
 * 1-Tap In-App Camera Viewfinder for FundFlow
 * 
 * Bypasses heavy native Android/iOS camera apps completely:
 * - Stays inside the browser so Android never kills the tab (no low-memory crashes).
 * - No annoying "OK / Retry" review screens: 1 tap on the shutter captures & saves immediately.
 * - Streams at lightweight 640x640 and crops directly to a 480x480 square avatar (~25KB).
 * - Automatically disposes of media stream tracks upon capture or close.
 */
export function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
  title = 'Take Worker Photo',
  defaultFacingMode = 'environment',
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(defaultFacingMode);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  // Stop camera tracks helper
  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Start camera stream
  const startCamera = async (mode: 'user' | 'environment') => {
    stopStream();
    setError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported on this browser or connection.');
      }

      // Try preferred facing mode with lightweight resolution
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 640 },
            height: { ideal: 640 },
          },
          audio: false,
        });
      } catch (e) {
        // Fallback to any available video stream
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        setCameraActive(true);
      }
    } catch (err: any) {
      console.warn('Camera error:', err);
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please allow camera access in browser settings.'
          : err?.message || 'Unable to open camera.'
      );
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFacingMode(defaultFacingMode);
      startCamera(defaultFacingMode);
    } else {
      stopStream();
    }

    return () => {
      stopStream();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && cameraActive) {
      startCamera(facingMode);
    }
  }, [facingMode]);

  // 1-Tap instant capture (no "OK / Retry" dialogs)
  const handleCapture = () => {
    if (!videoRef.current || !cameraActive) return;

    try {
      const video = videoRef.current;
      const naturalWidth = video.videoWidth || 640;
      const naturalHeight = video.videoHeight || 480;

      // Crop to a square centered on the video stream
      const size = Math.min(naturalWidth, naturalHeight);
      const startX = (naturalWidth - size) / 2;
      const startY = (naturalHeight - size) / 2;

      // Output size: max 480x480 for ultra-crisp yet tiny avatar (~25KB)
      const targetSize = Math.min(size, 480);

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      // Flip horizontally if front-facing for natural mirror feel
      if (facingMode === 'user') {
        ctx.translate(targetSize, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, startX, startY, size, size, 0, 0, targetSize, targetSize);

      canvas.toBlob(
        (blob) => {
          // Immediately free canvas memory
          canvas.width = 0;
          canvas.height = 0;

          if (blob) {
            const file = new File([blob], `worker-${Date.now()}.jpg`, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            const previewUrl = URL.createObjectURL(blob);

            // Immediately stop camera hardware
            stopStream();

            // Emit captured photo and close modal
            onCapture(file, previewUrl);
            onClose();
          }
        },
        'image/jpeg',
        0.75
      );
    } catch (e: any) {
      console.error('Frame capture exception:', e);
    }
  };

  const handleFlipCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col text-white">
        {/* Header */}
        <div className="p-3.5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 min-h-[36px] min-w-[36px] flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Live Viewfinder */}
        <div className="relative bg-black aspect-square w-full overflow-hidden flex items-center justify-center">
          {error ? (
            <div className="p-6 text-center space-y-2">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
              <p className="text-xs text-red-300 font-semibold">{error}</p>
              <p className="text-[11px] text-slate-400">
                You can also tap "Choose from Gallery" on the form.
              </p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
              />

              {/* Avatar circle guide */}
              <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-white/30 rounded-full m-8" />

              {!cameraActive && (
                <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
                  <span className="text-xs text-slate-300">Opening camera...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* 1-Tap Shutter Bar */}
        <div className="p-4 bg-slate-900 flex items-center justify-around border-t border-slate-800">
          {/* Flip Camera */}
          <button
            type="button"
            onClick={handleFlipCamera}
            disabled={!cameraActive}
            className="flex flex-col items-center gap-1 text-slate-400 hover:text-white disabled:opacity-30 p-2 min-h-[44px] min-w-[44px]"
            title="Switch front/back camera"
          >
            <SwitchCamera className="h-5 w-5" />
            <span className="text-[10px] font-semibold">Flip</span>
          </button>

          {/* 1-Tap Shutter Button */}
          <button
            type="button"
            onClick={handleCapture}
            disabled={!cameraActive}
            className="h-16 w-16 rounded-full border-4 border-white bg-emerald-500 hover:bg-emerald-400 active:scale-95 disabled:opacity-40 transition-transform shadow-lg flex items-center justify-center"
            title="Click Photo"
          >
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
              <Camera className="h-6 w-6 text-white" />
            </div>
          </button>

          {/* Cancel */}
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="flex flex-col items-center gap-1 text-slate-400 hover:text-white p-2 min-h-[44px] min-w-[44px]"
          >
            <X className="h-5 w-5" />
            <span className="text-[10px] font-semibold">Cancel</span>
          </button>
        </div>
      </div>
    </div>
  );
}
