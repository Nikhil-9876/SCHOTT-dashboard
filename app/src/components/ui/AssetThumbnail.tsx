import { useState, useRef, useEffect } from 'react';
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
  const hoverTimeout = useRef<number | null>(null);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    };
  }, []);

  if (!thumbnailUrl) {
    return <span className="ad-thumb-placeholder" title="No preview image">🖼️</span>;
  }

  const embedUrl = creativeUrl ? creativeUrl.replace('/feed/update/', '/embed/feed/update/') : null;
  const popoverWidth = embedUrl ? 330 : 240;
  const popoverHeight = embedUrl ? 420 : 315;

  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();

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

  const handleMouseLeave = () => {
    hoverTimeout.current = window.setTimeout(() => {
      setIsHovered(false);
    }, 300); // 300ms delay gives user time to move mouse into popover
  };

  const handlePopoverMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  };

  const imageElement = (
    <img src={thumbnailUrl} alt={creativeName ?? 'Asset'} className="ad-thumb" />
  );

  return (
    <div
      ref={ref}
      className="asset-thumb-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
              pointerEvents: 'auto', // Important: must be 'auto' to click play
              background: '#fff',
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
              borderRadius: '8px',
              overflow: 'hidden',
              display: 'flex',
            }}
            onMouseEnter={handlePopoverMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {embedUrl ? (
              <iframe
                src={embedUrl}
                width={popoverWidth}
                height={popoverHeight}
                frameBorder="0"
                allowFullScreen
                title={creativeName ?? 'Embedded post'}
                style={{ background: '#fff', display: 'block' }}
              />
            ) : (
              <img 
                src={thumbnailUrl} 
                alt={creativeName ?? 'Enlarged Asset'} 
                style={{ width: popoverWidth, height: 'auto', display: 'block' }}
              />
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
