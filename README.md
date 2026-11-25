# Pixel Gridiron

An original retro pixel-art arcade football game that runs in the browser on phones and computers. Play the CPU or play a friend online.

## Play

It's a static site with no build step. Any static web host works:

- **GitHub Pages:** in the repo's Settings → Pages, set the source to this branch and the `/ (root)` folder. Then open the URL it gives you on your phone or computer.
- **Locally:** run `python3 -m http.server` in this folder and open http://localhost:8000.

## Online multiplayer

1. One player taps **HOST ONLINE** and gets a 5-letter room code (or taps **COPY INVITE LINK**).
2. The other player taps **JOIN ONLINE** and enters the code, or just opens the invite link.

Players connect directly to each other over WebRTC through [PeerJS](https://peerjs.com), which is bundled in `js/vendor/`. The free public PeerJS server only introduces the two players to each other. The host's device runs the game and the guest's device sends its moves. Each player sees their own team attacking left to right.

## Controls

| | Touch | Keyboard / mouse |
|---|---|---|
| Call a play | RUN / PASS / PUNT / FIELD GOAL buttons | buttons, or R / P / K / F |
| Throw | tap where the ball should land | click where the ball should land |
| QB scramble | – | arrows / WASD |
| Steer the ball carrier | drag up / down | arrows / WASD |
| Dive | tap | Space |
| Move your defender (yellow arrow) | drag | arrows / WASD |
| Kick | tap when the needle is in the green | click or Space |

## Code

- `js/sim.js`: game rules, AI and physics. It has no DOM, so it also runs in Node.
- `js/game.js`: rendering, input, sound and networking.
- `?demo` in the URL plays a CPU-vs-CPU game you can watch.
