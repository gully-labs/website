# Gully Labs pixel references

First screens of every gated page (scripts/design/gl-gate.mjs SCREENS) at 390/768/1440/1920, dark and light, live data
masked. Made on the gully box in the Playwright image (gully/ci-pw163) against the live site, the same way the deploy
gate takes its candidate shots, so fonts and antialiasing match. The deploy (gully-ops deploy-gully-web-v2.sh) fails
and rolls back when a screen differs by more than 8 %.

Refresh after an approved visual change: run the gate with `--update-ref --ref ref --out out` on the box (see the deploy
script's design-gate block for the container command), copy `ref/*.png` here and commit. A screen with no file here is
measured and printed as "no reference" (never a failure) until its file is added.

Repeatability of these references (two runs back to back, 2026-11-26): every screen 0.00-0.69 %, the highest is
/tracker (live table rows that the mask does not cover).
