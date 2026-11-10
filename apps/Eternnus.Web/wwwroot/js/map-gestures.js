// Pinça restrita ao mapa; intercepta dois dedos antes da pintura/movimento.
export function mountMapGestures(host, { scale, zoom, cancel }) {
  const pointers = new Map();
  let pinch = null, pinching = false, suppressClick = false;
  const measure = () => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  function down(e) {
    if (e.pointerType !== "touch") return;
    if (!pointers.size) suppressClick = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      cancel();
      if (!pinching) { pinch = { ...measure(), scale: scale() }; pinching = true; }
      suppressClick = true;
      for (const id of pointers.keys()) host.setPointerCapture(id);
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }
  function move(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinching) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (pointers.size >= 2) {
      const next = measure();
      zoom(pinch.scale * next.distance / pinch.distance, next.x, next.y);
    }
  }
  function up(e) {
    pointers.delete(e.pointerId);
    if (!pinching) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!pointers.size) { pinching = false; pinch = null; }
  }
  function click(e) {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault(); e.stopImmediatePropagation();
  }
  for (const [type, fn] of [["pointerdown",down],["pointermove",move],["pointerup",up],["pointercancel",up],["click",click]]) host.addEventListener(type, fn, true);
  return () => {
    pointers.clear();
    for (const [type, fn] of [["pointerdown",down],["pointermove",move],["pointerup",up],["pointercancel",up],["click",click]]) host.removeEventListener(type, fn, true);
  };
}
