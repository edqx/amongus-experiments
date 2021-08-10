# Among Us Experiments

Several of my among us experiments using [skeldjs](https://github.com/skeldjs/SkeldJS).

Most of these I write at around 3am at night, please excuse the bad code.

In regards to crashers/exploits, I'll only post patched ones. The rest will remain
"private" until they are patched. I report all of my exploits to Innersloth to
be fixed, and I share them with trusted people only.

No, I will not be sending you non-patched exploits.

It features the following scripts:
* `index.js` - host-only crasher
  * Usage: `node index <region>`
  * Type 'um' into the chat
* `index2.js` - ruin games exploit
  * Usage: `node index2 <region> <game_code>`
  * Example: `node index3 EU BVACVC`
* `index3.js` - patched disconnect host & ruin game
  * Usage: `node index3 <region> <game_code>`
* `index4.js` - display images using among us characters
  * Usage: `node index4 <region> <image_path> <resolution_x> <resolution_y>`
  * Example: `node EU ./flaggb.png 15 15`