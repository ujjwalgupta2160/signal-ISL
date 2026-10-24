import React, { useState } from 'react';
import { X, BookOpen, Sparkles, Search, Type, Hash, MessageSquare } from 'lucide-react';
import { ALPHABET_A_TO_Z, NUMBERS_0_TO_10, FULL_SIGN_VOCABULARY } from '../utils/signClassifier';

export default function HowToSignModal({ isOpen, onClose, onSelectSign, initialLanguage = 'ISL' }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState('all'); // 'all', 'alphabet', 'numbers', or specific categories

  if (!isOpen) return null;

  // Build combined items for browsing
  const allItems = [
    ...ALPHABET_A_TO_Z.map(item => ({
      ...item,
      phrase: `Letter ${item.letter}`,
      hindiPhrase: item.letter,
      badge: 'Fingerspelling'
    })),
    ...NUMBERS_0_TO_10.map(num => ({
      ...num,
      phrase: num.name,
      hindiPhrase: num.digit,
      badge: 'Number'
    })),
    ...FULL_SIGN_VOCABULARY.map(v => ({
      ...v,
      badge: v.category
    }))
  ];

  // Filter based on search query and active section
  const filteredItems = allItems.filter(item => {
    const matchesSearch = searchQuery.trim() === '' ||
      (item.name && item.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.phrase && item.phrase.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.hindiPhrase && item.hindiPhrase.includes(searchQuery));

    if (!matchesSearch) return false;

    if (activeSection === 'all') return true;
    if (activeSection === 'alphabet') return item.isLetter;
    if (activeSection === 'numbers') return item.isNumber || item.category === 'Numbers';
    return item.category === activeSection;
  });

  const categories = [
    { id: 'all', label: 'All Signs (130+)' },
    { id: 'alphabet', label: 'A–Z Alphabet (26)' },
    { id: 'numbers', label: 'Numbers 0–10' },
    { id: 'Greetings', label: 'Greetings' },
    { id: 'Responses', label: 'Responses' },
    { id: 'Questions', label: 'Questions' },
    { id: 'Emergency', label: 'Emergency & Medical' },
    { id: 'Daily Needs', label: 'Daily Needs' },
    { id: 'Family', label: 'Family & Friends' },
    { id: 'Emotions', label: 'Emotions' },
    { id: 'Actions', label: 'Actions & Verbs' },
    { id: 'Time', label: 'Time & Calendar' }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-strong)',
          maxWidth: '850px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-subtle)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <BookOpen size={20} color="var(--accent-cyan)" />
              <h2 style={{ fontSize: '19px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Total Sign Language Encyclopedia
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Complete reference for Indian Sign Language (ISL) & ASL: A–Z fingerspelling, numbers, and 100+ conversational signs
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Search Bar & Stats */}
        <div style={{
          padding: '14px 24px',
          backgroundColor: 'var(--bg-card-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            alignItems: 'center'
          }}>
            <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px' }} />
            <input
              type="text"
              placeholder="Search signs by name, phrase, English or Hindi meaning (e.g. Doctor, Namaste, A, Water)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px 8px 36px',
                fontSize: '13px',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Clear
              </button>
            )}
          </div>

          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            Showing <strong>{filteredItems.length}</strong> signs
          </span>
        </div>

        {/* Category Filter Pills */}
        <div style={{
          display: 'flex',
          gap: '6px',
          padding: '10px 24px',
          backgroundColor: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          whiteSpace: 'nowrap'
        }}>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveSection(cat.id)}
              style={{
                padding: '5px 12px',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: activeSection === cat.id ? '#ffffff' : 'rgba(255, 255, 255, 0.05)',
                color: activeSection === cat.id ? '#000000' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: activeSection === cat.id ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Cards Grid */}
        <div style={{
          padding: '20px 24px',
          overflowY: 'auto',
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
          gap: '12px'
        }}>
          {filteredItems.map(item => (
            <div
              key={item.id}
              style={{
                backgroundColor: 'var(--bg-card-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '10px',
                transition: 'border-color 0.2s ease, transform 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.4)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.name || `Letter ${item.letter}`}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono)',
                    color: item.isLetter ? 'var(--accent-blue)' : (item.isNumber ? 'var(--accent-green)' : 'var(--accent-cyan)'),
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    {item.badge}
                  </span>
                </div>

                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: '8px' }}>
                  {item.description}
                </p>

                {item.phrase && (
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--accent-cyan)',
                    backgroundColor: 'rgba(6, 182, 212, 0.08)',
                    padding: '5px 8px',
                    borderRadius: '4px',
                    fontStyle: 'italic'
                  }}>
                    "{item.phrase}"
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  onSelectSign({
                    id: item.id,
                    name: item.name || `Letter ${item.letter}`,
                    phrase: item.phrase || item.letter || item.digit,
                    hindiPhrase: item.hindiPhrase,
                    confidence: 0.99,
                    isLetter: item.isLetter,
                    isNumber: item.isNumber
                  });
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '7px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
              >
                <Sparkles size={12} color="var(--accent-cyan)" />
                <span>Test this sign</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
