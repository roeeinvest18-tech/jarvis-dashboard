// Signal glyphs, ported from the imported design system's "Signal glyphs"
// section verbatim where a direct data mapping exists; a few additions
// (recurring, oversold) follow the same minimal geometric / single-stroke
// language rather than inventing a new visual style.

const ICONS = {
  momentumUp: (color = 'var(--gain)', size = 12) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M1 11L5 5L8 8L13 1" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

  volumeSurge: (color = 'var(--cyan)', size = 12) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="8" width="2.5" height="5" fill="${color}"/>
      <rect x="5.75" y="4" width="2.5" height="9" fill="${color}"/>
      <rect x="10.5" y="1" width="2.5" height="12" fill="${color}"/>
    </svg>`,

  maCross: (size = 12) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <line x1="1" y1="10" x2="13" y2="4" stroke="var(--text-mid)" stroke-width="1.6"/>
      <line x1="1" y1="4" x2="13" y2="10" stroke="var(--amber)" stroke-width="1.6"/>
    </svg>`,

  earningsSoon: (size = 12) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="6" fill="none" stroke="var(--earnings-warn)" stroke-width="1.6"/>
      <line x1="7" y1="4" x2="7" y2="7.5" stroke="var(--earnings-warn)" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="7" cy="10" r="0.9" fill="var(--earnings-warn)"/>
    </svg>`,

  confluenceStar: (size = 10) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1L8.6 5.1L13 5.6L9.7 8.5L10.7 13L7 10.6L3.3 13L4.3 8.5L1 5.6L5.4 5.1Z" fill="var(--amber)"/>
    </svg>`,

  // Additions beyond the design system, same single-stroke language.
  recurring: (color = 'var(--cyan)', size = 12) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 7a5 5 0 0 1 8.5-3.5L12 2" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M12 7a5 5 0 0 1-8.5 3.5L2 12" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M12 2v2.5H9.5" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 12V9.5h2.5" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

  oversold: (size = 12) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M1 3L5 9L8 6L13 13" stroke="var(--loss)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

  refresh: (size = 14) => `
    <svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 7a5 5 0 0 1 8.5-3.5L12 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M12 7a5 5 0 0 1-8.5 3.5L2 12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M12 2v2.5H9.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 12V9.5h2.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

  navToday: (size = 20) => `
    <svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <line x1="3" y1="8" x2="17" y2="8" stroke="currentColor" stroke-width="1.5"/>
      <line x1="7" y1="2.5" x2="7" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13" y1="2.5" x2="13" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,

  navScan: (size = 20) => `
    <svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <line x1="13.5" y1="13.5" x2="17.5" y2="17.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
};
