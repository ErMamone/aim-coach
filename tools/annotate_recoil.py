#!/usr/bin/env python3
"""
annotate_recoil.py - extrae el patron de recoil clickeando los agujeros a mano (human-in-the-loop).

El CV automatico sobre gameplay es fragil (view-punch, fogonazo, agujeros pisados). Esto es robusto y
sirve de VALIDACION: abris el frame final del spray y clickeas cada bala EN ORDEN. Tiene ZOOM/PAN para
separar los agujeros pisados. Convierte a grados con el FOV fijo de Valorant y promedia varios sprays.

Uso:
    pip install opencv-python numpy
    python annotate_recoil.py "Vandal 1.mp4" "Vandal 2.mp4" ... --weapon vandal

Controles (ventana):
    click izq       = marcar el proximo agujero (en orden: 1, 2, 3, ...)
    W / S           = zoom in / out (centrado donde esta el mouse)
    click DER + arrastrar = pan (mover la vista)  |  0 = resetear zoom
    u = deshacer   r = reset   a/d = +-10 frames   ,/. = +-1 frame   ENTER = guardar   q = salir

Tip: buscá con a/d/,/. un frame nitido y quieto con el spray completo; hacé ZOOM en la zona amontonada
     y clickeá el centro de cada agujero en orden. 1080p entra en un monitor 1440p.
"""
import argparse
import json
import math
import os
import sys

import cv2


class View:
    """Maneja zoom/pan y la conversion display<->fuente. Los clicks se guardan en coords de la FUENTE."""

    def __init__(self, w, h):
        self.W, self.H = w, h
        self.zoom = 1.0
        self.cx, self.cy = w / 2, h / 2
        self.clicks = []
        self.panning = False
        self.pan_start = None
        self.DISP_W = min(1500, w)
        self.DISP_H = int(self.DISP_W * h / w)
        self.mx, self.my = self.DISP_W // 2, self.DISP_H // 2  # ultima pos del mouse (para zoom con teclas)

    def box(self):
        vw, vh = self.W / self.zoom, self.H / self.zoom
        x0 = min(max(self.cx - vw / 2, 0), self.W - vw)
        y0 = min(max(self.cy - vh / 2, 0), self.H - vh)
        return x0, y0, vw, vh

    def to_src(self, dx, dy):
        x0, y0, vw, vh = self.box()
        return x0 + dx * vw / self.DISP_W, y0 + dy * vh / self.DISP_H

    def to_disp(self, sx, sy):
        x0, y0, vw, vh = self.box()
        return int((sx - x0) * self.DISP_W / vw), int((sy - y0) * self.DISP_H / vh)

    def zoom_at(self, dx, dy, factor):
        bx, by = self.to_src(dx, dy)
        self.zoom = min(12.0, max(1.0, self.zoom * factor))
        ax, ay = self.to_src(dx, dy)
        self.cx += bx - ax
        self.cy += by - ay

    def on_mouse(self, event, x, y, flags, _param):
        self.mx, self.my = x, y
        if event == cv2.EVENT_LBUTTONDOWN:
            self.clicks.append(self.to_src(x, y))
        elif event == cv2.EVENT_RBUTTONDOWN:
            self.panning = True
            self.pan_start = (x, y, self.cx, self.cy)
        elif event == cv2.EVENT_RBUTTONUP:
            self.panning = False
        elif event == cv2.EVENT_MOUSEMOVE and self.panning:
            _, _, vw, vh = self.box()
            sx0, sy0, ocx, ocy = self.pan_start
            self.cx = ocx - (x - sx0) * vw / self.DISP_W
            self.cy = ocy - (y - sy0) * vh / self.DISP_H


