import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Play, Square, Radio, Waves, Sparkles } from 'lucide-react';
import { uniSignSpeechConverter } from '../utils/uniSignSpeechConverter';

export default function NaturalSpeechCard({
  detectedText,
  autoSpeak,
  setAutoSpeak,
  onSpeechCompleted
}) {
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const updateVoices = () => {
      const avail = uniSignSpeechConverter.getVoices();
      setVoices(avail);
      if (avail.length > 0 && !selectedVoiceURI) {
        // Try to find a nice expressive voice like Aria, Guy, Jenny, Google, or default
        const preferred = avail.find(v => v.name.includes('Aria') || v.name.includes('Jenny') || v.name.includes('Natural') || v.lang.startsWith('en')) || avail[0];
        setSelectedVoiceURI(preferred.voiceURI);
        uniSignSpeechConverter.setVoice(preferred.voiceURI);
      }
    };

    updateVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  const handleSpeak = () => {
    if (!detectedText) return;

    uniSignSpeechConverter.speak(detectedText, {
      voiceURI: selectedVoiceURI,
      rate: speed,
      volume: volume,
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false);
        if (onSpeechCompleted) onSpeechCompleted(detectedText);
      },
      onError: () => setIsSpeaking(false)
    });
  };

  const handleStop = () => {
    uniSignSpeechConverter.stop();
    setIsSpeaking(false);
  };

  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      padding: '24px',
      boxShadow: 'var(--shadow-card)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '18px' }}>
            <div className={`soundwave-bar ${isSpeaking ? '' : 'style-idle'}`} style={{ animationPlayState: isSpeaking ? 'running' : 'paused', height: isSpeaking ? undefined : '10px' }} />
            <div className={`soundwave-bar ${isSpeaking ? '' : 'style-idle'}`} style={{ animationPlayState: isSpeaking ? 'running' : 'paused', height: isSpeaking ? undefined : '16px' }} />
            <div className={`soundwave-bar ${isSpeaking ? '' : 'style-idle'}`} style={{ animationPlayState: isSpeaking ? 'running' : 'paused', height: isSpeaking ? undefined : '8px' }} />
          </div>
          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Uni-Sign Speech Converter
          </span>
        </div>

        {/* Status badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: isSpeaking ? 'var(--accent-green)' : 'var(--text-muted)'
        }}>
          {isSpeaking && (
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-green)',
              boxShadow: '0 0 8px var(--accent-green)'
            }} />
          )}
          <span>{isSpeaking ? 'SPEAKING...' : 'IDLE'}</span>
        </div>
      </div>

      {/* Voice & Speed Controls Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 90px',
        gap: '12px',
        marginBottom: '18px'
      }}>
        {/* Voice Select */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            marginBottom: '6px'
          }}>
            Voice
          </label>
          <select
            value={selectedVoiceURI}
            onChange={(e) => {
              const uri = e.target.value;
              setSelectedVoiceURI(uri);
              uniSignSpeechConverter.setVoice(uri);
            }}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '9px 12px',
              fontSize: '13px',
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            {voices.length > 0 ? (
              voices.map(v => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))
            ) : (
              <option value="">Aria · English (US) [Default]</option>
            )}
          </select>
        </div>

        {/* Speed Select */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            marginBottom: '6px'
          }}>
            Speed
          </label>
          <select
            value={speed}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setSpeed(val);
              uniSignSpeechConverter.setRate(val);
            }}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '9px 12px',
              fontSize: '13px',
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="0.75">0.75×</option>
            <option value="1.0">1.0×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
          </select>
        </div>
      </div>

      {/* Auto-speak Toggle & Volume Slider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '14px'
      }}>
        {/* Auto-speak Toggle Switch */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: 'pointer',
          userSelect: 'none'
        }}>
          <div
            onClick={() => setAutoSpeak(!autoSpeak)}
            style={{
              width: '38px',
              height: '22px',
              borderRadius: '999px',
              backgroundColor: autoSpeak ? '#ffffff' : 'rgba(255, 255, 255, 0.1)',
              position: 'relative',
              transition: 'background-color 0.2s ease'
            }}
          >
            <div style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: autoSpeak ? '#000000' : '#8e93a0',
              position: 'absolute',
              top: '3px',
              left: autoSpeak ? '19px' : '3px',
              transition: 'left 0.2s ease'
            }} />
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Auto-speak
          </span>
        </label>

        {/* Volume Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Volume2 size={16} color="var(--text-secondary)" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
              uniSignSpeechConverter.setVolume(val);
            }}
            style={{
              width: '90px',
              height: '4px',
              accentColor: '#ffffff',
              cursor: 'pointer'
            }}
          />
        </div>
      </div>

      {/* Action Buttons: Speak Text & Stop */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '10px',
        marginBottom: '14px'
      }}>
        <button
          onClick={handleSpeak}
          disabled={!detectedText || isSpeaking}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '11px 20px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: detectedText ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-strong)',
            color: detectedText ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: detectedText ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={e => {
            if (detectedText) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.14)';
          }}
          onMouseLeave={e => {
            if (detectedText) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
          }}
        >
          <Play size={14} fill="currentColor" />
          <span>Speak text</span>
        </button>

        <button
          onClick={handleStop}
          disabled={!isSpeaking}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '11px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'transparent',
            border: '1px solid var(--border-subtle)',
            color: isSpeaking ? '#f87171' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: isSpeaking ? 'pointer' : 'default',
            transition: 'all 0.2s ease'
          }}
        >
          <Square size={14} fill="currentColor" />
          <span>Stop</span>
        </button>
      </div>

      {/* Status helper text */}
      <div style={{
        textAlign: 'center',
        fontSize: '12px',
        color: 'var(--text-muted)'
      }}>
        {isSpeaking
          ? 'Synthesizing voice playback...'
          : 'Speech is ready when your first message is.'}
      </div>
    </div>
  );
}
