'use client'

interface Props {
  linkUrl: string
  linkTitle: string
  linkDescription?: string | null
  linkImage?: string | null
}

export function LinkPreviewCard({ linkUrl, linkTitle, linkDescription, linkImage }: Props) {
  let hostname = ''
  try { hostname = new URL(linkUrl).hostname } catch { hostname = linkUrl }

  return (
    <a
      href={linkUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open link: ${linkTitle}`}
      className="block border border-gray-200 rounded-xl overflow-hidden hover:border-indigo-300 transition-colors group"
      onClick={e => e.stopPropagation()}
    >
      {linkImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={linkImage}
          alt=""
          loading="lazy"
          className="w-full h-36 object-cover group-hover:opacity-95 transition-opacity"
        />
      )}
      <div className="p-3 bg-gray-50">
        <p className="text-[11px] text-gray-400 truncate uppercase tracking-wide">{hostname}</p>
        <p className="text-sm font-semibold text-gray-800 line-clamp-1 mt-0.5">{linkTitle}</p>
        {linkDescription && (
          <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{linkDescription}</p>
        )}
      </div>
    </a>
  )
}
