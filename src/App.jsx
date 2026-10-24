import React, { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import HeaderWorkspace from './components/HeaderWorkspace';
import SignInputCard from './components/SignInputCard';
import DetectedTextCard from './components/DetectedTextCard';
import NaturalSpeechCard from './components/NaturalSpeechCard';
import BottomMetrics from './components/BottomMetrics';
import Footer from './components/Footer';
import SessionHistoryModal from './components/SessionHistoryModal';
import HowToSignModal from './components/HowToSignModal';
import SettingsModal from './components/SettingsModal';
import { uniSignSpeechConverter } from './utils/uniSignSpeechConverter';
import confetti from 'canvas-confetti';

export default function App() {
  const [activeTab, setActiveTab] = useState('translator');
  const [signLanguage, setSignLanguage] = useState('ISL');
  const [inputMode, setInputMode] = useState('phrases'); // 'phrases', 'alphabet', 'numbers'
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);

  // Translation & Speech States
  const [detectedText, setDetectedText] = useState('');
  const [recentSigns, setRecentSigns] = useState([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);

  // Metrics
  const [signsDetectedCount, setSignsDetectedCount] = useState(0);
  const [spokenMessagesCount, setSpokenMessagesCount] = useState(0);

  // Modals & Settings
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHowToSignOpen, setIsHowToSignOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mirrorMode, setMirrorMode] = useState(false);
  const [sensitivity, setSensitivity] = useState(70);

  // History log
  const [history, setHistory] = useState([
    {
      signName: 'Namaste',
      phrase: 'Namaste, greetings!',
      timestamp: '10:42 AM'
    },
    {
      signName: 'Swagatam',
      phrase: 'Aapka swagatam hai, welcome!',
      timestamp: '10:43 AM'
    }
  ]);

  // Session timer ticker
  useEffect(() => {
    let timer = null;
    if (isSessionActive) {
      timer = setInterval(() => {
        setSessionTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isSessionActive]);

  // Active detection state for Detected Text
  const [activeTypingSign, setActiveTypingSign] = useState(null);

  // Handler when a sign gesture is recognized
  const handleGestureDetected = (sign) => {
    setIsDetecting(true);
    setActiveTypingSign(sign.name);

    setTimeout(() => {
      setIsDetecting(false);
      setActiveTypingSign(null);
    }, 1200);

    setSignsDetectedCount(prev => prev + 1);
    setRecentSigns(prev => [sign.name, ...prev.filter(s => s !== sign.name)].slice(0, 7));

    // Handle single letter fingerspelling vs numbers vs word signs
    if (sign.isLetter || sign.type === 'letter') {
      // If it's just a letter, accurately write the letter!
      const char = (sign.letter || sign.text || sign.phrase || '').toUpperCase();
      setDetectedText(prev => prev + char);
    } else if (sign.isNumber || sign.type === 'number') {
      const num = sign.digit || sign.text || sign.phrase;
      setDetectedText(prev => {
        const clean = prev.trim();
        return clean ? `${clean} ${num}` : num;
      });
    } else {
      // If it's a sign of a word, accurately write the word!
      const word = sign.text || sign.phrase || sign.name;
      setDetectedText(prev => {
        const clean = prev.trim();
        if (!clean) return word;
        // Prevent duplicate appending if the word is already the latest word
        if (clean.endsWith(word)) return clean;
        return `${clean} ${word}`;
      });

      if (autoSpeak) {
        uniSignSpeechConverter.speak(word, {
          rate: 1.0,
          volume: 1.0,
          onEnd: () => {
            setSpokenMessagesCount(c => c + 1);
          }
        });
      }
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setHistory(prev => [
      {
        signName: sign.name,
        phrase: sign.phrase,
        timestamp: timeStr
      },
      ...prev
    ]);

    if ((signsDetectedCount + 1) % 5 === 0) {
      confetti({
        particleCount: 25,
        spread: 45,
        origin: { y: 0.7 },
        colors: ['#06b6d4', '#10b981', '#ffffff']
      });
    }
  };

  const handleFingerspellLetter = (char) => {
    setDetectedText(prev => prev + char);
    setSignsDetectedCount(c => c + 1);
  };

  const handleFingerspellSpace = () => {
    setDetectedText(prev => prev + ' ');
  };

  const handleFingerspellBackspace = () => {
    setDetectedText(prev => prev.slice(0, -1));
  };

  const handleStartSession = () => {
    setIsSessionActive(true);
  };

  const handleStopSession = () => {
    setIsSessionActive(false);
  };

  const handleResetSession = () => {
    setIsSessionActive(false);
    setSessionTime(0);
    setDetectedText('');
    setRecentSigns([]);
    setSignsDetectedCount(0);
    setSpokenMessagesCount(0);
    uniSignSpeechConverter.stop();
  };

  const handleClearText = () => {
    setDetectedText('');
    setRecentSigns([]);
    uniSignSpeechConverter.stop();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenHowToSign={() => setIsHowToSignOpen(true)}
      />

      {/* Main Workspace Area */}
      <main style={{
        maxWidth: '1440px',
        width: '100%',
        margin: '0 auto',
        padding: '24px 32px 20px 32px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Workspace Title & Live Session Timer Pill */}
        <HeaderWorkspace
          isSessionActive={isSessionActive}
          sessionTime={sessionTime}
        />

        {/* 2-Column Main Workspace */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)',
          gap: '20px',
          alignItems: 'start'
        }}>
          {/* Left Column: Sign input / Camera feed */}
          <SignInputCard
            signLanguage={signLanguage}
            setSignLanguage={setSignLanguage}
            isSessionActive={isSessionActive}
            onStartSession={handleStartSession}
            onStopSession={handleStopSession}
            onResetSession={handleResetSession}
            onGestureDetected={handleGestureDetected}
            mirrorMode={mirrorMode}
            setMirrorMode={setMirrorMode}
            inputMode={inputMode}
            setInputMode={setInputMode}
            onFingerspellLetter={handleFingerspellLetter}
            onFingerspellSpace={handleFingerspellSpace}
            onFingerspellBackspace={handleFingerspellBackspace}
            sensitivity={sensitivity}
          />

          {/* Right Column: Detected Text & Natural Speech */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <DetectedTextCard
              detectedText={detectedText}
              setDetectedText={setDetectedText}
              recentSigns={recentSigns}
              isDetecting={isDetecting}
              activeTypingSign={activeTypingSign}
              onClearText={handleClearText}
            />

            <NaturalSpeechCard
              detectedText={detectedText}
              autoSpeak={autoSpeak}
              setAutoSpeak={setAutoSpeak}
              onSpeechCompleted={() => setSpokenMessagesCount(c => c + 1)}
            />
          </div>
        </div>

        {/* Bottom Metrics & Conversation Guidance */}
        <BottomMetrics
          signsDetectedCount={signsDetectedCount}
          spokenMessagesCount={spokenMessagesCount}
        />

        {/* Footer */}
        <Footer onOpenHowToSign={() => setIsHowToSignOpen(true)} />
      </main>

      {/* Modals */}
      <SessionHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => {
          setIsHistoryOpen(false);
          setActiveTab('translator');
        }}
        history={history}
        onClearHistory={() => setHistory([])}
      />

      <HowToSignModal
        isOpen={isHowToSignOpen}
        onClose={() => {
          setIsHowToSignOpen(false);
          setActiveTab('translator');
        }}
        onSelectSign={handleGestureDetected}
        initialLanguage={signLanguage}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        mirrorMode={mirrorMode}
        setMirrorMode={setMirrorMode}
        sensitivity={sensitivity}
        setSensitivity={setSensitivity}
      />
    </div>
  );
}
