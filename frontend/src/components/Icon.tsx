interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Iconos de línea (stroke) del sistema Nexoo. Se dibujan con `currentColor`
 * para heredar el color del texto o del botón que los contiene.
 */
function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 9.5 5 4.5h14l1.5 5" />
      <path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
      <path d="M5 11.5V20h14v-8.5" />
      <path d="M10 20v-4.5h4V20" />
    </Svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3.5H4.8A1.8 1.8 0 0 0 3 5.4C3 13.5 10.5 21 18.6 21a1.8 1.8 0 0 0 1.9-1.8V17l-4-1.5-2 2a13.6 13.6 0 0 1-5.5-5.5l2-2L7 3.5Z" />
    </Svg>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}

export function MapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" />
      <path d="M9 4v13M15 6.5v13" />
    </Svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 11.4V4.5a1 1 0 0 1 1-1h6.9a1 1 0 0 1 .7.3l8.1 8.1a1 1 0 0 1 0 1.4l-6.9 6.9a1 1 0 0 1-1.4 0l-8.1-8.1a1 1 0 0 1-.3-.7Z" />
      <circle cx="7.8" cy="7.8" r="1.4" />
    </Svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m4 17 4.5-4.5L13 17l3-2.5 4 3.5" />
    </Svg>
  );
}

export function TextIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 11h16M4 16h11M4 21h7" />
    </Svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 12S6.4 5.5 12 5.5 21.5 12 21.5 12 17.6 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
      <path d="m13.5 7 3.5 3.5" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5 7.4 20h9.2l.9-13.5" />
      <path d="M10.5 10v6M13.5 10v6" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 8.2 12 3.5 3.5 8.2v7.6L12 20.5l8.5-4.7V8.2Z" />
      <path d="m3.5 8.2 8.5 4.7 8.5-4.7M12 12.9v7.6" />
    </Svg>
  );
}
