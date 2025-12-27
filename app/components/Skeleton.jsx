'use client';

/**
 * Skeleton loading placeholder components
 */

export function SkeletonText({ width = '100%', className = '' }) {
  return (
    <div
      className={`skeleton skeleton-text ${className}`}
      style={{ width }}
    />
  );
}

export function SkeletonCard({ children }) {
  return (
    <div className="skeleton-card">
      {children || (
        <>
          <div className="skeleton-row">
            <SkeletonText width="30%" />
            <SkeletonText width="20%" />
          </div>
          <SkeletonText width="70%" />
          <SkeletonText width="40%" />
        </>
      )}
    </div>
  );
}

export function SkeletonActivity({ count = 3 }) {
  return (
    <div className="card">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-item skeleton-activity">
          <div className="skeleton-row">
            <SkeletonText width="80px" />
            <SkeletonText width="60px" />
          </div>
          <SkeletonText width="70%" />
          <div className="skeleton-row">
            <SkeletonText width="100px" />
            <SkeletonText width="50px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonBalance({ count = 2 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="balance-card">
          <SkeletonText width="60px" />
          <SkeletonText width="120px" />
        </div>
      ))}
    </>
  );
}
