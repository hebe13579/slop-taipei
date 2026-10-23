[out:json][timeout:180];
(
  way["leisure"="park"](25.020,121.535,25.060,121.580);
  relation["leisure"="park"](25.020,121.535,25.060,121.580);
  way["landuse"~"^(grass|forest|meadow)$"](25.020,121.535,25.060,121.580);
  relation["landuse"~"^(grass|forest|meadow)$"](25.020,121.535,25.060,121.580);
);
out geom tags;
