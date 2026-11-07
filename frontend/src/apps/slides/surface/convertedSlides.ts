import { slidesAdapter } from '@/apps/slides/collab/adapter'
import { drawnSlides, type DrawnSlide } from '@/apps/slides/collab/drawnDeck'
import { openCollabRoom, type CollabSession } from '@/platform/collab'

// Tells `onSlides` a converted presentation's slides now and each time its room changes
// Answers what closes the room, or null when the room won't open
export async function watchConvertedSlides(
  session: CollabSession,
  onSlides: (slides: DrawnSlide[]) => void,
) {
  const opened = await openCollabRoom({ session, adapter: slidesAdapter })
  if (opened.state !== 'live') {
    return null
  }

  const { room } = opened
  function draw() {
    onSlides(drawnSlides(room.doc))
  }

  room.doc.on('update', draw)
  draw()

  return () => {
    room.doc.off('update', draw)
    void room.close()
  }
}
