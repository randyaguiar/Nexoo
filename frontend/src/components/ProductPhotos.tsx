import { useState } from 'react';

/**
 * La foto principal del producto y, si tiene más de una, las miniaturas para
 * cambiarla. Vive en la página del producto: la tarjeta del catálogo enseña
 * solo la primera, enlazada aquí, para no meter botones dentro del enlace.
 */
export function ProductPhotos({
  photos,
  alt,
  large = false,
}: {
  photos: string[];
  alt: string;
  /** Galería a tamaño de página, en lugar del recorte de la tarjeta. */
  large?: boolean;
}) {
  const [index, setIndex] = useState(0);

  if (photos.length === 0) return null;

  // Una foto borrada deja el índice fuera de rango; vuelve a la primera.
  const current = photos[index] ?? photos[0];

  return (
    <div className={`product-photos${large ? ' is-large' : ''}`}>
      <img className="product-photo" src={current} alt={alt} loading={large ? 'eager' : 'lazy'} />
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
