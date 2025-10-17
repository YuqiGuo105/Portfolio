'use client';

export default function AppIcon({ app, onOpen }) {
  return (
    <button type="button" className="desktop-icon" onClick={() => onOpen(app.id)}>
      <span className="glyph" aria-hidden>{app.icon}</span>
      <span>{app.title}</span>
    </button>
  );
}
