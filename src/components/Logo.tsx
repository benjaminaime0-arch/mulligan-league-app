import Image from "next/image"

interface LogoProps {
  /** Pixel size (applied to both width & height of the lockup). Default 160. */
  size?: number
  /** Use square mark only (for tight places like the top nav). */
  mark?: boolean
  className?: string
  priority?: boolean
}

/**
 * Mulligan League logo.
 * Drop the full lockup at `public/logo.png` (recommended >= 1024px wide, transparent or dark-green bg).
 * Optional square mark at `public/logo-mark.png` for tight slots (falls back to the lockup).
 */
export function Logo({ size = 160, mark = false, className, priority }: LogoProps) {
  const src = mark ? "/logo-mark.png" : "/logo.png"
  const width = size
  const height = mark ? size : Math.round(size * 1) // lockup is roughly square in the provided file

  return (
    <Image
      src={src}
      alt="Mulligan League"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  )
}
