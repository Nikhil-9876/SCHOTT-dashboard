import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface AssetThumbnailProps {
  thumbnailUrl?: string | null;
  creativeName?: string;
  creativeUrl?: string | null;
}

export default function AssetThumbnail({ thumbnailUrl, creativeName, creativeUrl }: AssetThumbnailProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  if (!thumbnailUrl) {
    return <span className="ad-thumb-placeholder" title="No preview image">🖼️</span>;
  }

  const handleMouseEnter = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const popoverWidth = 260;
    const popoverHeight = 180;

    let left = rect.right + 12;
    if (window.innerWidth - rect.right < popoverWidth + 20) {
      left = Math.max(10, rect.left - popoverWidth - 12);
    }

    let top = rect.top - 15;
    if (top + popoverHeight > window.innerHeight - 20) {
      top = Math.max(10, window.innerHeight - popoverHeight - 20);
    }
    if (top < 10) top = 10;

    setPopoverPos({ top, left });
    setIsHovered(true);
  };

  const imageElement = (
    <img src={thumbnailUrl} alt={creativeName ?? 'Asset'} className="ad-thumb" />
  );

  return (
    <div
      ref={ref}
      className="asset-thumb-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsHovered(false)}
    >
      {creativeUrl ? (
        <a href={creativeUrl} target="_blank" rel="noopener noreferrer" title={`Open ad on LinkedIn: ${creativeName ?? ''}`}>
          {imageElement}
        </a>
      ) : (
        imageElement
      )}

      {isHovered &&
        createPortal(
          <div
            className="asset-enlarged-preview"
            style={{
              position: 'fixed',
              top: `${popoverPos.top}px`,
              left: `${popoverPos.left}px`,
              zIndex: 99999,
              pointerEvents: 'none',
            }}
          >
            <img src={thumbnailUrl} alt={creativeName ?? 'Enlarged Asset'} />
          </div>,
          document.body
        )}
    </div>
  );
}
