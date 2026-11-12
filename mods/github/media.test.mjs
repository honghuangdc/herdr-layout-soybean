// node mods/github/media.test.mjs: splitting bodies around pictures, and reading picture sizes.
import assert from "assert";
import { readFileSync } from "fs";
// media.js imports herdr for downloads; split and sizeOf don't need it.
const src = readFileSync(new URL("./media.js", import.meta.url), "utf8").replace(/^import .*$/gm, "");
const { split, sizeOf } = await import(`data:text/javascript,${encodeURIComponent(src)}`);

assert.deepEqual(split(""), [], "empty body");
assert.deepEqual(split("just text"), [{ text: "just text" }], "no picture");
assert.deepEqual(split("before\n![shot](https://x.io/a.png)\nafter"),
  [{ text: "before\n" }, { image: "https://x.io/a.png", alt: "shot", width: null }, { text: "\nafter" }], "markdown image");
assert.deepEqual(split('<img width="320" alt="Screen" src="https://x.io/b.png">').map((p) => p.image ? [p.image, p.alt, p.width] : p.text),
  [["https://x.io/b.png", "Screen", 320]], "html img with attributes in any order");
assert.equal(split("[![b](https://x.io/badge.svg)](https://x.io)")[0].image, "https://x.io/badge.svg", "linked image keeps the picture, drops the link");
assert.deepEqual(split("```\n![no](https://x.io/c.png)\n```"), [{ text: "```\n![no](https://x.io/c.png)\n```" }], "fenced code untouched");
assert.equal(split("~~~\n```\n![no](https://x.io/c.png)\n~~~\n![yes](https://x.io/d.png)").filter((p) => p.image).map((p) => p.image).join(), "https://x.io/d.png", "a ``` inside a ~~~ fence doesn't close it");
assert.equal(split("![rel](./local.png)").length, 1, "relative image stays text");
assert.equal(split("a ![1](https://x.io/1.png) b ![2](https://x.io/2.png) c").filter((p) => p.image).length, 2, "two pictures on one line");
assert.deepEqual(split("é ![漢字 🎉](https://x.io/e.png)")[1].alt, "漢字 🎉", "unicode alt");

// Real `file -b` output for each format (file 5.46).
assert.deepEqual(sizeOf("PNG image data, 800 x 600, 1-bit colormap, non-interlaced"), { width: 800, height: 600 }, "png");
assert.deepEqual(sizeOf("JPEG image data, JFIF standard 1.01, aspect ratio, density 72x72, segment length 16, baseline, precision 8, 1200x800, components 3"), { width: 1200, height: 800 }, "jpeg: the size, not the 72x72 density");
assert.deepEqual(sizeOf("GIF image data, version 89a, 500 x 300"), { width: 500, height: 300 }, "gif");
assert.deepEqual(sizeOf("RIFF (little-endian) data, WebP image, VP8 encoding, 640x480, Scaling: [none]x[none], YUV color, decoders should clamp"), { width: 640, height: 480 }, "webp");
assert.deepEqual(sizeOf("SVG Scalable Vector Graphics image", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"></svg>'), { width: 120, height: 40 }, "svg viewBox");
assert.deepEqual(sizeOf("SVG Scalable Vector Graphics image", '<svg width="64px" height="32" xmlns="http://www.w3.org/2000/svg">'), { width: 64, height: 32 }, "svg width/height with units");
assert.equal(sizeOf("SVG Scalable Vector Graphics image", "<svg>"), null, "svg without any size");
assert.equal(sizeOf("ASCII text", "hello"), null, "not an image");
assert.equal(sizeOf(""), null, "file unavailable");
console.log("media.test ok");
