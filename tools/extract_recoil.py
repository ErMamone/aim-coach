#!/usr/bin/env python3
"""
extract_recoil.py - saca el patron de recoil de Valorant de video(s) de spray en pared.

Enfoque TEMPORAL + estabilizado: recorre el video frame a frame, ALINEA cada frame a la pared limpia
(mata el temblor de camara / view-punch) y detecta el AGUJERO NUEVO cada vez que aparece (una bala por
disparo). Asi salen las ~25 balas en ORDEN real y sin fusionarse (la imagen final sola no alcanza:
los agujeros tempranos se pisan). Convierte pixeles->grados con el FOV fijo de Valorant y promedia sprays.

Uso:
    pip install opencv-python numpy
    python extract_recoil.py "Vandal 1.mp4" "Vandal 2.mp4" ... --weapon vandal

Requisitos del clip: pared plana clara, PARADO y SIN mover el mouse, apuntando al CENTRO, un spray por
clip, con un momento de pared LIMPIA al empezar (para la referencia). 16:9. FOV horizontal = 103 (fijo).
Genera <clip>_debug.png (agujeros numerados) y recoil_log.txt para verificar.
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np


def align_to(ref_f, img_gray):
    """Alinea img a la referencia (traslacion) compensando el view-punch. Devuelve img estabilizada."""
    try:
        shift, _ = cv2.phaseCorrelate(ref_f, np.float32(img_gray))
        M = np.float32([[1, 0, -shift[0]], [0, 1, -shift[1]]])
        return cv2.warpAffine(img_gray, M, (img_gray.shape[1], img_gray.shape[0]), borderMode=cv2.BORDER_REPLICATE)
    except cv2.error:
        return img_gray


def process_clip(path, roi, thresh, min_area, max_area, min_circ, merge_r):
    """Recorre el clip y devuelve los agujeros en ORDEN de aparicion (una bala por disparo)."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return [], (0, 0), 0.0, 0, None
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    x0, y0, x1, y1 = int(roi[0] * w), int(roi[1] * h), int(roi[2] * w), int(roi[3] * h)

    ok, frame0 = cap.read()
    if not ok:
        cap.release(); return [], (w, h), fps, 0, None
    ref_roi = cv2.cvtColor(frame0, cv2.COLOR_BGR2GRAY)[y0:y1, x0:x1]
    ref_f = np.float32(ref_roi)
    prev_stab = ref_roi.copy()
    known, ordered = [], []
    last_frame = frame0
    fi = 0
    kernel = np.ones((3, 3), np.uint8)
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        fi += 1
        last_frame = frame
        roi_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)[y0:y1, x0:x1]
        stab = align_to(ref_f, roi_gray)
        # delta vs frame ANTERIOR estabilizado: lo que se oscurecio ahora = agujero nuevo de este disparo
        delta = cv2.subtract(prev_stab, stab)
        prev_stab = stab
        delta = cv2.GaussianBlur(delta, (3, 3), 0)
        _, mask = cv2.threshold(delta, thresh, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best = None
        for c in cnts:
            a = cv2.contourArea(c)
            if a < min_area or a > max_area:
                continue
            peri = cv2.arcLength(c, True)
            circ = 4 * math.pi * a / (peri * peri) if peri > 0 else 0
            if circ < min_circ:
                continue
            m = cv2.moments(c)
            if m["m00"] == 0:
                continue
            cx, cy = m["m10"] / m["m00"] + x0, m["m01"] / m["m00"] + y0
            if best is None or a > best[0]:
                best = (a, cx, cy)                       # el blob nuevo mas prominente del frame
        if best:
            _, cx, cy = best
            if all(math.hypot(cx - kx, cy - ky) > merge_r for kx, ky in known):
                known.append((cx, cy)); ordered.append((cx, cy))
    cap.release()
    return ordered, (w, h), fps, fi, last_frame


def to_degrees(order, size, fov_h=103.0):
    if not order:
        return []
    w, _ = size
    focal = (w / 2) / math.tan(math.radians(fov_h / 2))
    cx0, cy0 = order[0]                                   # bala 1 = punto de mira (origen)
    return [(round(math.degrees(math.atan((cy0 - y) / focal)), 2),
             round(math.degrees(math.atan((x - cx0) / focal)), 2)) for x, y in order]


def average_curves(curves):
    valid = [c for c in curves if len(c) >= 3]
    if not valid:
        return []
    n = min(len(c) for c in valid)
    return [{"v": round(sum(c[i][0] for c in valid) / len(valid), 2),
             "h": round(sum(c[i][1] for c in valid) / len(valid), 2)} for i in range(n)]


def save_debug(path, frame, order):
    img = frame.copy()
    for i, (x, y) in enumerate(order):
        cv2.circle(img, (int(x), int(y)), 6, (0, 0, 255), 2)
        cv2.putText(img, str(i + 1), (int(x) + 7, int(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
    out = os.path.splitext(path)[0] + "_debug.png"
    cv2.imwrite(out, img)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--weapon", default="vandal")
    ap.add_argument("--fov", type=float, default=103.0)
    ap.add_argument("--thresh", type=int, default=16, help="umbral del delta por frame (agujero nuevo)")
    ap.add_argument("--min-area", type=int, default=5)
    ap.add_argument("--max-area", type=int, default=120)
    ap.add_argument("--min-circ", type=float, default=0.35)
    ap.add_argument("--merge-r", type=float, default=8.0, help="px: dos detecciones mas cerca que esto = la misma bala")
    ap.add_argument("--min-holes", type=int, default=15, help="clips con menos agujeros que esto se descartan del promedio")
    ap.add_argument("--roi", type=float, nargs=4, default=[0.28, 0.15, 0.58, 0.58],
                    help="x0 y0 x1 y1 en fracciones (franja del spray; excluye arma/HUD). Asumí puntería al CENTRO.")
    args = ap.parse_args()
    MAG = {"vandal": 25, "phantom": 30, "spectre": 30, "bulldog": 24, "guardian": 12, "stinger": 20, "ares": 50, "odin": 100}
    expected = MAG.get(args.weapon, 25)

    log = open("recoil_log.txt", "w", encoding="utf-8")

    def emit(s=""):
        print(s); log.write(s + "\n")

    curves = []
    for path in args.videos:
        order, size, fps, count, last = process_clip(
            path, args.roi, args.thresh, args.min_area, args.max_area, args.min_circ, args.merge_r)
        curve = to_degrees(order, size, args.fov)
        if last is not None:
            dbg = save_debug(path, last, order)
        else:
            dbg = "(sin frames)"
        flag = "OK" if abs(len(order) - expected) <= 5 else ("POCOS" if len(order) < expected else "MUCHOS")
        emit(f"{os.path.basename(path)}: {len(order)} agujeros (esperado ~{expected}) [{flag}] @ "
             f"{size[0]}x{size[1]} {fps:.0f}fps ({count} frames) -> {os.path.basename(str(dbg))}")
        if len(order) >= args.min_holes:
            curves.append(curve)
        else:
            emit(f"    (descartado del promedio: menos de {args.min_holes} agujeros)")

    avg = average_curves(curves)
    emit("")
    if not avg:
        emit("Sin sprays validos. Mirá los *_debug.png y ajustá --thresh / --min-area / --merge-r / --roi.")
        log.close(); sys.exit(1)
    emit(f"// {args.weapon}: {len(avg)} balas, promedio de {len(curves)} spray(s) — pegar en recoil.ts PATTERNS")
    body = ", ".join(f"{{ v: {p['v']}, h: {p['h']} }}" for p in avg)
    emit(f"  {args.weapon}: [{body}],")
    emit("")
    emit("JSON: " + json.dumps(avg))
    log.close()
    print("\n(todo esto quedo en recoil_log.txt; revisá los *_debug.png)")


if __name__ == "__main__":
    main()
