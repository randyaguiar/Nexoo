import { useState } from 'react';

/**
 * La foto principal del producto y, si tiene más de una, las miniaturas para
 * cambiarla. Sin página de producto, la tarjeta del catálogo es el único sitio
 * donde se pueden ver las demás.
 */
export function ProductPhotos({ photos, alt }: { photos: string[]; alt: string }) {
  const [index, setIndex] = useState(0);

  if (photos.length === 0) return null;

  // Una foto borrada deja el índice fuera de rango; vuelve a la primera.
  const current = photos[index] ?? photos[0];

  return (
    <div className="product-photos">
      <img className="product-photo" src={current} alt={alt} loading="lazy" />
      {photos.length > 1 && (
        <div className="product-thumbs">
          {photos.map((photo, i) => (
            <button
              key={photo}
              type="button"
              className={`product-thumb${i === index ? ' is-active' : ''}`}
              aria-label={`Foto ${i + 1} de ${photos.length}`}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              <img src={photo} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
