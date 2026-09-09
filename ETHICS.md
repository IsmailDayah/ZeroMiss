# ETHICS.md — Safety, Ethics & Export Posture

ZeroMiss is an **educational physics simulator about the universal mathematics of
pursuit** — the same proportional-navigation principle taught in undergraduate
courses and visible in falcons catching pigeons, outfielders running down fly balls,
dogs snapping frisbees from the air, and the sailor's collision rule *"constant
bearing, decreasing range."* It is built to be unambiguously appropriate to publish.

## What this project *is*

- **Public-domain mathematics only.** Proportional navigation (PN), Zero-Effort-Miss
  (ZEM), and every validation case are standard, open-literature textbook material
  (e.g. Zarchan, *Tactical and Strategic Missile Guidance*, an AIAA-published academic
  text; the Johns Hopkins APL Technical Digest survey papers). No controlled or
  classified sources are used.
- **Idealized abstractions.** Point-mass (3-DOF) kinematics with a single, abstract
  "lethal radius" standing in for a fuze/warhead. The interceptor is a constant-speed
  dot that can only *turn*.
- **Defense-*relevant*, not defense-*sensitive*.** It covers guidance, estimation,
  verification & validation, and simulation methodology — without containing anything
  export-controlled.

## What this project deliberately is **NOT**

- **No** propulsion, thrust, mass, or burn model.
- **No** warhead, fuze, blast, or fragmentation model (only an abstract scalar radius).
- **No** real seeker, radar, or hardware design.
- **No** real platform, weapon, or threat parameters. Every number in
  `scenarios/_defaults.yaml` is a textbook-range idealization.
- **No** countermeasure-defeat or counter-countermeasure techniques.
- **No** classified, ITAR-, or EAR-controlled technical data of any kind.

## Framing

The README and the in-app `/learn` page lead with the frisbee/falcon framing so the
project reads, correctly, as **applied physics and engineering education**. This
posture is intentional: it is how a responsible engineer presents defense-adjacent
work.

If you believe any part of this repository crosses one of the lines above, please open
an issue — keeping it clean is a design goal, not an afterthought.
