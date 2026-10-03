# Native Dots assembly resources

These files were read from the original runtime associated with the Dots page
selected by the user. They contain prepared world-space vertex positions,
normals, triangle indices, authored RGB values, and measured bounds. No image
tracing is used for this geometry.

- `eyes-*.json`: each supported eye style fitted to this body.
- `eyewear-*.json`: eyewear with the body's default eye style. Sunglasses use the
  original runtime's eye visibility decision.
- `combo-*-monocle.json` and `combo-*-tall_oval_frames.json`: jointly fitted eyes
  and transparent eyewear, because glasses can change the eye spacing.
- `accessories-*.json`: each accessory fitted to this body with default eyes.

The default `eyes-oval` file retains the prepared body mesh. The ear-shaped
`rounded_head_two_ears` body uses `eyes-round_inset` instead. Prepared bodies can
have a different depth from the authoring meshes in `../decoded`; the app uses
the prepared mesh so the body and attachments share coordinates.

The native preparation stream uses 96-byte vertex records. The first six
float32 values contain the baked base position and normal. The remaining
native animation/morph fields are omitted from rendering. A length-prefixed
resource key precedes the vertex count. Native triangle arrays are preserved
and checked against the vertex count. RGB and anchor vectors are read from the
native record header. Unverified material header values are stored as
`nativeMaterialFields`, without assigning guessed physical names.

`scripts/assembly-extract-browser.js` performs the extraction. Running
`node scripts/decode-assembly.mjs --pack public/orbit/assemblies` stores arrays
losslessly in adjacent `.bin` files with offsets and SHA-256 checksums in JSON.

The local app adapts lighting and material shading to Three.js and supplies its
own GPU strand fur. Geometry and source RGB are native; shader appearance and
blink animation are local implementations. The original runtime was queried
with beret and headphones selected together and returned `Select at most one
accessory`. The local editor and loader therefore permit at most one accessory.
