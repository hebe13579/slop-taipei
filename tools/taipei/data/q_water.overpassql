// Bbox = bounding rect of the tile box union (tools/taipei/tile-boxes.json, issue #60); the builders clip to the union itself.
[out:json][timeout:180];
(
  way["natural"="water"](25.0285,121.503,25.060,121.580);
  relation["natural"="water"](25.0285,121.503,25.060,121.580);
  way["waterway"="riverbank"](25.0285,121.503,25.060,121.580);
  relation["waterway"="riverbank"](25.0285,121.503,25.060,121.580);
  way["waterway"="river"](25.0285,121.503,25.060,121.580);
);
out geom tags;
