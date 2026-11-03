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
- Four individually modeled cars, detailed wheel assemblies, and four themed
  circuits are implemented. The procedural vehicle geometry is the current art
  direction; replacing it is not part of the reconstruction work.
- Low / Medium / High settings control rendering quality while retaining the
  same driving behavior.

## Recommended next milestones

1. **Device QA:** measure frame pacing, memory, and repeated track changes on
   representative iPhone and Android hardware. Keep the existing low-quality
   mode usable on slower devices.
2. **Race practice:** evaluate a ghost lap or launch practice as a separate
   feature milestone. Sector deltas and the post-race time-loss review are
   already implemented.
3. **Content cadence:** consider additional circuits and cups in a separately
   scoped release; the current game has four circuits and a rotating daily run.
4. **Store builds:** evaluate native packaging, landscape race presentation,
   portrait-friendly menus, privacy, age ratings, and offline assets before
   committing to a store release.

## Product direction

Neon Racer should stay an arcade racer with believable racecar proportions,
quick three-minute sessions, and a clear mastery loop: learn a circuit, beat a
sector, unlock a car, and return for the daily combination. Avoid licensed
brand names until there is a separate rights and asset budget.
