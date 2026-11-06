// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Give a bowl player their own copy of a photo.
 *
 * An NFL player who joins brings their NFL photo — but the NFL side deletes a
 * player's old photo files whenever they change it, so pointing at that file
 * would break the moment they did. The copy lives in its own folder
 * (avatars/bowls/…), which the NFL side never touches.
 *
 * Returns the copy's public URL, or null if there was nothing to copy or the
 * copy failed (the player then just shows their initial).
 */
export async function copyPhotoForBowls(supabase: Db, userId: string, sourceUrl: string | null | undefined): Promise<string | null> {
  if (!sourceUrl) return null
  const marker = '/storage/v1/object/public/avatars/'
  const at = sourceUrl.indexOf(marker)
  if (at < 0) return null
  const fromPath = decodeURIComponent(sourceUrl.slice(at + marker.length).split('?')[0])
  const ext = fromPath.includes('.') ? fromPath.slice(fromPath.lastIndexOf('.')) : ''
  const toPath = `bowls/${userId}/${Date.now()}${ext}`
  try {
    const { error } = await supabase.storage.from('avatars').copy(fromPath, toPath)
    if (error) return null
    return supabase.storage.from('avatars').getPublicUrl(toPath).data.publicUrl as string
  } catch {
    return null
  }
}
