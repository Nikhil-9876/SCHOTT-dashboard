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

  if (!thumbnailUrl && !creativeUrl) {
    return <span className="ad-thumb-placeholder" title="No preview available">🖼️</span>;
  }

  const isLinkedInPost = Boolean(creativeUrl?.includes('linkedin.com/feed/update/'));
  const embedUrl = isLinkedInPost && creativeUrl ? creativeUrl.replace('/feed/update/', '/embed/feed/update/') : null;
  const popoverWidth = embedUrl ? 330 : 240;
  const popoverHeight = embedUrl ? 420 : (thumbnailUrl ? 240 : 120);

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

  const imageElement = thumbnailUrl ? (
    <img src={thumbnailUrl} alt={creativeName ?? 'Asset'} className="ad-thumb" />
  ) : (
    <span className="ad-thumb-placeholder" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title={`Open ${creativeName ?? 'landing page'}`}>
      🔗
    </span>
  );

  return (
    <div
      ref={ref}
      className="asset-thumb-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {creativeUrl ? (
        <a href={creativeUrl} target="_blank" rel="noopener noreferrer" title={`Open: ${creativeName ?? ''}`}>
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
              pointerEvents: 'auto',
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
            ) : thumbnailUrl ? (
              <img 
                src={thumbnailUrl} 
                alt={creativeName ?? 'Enlarged Asset'} 
                style={{ width: popoverWidth, height: 'auto', display: 'block' }}
              />
            ) : creativeUrl ? (
              <div style={{ padding: '14px 16px', width: popoverWidth, boxSizing: 'border-box', textAlign: 'center', background: '#f8fafc' }}>
                <div style={{ fontSize: '20px', marginBottom: '4px' }}>🔗</div>
                <div style={{ fontWeight: 600, fontSize: '12px', color: '#0f172a', marginBottom: '6px', wordBreak: 'break-word' }}>
                  {creativeName || 'Website Landing Page'}
                </div>
                <a
                  href={creativeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '11px',
                    color: '#0284c7',
                    wordBreak: 'break-all',
                    textDecoration: 'underline',
                    fontWeight: 500,
                  }}
                >
                  Visit Link ↗
                </a>
              </div>
            ) : null}
          </div>,
          document.body
        )}
    </div>
  );
}
