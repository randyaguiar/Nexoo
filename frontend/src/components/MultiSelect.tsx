import { useEffect, useId, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, CloseIcon } from './Icon';

export interface MultiSelectOption {
  id: string;
  name: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Etiqueta accesible del control (el <label> visible del campo). */
  label: string;
}

/**
 * Selector múltiple con desplegable y chips. Sustituye al `<select multiple>`
 * nativo, poco usable en móvil y sin espacio para mostrar lo seleccionado.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecciona…',
  label,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = `ms${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);

  const selected = options.filter((option) => value.includes(option.id));

  return (
    <div className="multiselect" ref={containerRef}>
      <button
        type="button"
        className="multiselect-control"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        {selected.length === 0 ? (
          <span className="multiselect-placeholder">{placeholder}</span>
        ) : (
          <span className="multiselect-chips">
            {selected.map((option) => (
              <span key={option.id} className="multiselect-chip">
                {option.name}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Quitar ${option.name}`}
                  className="multiselect-chip-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(option.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      toggle(option.id);
                    }
                  }}
                >
                  <CloseIcon size={12} />
                </span>
              </span>
            ))}
          </span>
        )}
        <ChevronDownIcon className={`multiselect-caret${open ? ' open' : ''}`} size={18} />
      </button>

      {open && (
        <ul className="multiselect-menu" id={listId} role="listbox" aria-multiselectable="true">
          {options.length === 0 && <li className="multiselect-empty">No hay opciones.</li>}
          {options.map((option) => {
            const checked = value.includes(option.id);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`multiselect-option${checked ? ' selected' : ''}`}
                  onClick={() => toggle(option.id)}
                >
                  <span className="multiselect-box">{checked && <CheckIcon size={12} />}</span>
                  {option.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
