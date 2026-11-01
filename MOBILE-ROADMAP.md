# Neon Racer — mobile release path

## Shipped in the mobile racer pass

- Daily event button with a deterministic UTC car + circuit combination.
- Touch buttons keep pointer capture and provide a short haptic tap where the
  device supports it.
- Race HUD warns portrait phone users to rotate into the intended landscape
  driving view.
- PWA metadata is ready for an iOS/Android home-screen install.
- Four-sector delta HUD and a post-race time-loss review turn every retry into
  a concrete target, with best splits stored locally per circuit.
- The graphics pass is designed around low draw-call procedural geometry so it
  remains viable on phones without downloading a large asset pack.

## Recommended next milestones

1. **Art lock:** replace the procedural GT/prototype bodies with four authored,
   unbranded glTF racecars. Keep one shared material budget and provide LOD0,
   LOD1, and a menu thumbnail for each car.
2. **Race feel:** add a ghost lap, sector delta, launch practice, and a short
   post-race “why you lost time” panel. These make retries meaningful instead
   of only adding more content.
3. **Content cadence:** add two short circuits and one new cup, then rotate the
   Daily Run target across the complete car/track pool.
4. **Phone QA:** test 30/60 fps on representative iPhone and Android devices,
   especially when bloom, smoke, and scenery are enabled together. Keep a
   30-fps fallback and preserve the low-quality mode.
5. **Store builds:** wrap the PWA with Capacitor for Android/iOS, add native
   splash/icon assets, lock the race screen to landscape, and keep menus
   portrait-friendly. Then complete store privacy, age rating, and offline
   asset checks.

## Product direction

Neon Racer should stay an arcade racer with believable racecar proportions,
quick three-minute sessions, and a clear mastery loop: learn a circuit, beat a
sector, unlock a car, and return for the daily combination. Avoid licensed
brand names until there is a separate rights and asset budget.