def annotate(path, weapon, expected):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f"no pude abrir {path}", file=sys.stderr)
        return [], (0, 0)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    idx = max(0, total - 5)
    v = View(w, h)
    win = f"{os.path.basename(path)}  [{weapon}]"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(win, v.on_mouse)

    while True:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            idx = max(0, idx - 1)
            continue
        x0, y0, vw, vh = v.box()
        crop = frame[int(y0):int(y0 + vh), int(x0):int(x0 + vw)]
        disp = cv2.resize(crop, (v.DISP_W, v.DISP_H), interpolation=cv2.INTER_NEAREST)
        for i, (sx, sy) in enumerate(v.clicks):
            px, py = v.to_disp(sx, sy)
            if 0 <= px < v.DISP_W and 0 <= py < v.DISP_H:
                cv2.circle(disp, (px, py), 5, (0, 0, 255), 1)
                cv2.putText(disp, str(i + 1), (px + 6, py - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
        bar = f"frame {idx}/{total}  zoom {v.zoom:.1f}x  clicks {len(v.clicks)}/{expected}   " \
              f"[click=marcar  W/S=zoom  DER=pan  0=reset zoom  u=deshacer  r=reset  a/d=+-10  ,/.=+-1  ENTER=ok  q=salir]"
        cv2.rectangle(disp, (0, 0), (v.DISP_W, 26), (0, 0, 0), -1)
        cv2.putText(disp, bar, (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1)
        cv2.imshow(win, disp)
        key = cv2.waitKey(20) & 0xFF
        if key in (13, 10):
            break
        elif key == ord('u') and v.clicks:
            v.clicks.pop()
        elif key == ord('r'):
            v.clicks = []
        elif key in (ord('w'), ord('+'), ord('=')):
            v.zoom_at(v.mx, v.my, 1.25)   # zoom in, centrado donde esta el mouse
        elif key in (ord('s'), ord('-'), ord('_')):
            v.zoom_at(v.mx, v.my, 0.8)    # zoom out
        elif key == ord('0'):
            v.zoom, v.cx, v.cy = 1.0, w / 2, h / 2
        elif key == ord('a'):
            idx = max(0, idx - 10)
        elif key == ord('d'):
            idx = min(total - 1, idx + 10)
        elif key == ord(','):
            idx = max(0, idx - 1)
        elif key == ord('.'):
            idx = min(total - 1, idx + 1)
        elif key == ord('q'):
            cap.release(); cv2.destroyWindow(win)
            print("cancelado"); sys.exit(0)
    cap.release()
    cv2.destroyWindow(win)
    return list(v.clicks), (w, h)


def to_degrees(pts, size, fov_h=103.0):
    if not pts:
        return []
    w, _ = size
    focal = (w / 2) / math.tan(math.radians(fov_h / 2))
    cx0, cy0 = pts[0]
    return [(round(math.degrees(math.atan((cy0 - y) / focal)), 2),
             round(math.degrees(math.atan((x - cx0) / focal)), 2)) for x, y in pts]


def average_curves(curves):
    valid = [c for c in curves if len(c) >= 3]
    if not valid:
        return []
    n = min(len(c) for c in valid)
    return [{"v": round(sum(c[i][0] for c in valid) / len(valid), 2),
             "h": round(sum(c[i][1] for c in valid) / len(valid), 2)} for i in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--weapon", default="vandal")
    ap.add_argument("--fov", type=float, default=103.0)
    args = ap.parse_args()
    MAG = {"vandal": 25, "phantom": 30, "spectre": 30, "bulldog": 24, "guardian": 12, "stinger": 20, "ares": 50, "odin": 100}
    expected = MAG.get(args.weapon, 25)

    curves = []
    for path in args.videos:
        pts, size = annotate(path, args.weapon, expected)
        if len(pts) >= 3:
            curves.append(to_degrees(pts, size, args.fov))
            print(f"{os.path.basename(path)}: {len(pts)} agujeros marcados")
        else:
            print(f"{os.path.basename(path)}: pocos clicks, descartado")

    avg = average_curves(curves)
    if not avg:
        print("sin sprays validos"); sys.exit(1)
    with open("recoil_pattern.txt", "w", encoding="utf-8") as f:
        line = f"// {args.weapon}: {len(avg)} balas, promedio de {len(curves)} spray(s)\n"
        body = ", ".join(f"{{ v: {p['v']}, h: {p['h']} }}" for p in avg)
        line += f"  {args.weapon}: [{body}],\n\nJSON: {json.dumps(avg)}\n"
        f.write(line)
        print("\n" + line)
    print("(guardado en recoil_pattern.txt)")


if __name__ == "__main__":
    main()
