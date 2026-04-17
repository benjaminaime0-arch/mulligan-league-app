import Image from "next/image"

interface AvatarProps {
  src?: string | null
  alt?: string
  /** Tailwind size class, e.g. "h-6 w-6", "h-8 w-8", "h-12 w-12" */
  size?: number
  fallback?: string
  className?: string
}

/**
 * Optimised avatar using next/image. Falls back to an initial-letter circle
 * when no `src` is provided.
 */
export function Avatar({
  src,
  alt = "",
  size = 24,
  fallback,
  className = "",
}: AvatarProps) {
  if (!src) {
    const initial = (fallback || alt || "P").charAt(0).toUpperCase()
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary/60 ${className}`}
        style={{ width: size, height: size }}
      >
        {initial}
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`shrink-0 rounded-full object-cover ${className}`}
      unoptimized={!src.includes("supabase.co")}
    />
  )
}
