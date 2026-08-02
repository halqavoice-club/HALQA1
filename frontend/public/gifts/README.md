# Gift Video Animations

Place `.webm` or `.mp4` video files here for gift animations.

## File naming convention
`{gift-name-slug}.webm` or `{gift-name-slug}.mp4`

## How to add a video gift

1. Place your video file here: `frontend/public/gifts/golden-trophy.webm`
2. Update the gift's `videoUrl` in the database:
   ```sql
   UPDATE gifts SET videoUrl = '/gifts/golden-trophy.webm', animationType = 'video'
   WHERE name = 'Golden Trophy';
   ```
3. The `LiveClassGiftOverlay` will automatically play the video fullscreen when that gift is sent.

## Recommended specs
- Format: WebM (VP9) for web, MP4 (H.264) as fallback
- Duration: 3–8 seconds
- Resolution: 1080p or 720p
- Transparent background: WebM with alpha channel for best effect
- File size: < 2MB per gift

## Current video gifts
| Gift | File | Status |
|------|------|--------|
| Golden Trophy | golden-trophy.webm | ⏳ Pending |
| Wisdom Crown | wisdom-crown.webm | ⏳ Pending |
| Diamond Book | diamond-book.webm | ⏳ Pending |
| Scholarship | scholarship.webm | ⏳ Pending |

## Free sources for gift animations
- LottieFiles (lottiefiles.com) — export as video
- Rive (rive.app) — interactive animations
- TikTok-style effects can be created with After Effects / MotionArray
