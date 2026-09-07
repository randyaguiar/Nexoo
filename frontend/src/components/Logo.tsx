import { useId } from 'react';

interface LogoMarkProps {
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
}

/**
 * Marca Nexoo: dos anillos enlazados (la "oo" del nombre) que representan la
 * conexión entre quien compra en EE.UU. y quien recibe en Cuba.
 */
export function LogoMark({ size = 36, className }: LogoMarkProps) {
  // useId incluye ":" y eso rompe url(#id) en algunos navegadores.
  const gradientId = `nexoo${useId().replace(/:/g, '')}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14a89b" />
          <stop offset="100%" stopColor="#0b5f59" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gradientId})`} />
      <g fill="none" strokeWidth="3.4" strokeLinecap="round">
        <circle cx="16" cy="20" r="7.2" stroke="#ffffff" />
        <path
          d="M24 12.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1-6.1-3.4"
          stroke="#f5b544"
        />
      </g>
    </svg>
  );
}

/** Marca + logotipo, usado en el header y el footer. */
export function Logo({ size = 36 }: LogoMarkProps) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">
        Nexoo<span className="logo-dot">.</span>
      </span>
    </span>
  );
}
