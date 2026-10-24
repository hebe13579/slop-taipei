// Bbox = bounding rect of the tile box union (tools/taipei/tile-boxes.json, issue #60); the builders clip to the union itself.
[out:json][timeout:180];
(
  nwr["name:en"="Taipei 101"](25.0285,121.503,25.060,121.580);
  nwr["name"="台北101"](25.0285,121.503,25.060,121.580);
  nwr["name:en"~"Sun Yat-Sen Memorial Hall|Taipei City Hall|National Theater|National Concert Hall|Chiang Kai-shek Memorial Hall"](25.0285,121.503,25.060,121.580);
  nwr["name"~"國父紀念館|臺北市政府|台北市政府|大安森林公園"](25.0285,121.503,25.060,121.580);
);
out geom tags;
