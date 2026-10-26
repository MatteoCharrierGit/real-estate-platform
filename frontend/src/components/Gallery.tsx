import { useState } from 'react';
import { fileUrl } from '../config';
import type { FileItem } from '../lib/types';
import { HouseIcon } from './ui';

export function Gallery({ files, title }: { files: FileItem[]; title: string }) {
  const [i, setI] = useState(0);
  if (files.length === 0) {
    return (
      <div className="gallery-empty" role="img" aria-label="Nessuna foto disponibile">
        <HouseIcon />
        <span>Nessuna foto disponibile</span>
      </div>
    );
  }
  const cur = files[Math.min(i, files.length - 1)]!;
  const isVideo = cur.contentType.startsWith('video/');
  return (
    <div className="gallery">
      <div className="gallery-main">
        {isVideo ? (
          <video key={cur.id} src={fileUrl(cur.key)} controls preload="metadata" />
        ) : (
          <img key={cur.id} src={fileUrl(cur.key)} alt={`${title} - foto ${i + 1} di ${files.length}`} />
        )}
      </div>
      {files.length > 1 && (
        <ul className="gallery-thumbs" aria-label="Foto e video dell'annuncio">
          {files.map((f, idx) => (
            <li key={f.id}>
              <button
                className={`thumb${idx === i ? ' active' : ''}`}
                onClick={() => setI(idx)}
                aria-label={`Mostra ${f.contentType.startsWith('video/') ? 'video' : 'foto'} ${idx + 1}`}
                aria-current={idx === i}
              >
                {f.contentType.startsWith('video/') ? (
                  <span className="thumb-video">Video</span>
                ) : (
                  <img src={fileUrl(f.key)} alt="" loading="lazy" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
