/**
 * A player's photo with an edit affordance, for the admin Players tab.
 *
 * The avatar itself is the button, with the camera badge as decoration. The
 * badge alone would be an 18px target — fine for a cursor, well under what a
 * thumb can hit — and the whole 36px circle plus its expanded hit area is
 * something you can actually tap. Removal is a text link the caller places in
 * the row's text block for the same reason: a second corner badge would have
 * had to share those 36px with the first.
 *
 * The control it replaced only appeared on hover, so on a phone it did not
 * exist at all. Managed players are the case that matters most — they have no
 * account, so if an admin or their manager can't set the photo, nobody can.
 */
export default function AvatarEditor({
  name, avatarUrl, canEdit, busy, onPick, gradient = 'from-slate-600 to-slate-700',
}: {
  name: string
  avatarUrl?: string | null
  canEdit: boolean
  busy: boolean
  onPick: () => void
  /** Tailwind gradient stops for the fallback initial. */
  gradient?: string
}) {
  const face = avatarUrl ? (
    <img src={avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover border border-white/[0.08]" />
  ) : (
    <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center border border-white/[0.08] text-white text-xs font-bold`}>
      {name?.charAt(0).toUpperCase()}
    </div>
  )

  if (!canEdit) return <div className="relative shrink-0">{face}</div>

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      aria-label={avatarUrl ? `Change ${name}'s photo` : `Add a photo for ${name}`}
      title={avatarUrl ? `Change ${name}'s photo` : `Add a photo for ${name}`}
      // after: widens what a finger has to hit without moving anything on screen.
      className="relative shrink-0 rounded-full after:absolute after:-inset-1.5 after:content-[''] group"
    >
      {face}
      {busy ? (
        <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </span>
      ) : (
        <span className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-blue-600 border-2 border-surface flex items-center justify-center group-hover:bg-blue-500 transition pointer-events-none">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </span>
      )}
    </button>
  )
}
