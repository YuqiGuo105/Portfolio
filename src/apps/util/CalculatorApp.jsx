'use client';

import { useCallback, useState } from 'react';

const buttons = [
  '7', '8', '9', '/',
  '4', '5', '6', '*',
  '1', '2', '3', '-',
  '0', '.', '=', '+',
];

const isOperator = (symbol) => ['/', '*', '-', '+'].includes(symbol);

export default function CalculatorApp() {
  const [display, setDisplay] = useState('0');
  const [history, setHistory] = useState([]);

  const handleInput = useCallback((symbol) => {
    setDisplay((current) => {
      if (symbol === 'C') return '0';
      if (symbol === '=') {
        try {
          const result = Function(`"use strict";return (${current})`)();
          const value = Number.isFinite(result) ? result.toString() : '0';
          setHistory((prev) => [current, ...prev].slice(0, 6));
          return value;
        } catch (error) {
          return '0';
        }
      }
      if (current === '0' && !isOperator(symbol) && symbol !== '.') {
        return symbol;
      }
      return `${current}${symbol}`;
    });
  }, []);

  return (
    <div style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      <div style={{
        background: 'rgba(12,15,24,0.75)',
        padding: '1rem',
        borderRadius: '0.75rem',
        fontSize: '2rem',
        minHeight: '3.5rem',
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {display}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '0.5rem' }}>
        {buttons.map((symbol) => (
          <button
            key={symbol}
            type="button"
            onClick={() => handleInput(symbol)}
            style={{
              padding: '1rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: isOperator(symbol) ? 'rgba(75, 142, 255, 0.45)' : 'rgba(255,255,255,0.08)',
              color: '#fff',
              fontSize: '1.1rem',
              cursor: 'pointer',
            }}
          >
            {symbol}
          </button>
        ))}
        <button
          type="button"
          onClick={() => handleInput('C')}
          style={{
            gridColumn: 'span 4',
            padding: '0.85rem',
            borderRadius: '0.75rem',
            border: 'none',
            background: 'rgba(255,99,99,0.45)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>
      <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>
        <strong>History</strong>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0 0', display: 'grid', gap: '0.35rem' }}>
          {history.length === 0 && <li>No calculations yet.</li>}
          {history.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
